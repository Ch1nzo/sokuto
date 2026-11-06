import { Hono } from 'hono'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { checkBearer, type AppEnv } from '../auth'
import { createDb, schema, type Db } from '../db'
import type { Env } from '../env'
import { configuredChannels, getGeneral } from '../settings'
import { addTag, getTags, parseFields, removeTag, setBotPaused } from '../contacts'
import { contactSequences, logMessage, parseFlow, subscribeSequence, unsubscribeSequence } from '../flows/engine'
import { TEMPLATES } from '../flows/templates'
import { FLOW_SCHEMA_DOC, flowChannelSchema, flowKindSchema, segmentInputSchema, validateFlow } from '../flows/validate'
import { simulateFlow } from '../flows/simulate'
import { getAdapter } from '../channels/registry'
import type { Channel } from '../channels/types'
import { broadcastReach } from '../scheduler'
import { loadSegment, parseSegment } from '../segments'

export const mcpRoutes = new Hono<AppEnv>()

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const fail = (message: string, extra?: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...(extra ? { details: extra } : {}) }, null, 2) }], isError: true })

async function flowById(d: Db, id: number) {
  const row = await d.select().from(schema.flows).where(eq(schema.flows.id, id)).get()
  return row ? parseFlow(row) : null
}

export function buildMcpServer(env: Env): McpServer {
  const d = createDb(env.DB)
  const server = new McpServer({ name: 'sokuto', version: '0.1.0' })

  server.registerTool('get_overview', { title: 'Overview', description: 'Bot name, configured channels, live flows and key numbers for the last 7 days.' }, async () => {
    const since7 = new Date(Date.now() - 7 * 86400_000).toISOString()
    const [contacts, new7, msgIn, msgOut, flowsLive] = await Promise.all([
      d.select({ n: sql<number>`count(*)` }).from(schema.contacts).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.contacts).where(gte(schema.contacts.createdAt, since7)).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(eq(schema.messages.direction, 'in'), gte(schema.messages.createdAt, since7))).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(eq(schema.messages.direction, 'out'), gte(schema.messages.createdAt, since7))).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.flows).where(eq(schema.flows.status, 'live')).get(),
    ])
    return json({ general: await getGeneral(d), channels: await configuredChannels(d), contacts: contacts?.n ?? 0, newContacts7d: new7?.n ?? 0, messagesIn7d: msgIn?.n ?? 0, messagesOut7d: msgOut?.n ?? 0, flowsLive: flowsLive?.n ?? 0 })
  })

  server.registerTool('get_flow_schema', { title: 'Flow JSON schema', description: 'Read this before creating or editing a flow. Explains triggers, steps, placeholders and best practices.' }, async () => ({ content: [{ type: 'text', text: FLOW_SCHEMA_DOC }] }))

  server.registerTool('list_templates', { title: 'List templates', description: 'Ready-made flow definitions you can copy or adapt.' }, async () => json(TEMPLATES))

  server.registerTool('list_flows', { title: 'List flows', description: 'All automations and sequences with kind (flow/sequence), status (draft/live), channel and trigger summary.' }, async () => {
    const rows = await d.select().from(schema.flows).orderBy(desc(schema.flows.updatedAt))
    return json(rows.map(parseFlow).map((f) => ({ id: f.id, name: f.name, kind: f.kind, channel: f.channel, status: f.status, triggers: f.definition.triggers, steps: f.definition.steps.length, updatedAt: f.updatedAt })))
  })

  server.registerTool('get_flow', { title: 'Get flow', description: 'Full definition of one flow.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    const flow = await flowById(d, id)
    return flow ? json(flow) : fail('not_found')
  })

  server.registerTool(
    'create_flow',
    {
      title: 'Create flow',
      description: 'Creates a flow as a DRAFT. Validate mentally against get_flow_schema first; then call test_flow, and publish_flow when it works. kind "sequence" makes a drip sequence (no triggers; see Sequences in get_flow_schema); the kind cannot be changed later.',
      inputSchema: { name: z.string().min(1), channel: flowChannelSchema.default('any'), kind: flowKindSchema.default('flow'), definition: z.unknown() },
    },
    async ({ name, channel, kind, definition }) => {
      const v = validateFlow(definition, kind)
      if (!v.ok) return fail('invalid_definition', v.errors)
      const row = await d.insert(schema.flows).values({ name, channel, kind, definition: JSON.stringify(v.definition) }).returning().get()
      return json({ flow: parseFlow(row!), warnings: v.warnings })
    },
  )

  server.registerTool(
    'update_flow',
    { title: 'Update flow', description: 'Replaces name, channel and/or definition of an existing flow. Live flows stay live.', inputSchema: { id: z.number().int(), name: z.string().min(1).optional(), channel: flowChannelSchema.optional(), definition: z.unknown().optional() } },
    async ({ id, name, channel, definition }) => {
      const flow = await flowById(d, id)
      if (!flow) return fail('not_found')
      const patch: Partial<typeof schema.flows.$inferInsert> = { updatedAt: new Date().toISOString() }
      let warnings: string[] = []
      if (name) patch.name = name
      if (channel) patch.channel = channel
      if (definition !== undefined) {
        const v = validateFlow(definition, flow.kind)
        if (!v.ok) return fail('invalid_definition', v.errors)
        patch.definition = JSON.stringify(v.definition)
        warnings = v.warnings
      }
      const row = await d.update(schema.flows).set(patch).where(eq(schema.flows.id, id)).returning().get()
      return json({ flow: parseFlow(row!), warnings })
    },
  )

  server.registerTool('publish_flow', { title: 'Publish flow', description: 'Makes a flow live so it answers real customers.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    const flow = await flowById(d, id)
    if (!flow) return fail('not_found')
    const v = validateFlow(flow.definition, flow.kind)
    if (!v.ok) return fail('invalid_definition', v.errors)
    await d.update(schema.flows).set({ status: 'live', updatedAt: new Date().toISOString() }).where(eq(schema.flows.id, id))
    return json({ ok: true, warnings: v.warnings })
  })

  server.registerTool('unpublish_flow', { title: 'Unpublish flow', description: 'Turns a flow back into a draft. For a sequence this also removes everyone enrolled.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    await d.update(schema.flows).set({ status: 'draft', updatedAt: new Date().toISOString() }).where(eq(schema.flows.id, id))
    await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, id))
    return json({ ok: true })
  })

  server.registerTool('delete_flow', { title: 'Delete flow', description: 'Deletes a flow permanently.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    await d.delete(schema.flows).where(eq(schema.flows.id, id))
    await d.delete(schema.sessions).where(eq(schema.sessions.flowId, id))
    await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, id))
    return json({ ok: true })
  })

  server.registerTool(
    'test_flow',
    {
      title: 'Test flow',
      description: 'Plays a conversation against a flow as a customer would. Nothing is sent to LINE or Meta. Inputs: messages, comments, follows, button taps (button: "label"), and { type: "start" } to run from the entry without a trigger (use it to play a sequence; delays are skipped).',
      inputSchema: {
        id: z.number().int(),
        inputs: z.array(z.object({ type: z.enum(['start', 'message', 'comment', 'follow', 'postback', 'ref', 'story_mention', 'story_reply']).default('message'), text: z.string().optional(), button: z.string().optional(), payload: z.string().optional(), ref: z.string().optional() })),
        channel: z.enum(['line', 'messenger', 'instagram']).optional(),
        newContact: z.boolean().default(true),
      },
    },
    async ({ id, inputs, channel, newContact }) => {
      const flow = await flowById(d, id)
      if (!flow) return fail('not_found')
      const { botFields, timezone } = await getGeneral(d)
      return json(await simulateFlow(d, flow, inputs, channel, newContact, { botFields, timezone }))
    },
  )

  server.registerTool(
    'list_contacts',
    { title: 'List contacts', description: 'Search contacts by name, tag or channel.', inputSchema: { query: z.string().optional(), tag: z.string().optional(), channel: z.enum(['line', 'messenger', 'instagram']).optional(), limit: z.number().int().min(1).max(200).default(50) } },
    async ({ query, tag, channel, limit }) => {
      const conds = []
      if (query) conds.push(sql`(${schema.contacts.displayName} like ${'%' + query + '%'} or ${schema.contacts.fields} like ${'%' + query + '%'})`)
      if (channel) conds.push(eq(schema.contacts.channel, channel))
      if (tag) conds.push(sql`${schema.contacts.id} in (select contact_id from contact_tags where tag = ${tag})`)
      const rows = await d.select().from(schema.contacts).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.contacts.updatedAt)).limit(limit)
      const out = []
      for (const r of rows) out.push({ id: r.id, channel: r.channel, name: r.displayName, username: r.username, fields: parseFields(r), tags: await getTags(d, r.id), botPaused: Boolean(r.botPaused), lastInboundAt: r.lastInboundAt, createdAt: r.createdAt })
      return json(out)
    },
  )

  server.registerTool('get_contact', { title: 'Get contact', description: 'One contact with fields, tags, sequence enrollments and recent messages.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    const r = await d.select().from(schema.contacts).where(eq(schema.contacts.id, id)).get()
    if (!r) return fail('not_found')
    const messages = await d.select().from(schema.messages).where(eq(schema.messages.contactId, id)).orderBy(desc(schema.messages.id)).limit(30)
    return json({ id: r.id, channel: r.channel, name: r.displayName, username: r.username, fields: parseFields(r), tags: await getTags(d, r.id), botPaused: Boolean(r.botPaused), sequences: await contactSequences(d, r.id), messages: messages.reverse().map((m) => ({ at: m.createdAt, direction: m.direction, source: m.source, kind: m.kind, text: m.text, error: m.error })) })
  })

  server.registerTool('tag_contact', { title: 'Add / remove tag', description: 'Adds or removes a tag on a contact.', inputSchema: { id: z.number().int(), tag: z.string().min(1), remove: z.boolean().default(false) } }, async ({ id, tag, remove }) => {
    if (remove) await removeTag(d, id, tag)
    else await addTag(d, id, tag)
    return json({ tags: await getTags(d, id) })
  })

  server.registerTool('set_bot_paused', { title: 'Pause / resume bot for a contact', description: 'Pauses automations for one contact (hand over to a person) or resumes them.', inputSchema: { id: z.number().int(), paused: z.boolean() } }, async ({ id, paused }) => {
    await setBotPaused(d, id, paused)
    return json({ ok: true })
  })

  server.registerTool('list_conversations', { title: 'List conversations', description: 'Recent conversations with the last message. filter: all | unread | paused.', inputSchema: { filter: z.enum(['all', 'unread', 'paused']).default('all'), limit: z.number().int().min(1).max(100).default(30) } }, async ({ filter, limit }) => {
    const rows = await d
      .select()
      .from(schema.contacts)
      .where(filter === 'paused' ? eq(schema.contacts.botPaused, 1) : filter === 'unread' ? sql`${schema.contacts.unread} > 0` : undefined)
      .orderBy(desc(sql`coalesce(${schema.contacts.lastInboundAt}, ${schema.contacts.createdAt})`))
      .limit(limit)
    const out = []
    for (const r of rows) {
      const last = await d.select().from(schema.messages).where(eq(schema.messages.contactId, r.id)).orderBy(desc(schema.messages.id)).limit(1).get()
      out.push({ contactId: r.id, name: r.displayName, channel: r.channel, unread: r.unread, botPaused: Boolean(r.botPaused), lastMessage: last ? { at: last.createdAt, direction: last.direction, text: last.text } : null })
    }
    return json(out)
  })

  server.registerTool('send_message', { title: 'Send message', description: 'Sends a text message to a contact as a human reply. Pauses automations for that contact unless keepBot is true. Meta channels only allow this within 24h of the person\'s last message.', inputSchema: { contactId: z.number().int(), text: z.string().min(1), keepBot: z.boolean().default(false) } }, async ({ contactId, text, keepBot }) => {
    const contact = await d.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get()
    if (!contact) return fail('not_found')
    const adapter = await getAdapter(env, d, contact.channel as Channel)
    if (!adapter) return fail('channel_not_configured')
    const res = await adapter.send(contact.channelUserId, { text })
    await logMessage(d, { contactId, direction: 'out', source: 'human', kind: 'text', text, error: res.ok ? undefined : res.error })
    if (!keepBot) await setBotPaused(d, contactId, true)
    return res.ok ? json({ ok: true }) : fail(res.error)
  })

  server.registerTool('get_reports', { title: 'Reports', description: 'Per-flow numbers (started, messages, button clicks, inputs, completed, errors) and daily message counts.', inputSchema: { days: z.number().int().min(1).max(90).default(7) } }, async ({ days }) => {
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    const byFlow = await d.select({ flowId: schema.events.flowId, type: schema.events.type, n: sql<number>`count(*)` }).from(schema.events).where(gte(schema.events.createdAt, since)).groupBy(schema.events.flowId, schema.events.type)
    const flows = (await d.select().from(schema.flows)).map(parseFlow)
    const perFlow = flows.map((f) => {
      const counts: Record<string, number> = {}
      for (const r of byFlow) if (r.flowId === f.id) counts[r.type] = r.n
      return { id: f.id, name: f.name, status: f.status, started: counts.trigger_fired ?? 0, messagesSent: counts.step_sent ?? 0, buttonClicks: counts.button_clicked ?? 0, inputs: counts.input_saved ?? 0, completed: counts.flow_completed ?? 0, errors: counts.error ?? 0 }
    })
    const daily = await d.select({ day: sql<string>`substr(${schema.messages.createdAt}, 1, 10)`, direction: schema.messages.direction, n: sql<number>`count(*)` }).from(schema.messages).where(gte(schema.messages.createdAt, since)).groupBy(sql`substr(${schema.messages.createdAt}, 1, 10)`, schema.messages.direction)
    const errors = await d.select().from(schema.events).where(and(eq(schema.events.type, 'error'), gte(schema.events.createdAt, since))).orderBy(desc(schema.events.id)).limit(20)
    return json({ days, flows: perFlow, daily, recentErrors: errors.map((e) => ({ at: e.createdAt, flowId: e.flowId, stepId: e.stepId, meta: e.meta })) })
  })

  server.registerTool('broadcast_reach', { title: 'Broadcast reach', description: 'How many contacts a broadcast would reach now (Meta: only people active in the last 24h). segmentId (from list_segments) replaces tag.', inputSchema: { channel: flowChannelSchema.default('any'), tag: z.string().optional(), segmentId: z.number().int().optional() } }, async ({ channel, tag, segmentId }) => {
    if (segmentId !== undefined && !(await loadSegment(d, segmentId))) return fail('invalid_segment')
    return json(await broadcastReach(d, channel, tag ?? null, segmentId ?? null))
  })

  server.registerTool('create_broadcast', { title: 'Create broadcast', description: 'Schedules a message to everyone with a tag, everyone in a segment (segmentId from list_segments; replaces tag), or everyone. Sent by the minute-ly scheduler.', inputSchema: { name: z.string().optional(), channel: flowChannelSchema.default('any'), tag: z.string().optional(), segmentId: z.number().int().optional(), text: z.string().min(1), scheduledAt: z.string().datetime().optional() } }, async ({ name, channel, tag, segmentId, text, scheduledAt }) => {
    if (segmentId !== undefined && !(await loadSegment(d, segmentId))) return fail('invalid_segment')
    const row = await d.insert(schema.broadcasts).values({ name: name ?? text.slice(0, 30), channel, tag: segmentId !== undefined ? null : tag ?? null, segmentId: segmentId ?? null, text, scheduledAt: scheduledAt ?? new Date().toISOString() }).returning().get()
    return json(row)
  })

  server.registerTool('list_segments', { title: 'List segments', description: 'Saved contact filters (condition rules + all/any mode). Use the id as segmentId in broadcast_reach / create_broadcast.' }, async () => {
    const rows = await d.select().from(schema.segments).orderBy(desc(schema.segments.id))
    return json(rows.map(parseSegment))
  })

  server.registerTool(
    'create_segment',
    { title: 'Create segment', description: 'Saves condition rules as a segment for filtering contacts and targeting broadcasts. Rules use the condition step format from get_flow_schema (e.g. { "field": "tag", "op": "has_tag", "value": "vip" }); mode "all" (default) or "any".', inputSchema: segmentInputSchema.shape },
    async ({ name, rules, mode }) => {
      const row = await d.insert(schema.segments).values({ name, rules: JSON.stringify(rules), mode }).returning().get()
      return json(parseSegment(row!))
    },
  )

  server.registerTool('delete_segment', { title: 'Delete segment', description: 'Deletes a segment. Scheduled broadcasts that target it will reach nobody.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    if (!(await loadSegment(d, id))) return fail('not_found')
    await d.delete(schema.segments).where(eq(schema.segments.id, id))
    return json({ ok: true })
  })

  server.registerTool(
    'subscribe_sequence',
    { title: 'Subscribe to / unsubscribe from a sequence', description: 'Enrolls a contact in a live sequence (the first step runs within a minute) or removes them with remove: true. A contact can be enrolled in a sequence only once at a time.', inputSchema: { contactId: z.number().int(), flowId: z.number().int(), remove: z.boolean().default(false) } },
    async ({ contactId, flowId, remove }) => {
      const contact = await d.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get()
      if (!contact) return fail('not_found')
      if (remove) await unsubscribeSequence(d, contactId, flowId)
      else {
        const res = await subscribeSequence(d, contact, flowId)
        if (res !== 'ok') return fail(res)
      }
      return json({ sequences: await contactSequences(d, contactId) })
    },
  )

  server.registerTool('list_notifications', { title: 'Notifications', description: 'Recent notifications created by "notify" actions and hand-over requests.', inputSchema: { unreadOnly: z.boolean().default(true) } }, async ({ unreadOnly }) => {
    const rows = await d.select().from(schema.notifications).where(unreadOnly ? eq(schema.notifications.read, 0) : undefined).orderBy(desc(schema.notifications.id)).limit(50)
    return json(rows)
  })

  return server
}

mcpRoutes.all('/', async (c) => {
  if (!(await checkBearer(c))) {
    return c.json({ error: 'unauthorized', hint: 'Send "Authorization: Bearer <token>" with the token from Settings → AI (MCP).' }, 401, { 'WWW-Authenticate': 'Bearer realm="sokuto"' })
  }
  const server = buildMcpServer(c.env)
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(c)
})
