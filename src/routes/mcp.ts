import { Hono } from 'hono'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { checkBearer, type AppEnv } from '../auth'
import { createDb, schema, type Db } from '../db'
import type { Env } from '../env'
import { botConfigSchema, configuredChannels, getBotConfig, getGeneral, getSetting, putBotConfig, type AiConfig } from '../settings'
import { lazyAi } from '../ai'
import { addTag, getContact, getTags, inboxWhere, ofWorkspace, parseFields, removeTag, setBotPaused } from '../contacts'
import { contactSequences, logMessage, parseFlow, subscribeSequence, unsubscribeSequence } from '../flows/engine'
import { TEMPLATES } from '../flows/templates'
import { FLOW_SCHEMA_DOC, broadcastButtonsSchema, flowChannelSchema, flowKindSchema, messageTagSchema, segmentInputSchema, validateFlow } from '../flows/validate'
import { simulateFlow } from '../flows/simulate'
import { getAdapter } from '../channels/registry'
import type { Channel } from '../channels/types'
import { broadcastReach } from '../scheduler'
import { loadSegment, parseSegment } from '../segments'
import { getWorkspace } from '../workspaces'
import { addDocument, botOverview, deleteDocument, deleteFaq, deleteProduct, listFaqs, listProducts, productInputSchema, saveFaq, saveProduct } from '../bot'

export const mcpRoutes = new Hono<AppEnv>()

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const fail = (message: string, extra?: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...(extra ? { details: extra } : {}) }, null, 2) }], isError: true })

async function flowById(d: Db, ws: number, id: number) {
  const row = await d.select().from(schema.flows).where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws))).get()
  return row ? parseFlow(row) : null
}

/** MCP tools for workspace `ws` (the token's workspace): nothing outside it is visible or writable. */
export function buildMcpServer(env: Env, ws: number): McpServer {
  const d = createDb(env.DB)
  const server = new McpServer({ name: 'sokuto', version: '0.1.0' })

  server.registerTool('get_overview', { title: 'Overview', description: 'Workspace, bot name, configured channels, AI provider (needed by ai steps, intent triggers and Soku), Soku (the reply bot) on/off, live flows and key numbers for the last 7 days.' }, async () => {
    const since7 = new Date(Date.now() - 7 * 86400_000).toISOString()
    const inWs = eq(schema.contacts.workspaceId, ws)
    const msgInWs = ofWorkspace(schema.messages.contactId, ws)
    const [workspace, contacts, new7, msgIn, msgOut, flowsLive] = await Promise.all([
      getWorkspace(d, ws),
      d.select({ n: sql<number>`count(*)` }).from(schema.contacts).where(inWs).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.contacts).where(and(inWs, gte(schema.contacts.createdAt, since7))).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(msgInWs, eq(schema.messages.direction, 'in'), gte(schema.messages.createdAt, since7))).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(msgInWs, eq(schema.messages.direction, 'out'), gte(schema.messages.createdAt, since7))).get(),
      d.select({ n: sql<number>`count(*)` }).from(schema.flows).where(and(eq(schema.flows.workspaceId, ws), eq(schema.flows.status, 'live'))).get(),
    ])
    // The settings row as stored: provider only, the API key stays encrypted.
    const aiCfg = await getSetting<AiConfig>(d, ws, 'ai')
    const bot = await getBotConfig(d, ws)
    return json({ workspace: { id: ws, name: workspace?.name }, general: await getGeneral(d, ws), channels: await configuredChannels(d, ws), ai: aiCfg ? { configured: true, provider: aiCfg.provider } : { configured: false }, bot: { enabled: bot.enabled, name: bot.name }, contacts: contacts?.n ?? 0, newContacts7d: new7?.n ?? 0, messagesIn7d: msgIn?.n ?? 0, messagesOut7d: msgOut?.n ?? 0, flowsLive: flowsLive?.n ?? 0 })
  })

  server.registerTool('get_flow_schema', { title: 'Flow JSON schema', description: 'Read this before creating or editing a flow. Explains triggers, steps, placeholders and best practices.' }, async () => ({ content: [{ type: 'text', text: FLOW_SCHEMA_DOC }] }))

  server.registerTool('list_templates', { title: 'List templates', description: 'Ready-made flow definitions you can copy or adapt.' }, async () => json(TEMPLATES))

  server.registerTool('list_flows', { title: 'List flows', description: 'All automations and sequences with kind (flow/sequence), status (draft/live), channel and trigger summary.' }, async () => {
    const rows = await d.select().from(schema.flows).where(eq(schema.flows.workspaceId, ws)).orderBy(desc(schema.flows.updatedAt))
    return json(rows.map(parseFlow).map((f) => ({ id: f.id, name: f.name, kind: f.kind, channel: f.channel, status: f.status, triggers: f.definition.triggers, steps: f.definition.steps.length, updatedAt: f.updatedAt })))
  })

  server.registerTool('get_flow', { title: 'Get flow', description: 'Full definition of one flow.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    const flow = await flowById(d, ws, id)
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
      const row = await d.insert(schema.flows).values({ workspaceId: ws, name, channel, kind, definition: JSON.stringify(v.definition) }).returning().get()
      return json({ flow: parseFlow(row!), warnings: v.warnings })
    },
  )

  server.registerTool(
    'update_flow',
    { title: 'Update flow', description: 'Replaces name, channel and/or definition of an existing flow. Live flows stay live.', inputSchema: { id: z.number().int(), name: z.string().min(1).optional(), channel: flowChannelSchema.optional(), definition: z.unknown().optional() } },
    async ({ id, name, channel, definition }) => {
      const flow = await flowById(d, ws, id)
      if (!flow) return fail('not_found')
      const patch: Partial<typeof schema.flows.$inferInsert> = { updatedAt: new Date().toISOString() }
      let warnings: string[] = []
      if (name) patch.name = name
      if (channel) patch.channel = channel
      if (definition !== undefined) {
        const v = validateFlow(definition, flow.kind)
        if (!v.ok) return fail('invalid_definition', v.errors)
        // A definition without canvas positions (e.g. edited over MCP) keeps the stored ones.
        patch.definition = JSON.stringify({ ...v.definition, layout: v.definition.layout ?? flow.definition.layout })
        warnings = v.warnings
      }
      const row = await d.update(schema.flows).set(patch).where(eq(schema.flows.id, id)).returning().get()
      return json({ flow: parseFlow(row!), warnings })
    },
  )

  server.registerTool('publish_flow', { title: 'Publish flow', description: 'Makes a flow live so it answers real customers.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    const flow = await flowById(d, ws, id)
    if (!flow) return fail('not_found')
    const v = validateFlow(flow.definition, flow.kind)
    if (!v.ok) return fail('invalid_definition', v.errors)
    await d.update(schema.flows).set({ status: 'live', updatedAt: new Date().toISOString() }).where(eq(schema.flows.id, id))
    return json({ ok: true, warnings: v.warnings })
  })

  server.registerTool('unpublish_flow', { title: 'Unpublish flow', description: 'Turns a flow back into a draft. For a sequence this also removes everyone enrolled.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    if (!(await flowById(d, ws, id))) return fail('not_found')
    await d.update(schema.flows).set({ status: 'draft', updatedAt: new Date().toISOString() }).where(eq(schema.flows.id, id))
    await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, id))
    return json({ ok: true })
  })

  server.registerTool('delete_flow', { title: 'Delete flow', description: 'Deletes a flow permanently.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    if (!(await flowById(d, ws, id))) return fail('not_found')
    await d.delete(schema.flows).where(eq(schema.flows.id, id))
    await d.delete(schema.sessions).where(eq(schema.sessions.flowId, id))
    await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, id))
    return json({ ok: true })
  })

  server.registerTool(
    'test_flow',
    {
      title: 'Test flow',
      description: 'Plays a conversation against a flow as a customer would. Nothing is sent to LINE or Meta. Inputs: messages, comments, follows, button taps (button: "label"), and { type: "start" } to run from the entry without a trigger (use it to play a sequence; delays are skipped). External request steps are not called: they are listed in notes. AI steps and intent triggers DO call the AI provider configured in Settings (each turn / classification is billed by the provider); without one, ai steps are skipped with a note.',
      inputSchema: {
        id: z.number().int(),
        inputs: z.array(z.object({ type: z.enum(['start', 'message', 'comment', 'follow', 'postback', 'ref', 'story_mention', 'story_reply']).default('message'), text: z.string().optional(), button: z.string().optional(), payload: z.string().optional(), ref: z.string().optional() })),
        channel: z.enum(['line', 'messenger', 'instagram']).optional(),
        newContact: z.boolean().default(true),
      },
    },
    async ({ id, inputs, channel, newContact }) => {
      const flow = await flowById(d, ws, id)
      if (!flow) return fail('not_found')
      const { botFields, timezone } = await getGeneral(d, ws)
      return json(await simulateFlow(d, flow, inputs, channel, newContact, { botFields, timezone, ai: lazyAi(env, d, ws) }))
    },
  )

  server.registerTool(
    'list_contacts',
    { title: 'List contacts', description: 'Search contacts by name, tag or channel.', inputSchema: { query: z.string().optional(), tag: z.string().optional(), channel: z.enum(['line', 'messenger', 'instagram']).optional(), limit: z.number().int().min(1).max(200).default(50) } },
    async ({ query, tag, channel, limit }) => {
      const conds = [eq(schema.contacts.workspaceId, ws)]
      if (query) conds.push(sql`(${schema.contacts.displayName} like ${'%' + query + '%'} or ${schema.contacts.fields} like ${'%' + query + '%'})`)
      if (channel) conds.push(eq(schema.contacts.channel, channel))
      if (tag) conds.push(sql`${schema.contacts.id} in (select contact_id from contact_tags where tag = ${tag})`)
      const rows = await d.select().from(schema.contacts).where(and(...conds)).orderBy(desc(schema.contacts.updatedAt)).limit(limit)
      const out = []
      for (const r of rows) out.push({ id: r.id, channel: r.channel, name: r.displayName, username: r.username, fields: parseFields(r), tags: await getTags(d, r.id), botPaused: Boolean(r.botPaused), lastInboundAt: r.lastInboundAt, createdAt: r.createdAt })
      return json(out)
    },
  )

  server.registerTool('get_contact', { title: 'Get contact', description: 'One contact with status (open/closed), internal notes, fields, tags, sequence enrollments and recent messages.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    const r = await getContact(d, ws, id)
    if (!r) return fail('not_found')
    const messages = await d.select().from(schema.messages).where(eq(schema.messages.contactId, id)).orderBy(desc(schema.messages.id)).limit(30)
    return json({ id: r.id, channel: r.channel, name: r.displayName, username: r.username, fields: parseFields(r), tags: await getTags(d, r.id), botPaused: Boolean(r.botPaused), status: r.status, notes: r.notes, sequences: await contactSequences(d, r.id), messages: messages.reverse().map((m) => ({ at: m.createdAt, direction: m.direction, source: m.source, kind: m.kind, text: m.text, error: m.error })) })
  })

  server.registerTool('tag_contact', { title: 'Add / remove tag', description: 'Adds or removes a tag on a contact.', inputSchema: { id: z.number().int(), tag: z.string().min(1), remove: z.boolean().default(false) } }, async ({ id, tag, remove }) => {
    if (!(await getContact(d, ws, id))) return fail('not_found')
    if (remove) await removeTag(d, id, tag)
    else await addTag(d, id, tag)
    return json({ tags: await getTags(d, id) })
  })

  server.registerTool('set_bot_paused', { title: 'Pause / resume bot for a contact', description: 'Pauses automations for one contact (hand over to a person) or resumes them.', inputSchema: { id: z.number().int(), paused: z.boolean() } }, async ({ id, paused }) => {
    if (!(await getContact(d, ws, id))) return fail('not_found')
    await setBotPaused(d, id, paused)
    return json({ ok: true })
  })

  server.registerTool('list_conversations', { title: 'List conversations', description: 'Recent conversations with the last message. filter: all | open | unread | paused (bot paused, a person is replying) | closed.', inputSchema: { filter: z.enum(['all', 'open', 'unread', 'paused', 'closed']).default('all'), limit: z.number().int().min(1).max(100).default(30) } }, async ({ filter, limit }) => {
    const rows = await d
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, ws), inboxWhere(filter)))
      .orderBy(desc(sql`coalesce(${schema.contacts.lastInboundAt}, ${schema.contacts.createdAt})`))
      .limit(limit)
    const out = []
    for (const r of rows) {
      const last = await d.select().from(schema.messages).where(eq(schema.messages.contactId, r.id)).orderBy(desc(schema.messages.id)).limit(1).get()
      out.push({ contactId: r.id, name: r.displayName, channel: r.channel, status: r.status, unread: r.unread, botPaused: Boolean(r.botPaused), lastMessage: last ? { at: last.createdAt, direction: last.direction, text: last.text } : null })
    }
    return json(out)
  })

  server.registerTool('send_message', { title: 'Send message', description: 'Sends a text message to a contact as a human reply. Pauses automations for that contact unless keepBot is true. Meta channels only allow this within 24h of the person\'s last message.', inputSchema: { contactId: z.number().int(), text: z.string().min(1), keepBot: z.boolean().default(false) } }, async ({ contactId, text, keepBot }) => {
    const contact = await getContact(d, ws, contactId)
    if (!contact) return fail('not_found')
    const adapter = await getAdapter(env, d, ws, contact.channel as Channel)
    if (!adapter) return fail('channel_not_configured')
    const res = await adapter.send(contact.channelUserId, { text })
    await logMessage(d, { contactId, direction: 'out', source: 'human', kind: 'text', text, error: res.ok ? undefined : res.error })
    if (!keepBot) await setBotPaused(d, contactId, true)
    return res.ok ? json({ ok: true }) : fail(res.error)
  })

  server.registerTool('get_reports', { title: 'Reports', description: 'Per-flow numbers (started, messages, button clicks, inputs, completed, errors) and daily message counts.', inputSchema: { days: z.number().int().min(1).max(90).default(7) } }, async ({ days }) => {
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    const inWs = eq(schema.events.workspaceId, ws)
    const byFlow = await d.select({ flowId: schema.events.flowId, type: schema.events.type, n: sql<number>`count(*)` }).from(schema.events).where(and(inWs, gte(schema.events.createdAt, since))).groupBy(schema.events.flowId, schema.events.type)
    const flows = (await d.select().from(schema.flows).where(eq(schema.flows.workspaceId, ws))).map(parseFlow)
    const perFlow = flows.map((f) => {
      const counts: Record<string, number> = {}
      for (const r of byFlow) if (r.flowId === f.id) counts[r.type] = r.n
      return { id: f.id, name: f.name, status: f.status, started: counts.trigger_fired ?? 0, messagesSent: counts.step_sent ?? 0, buttonClicks: counts.button_clicked ?? 0, inputs: counts.input_saved ?? 0, completed: counts.flow_completed ?? 0, errors: counts.error ?? 0 }
    })
    const daily = await d.select({ day: sql<string>`substr(${schema.messages.createdAt}, 1, 10)`, direction: schema.messages.direction, n: sql<number>`count(*)` }).from(schema.messages).where(and(ofWorkspace(schema.messages.contactId, ws), gte(schema.messages.createdAt, since))).groupBy(sql`substr(${schema.messages.createdAt}, 1, 10)`, schema.messages.direction)
    const errors = await d.select().from(schema.events).where(and(inWs, eq(schema.events.type, 'error'), gte(schema.events.createdAt, since))).orderBy(desc(schema.events.id)).limit(20)
    return json({ days, flows: perFlow, daily, recentErrors: errors.map((e) => ({ at: e.createdAt, flowId: e.flowId, stepId: e.stepId, meta: e.meta })) })
  })

  server.registerTool('broadcast_reach', { title: 'Broadcast reach', description: 'How many contacts a broadcast would reach now (Meta: only people active in the last 24h, or everyone with messageTag: true). segmentId (from list_segments) replaces tag.', inputSchema: { channel: flowChannelSchema.default('any'), tag: z.string().optional(), segmentId: z.number().int().optional(), messageTag: z.boolean().optional() } }, async ({ channel, tag, segmentId, messageTag }) => {
    if (segmentId !== undefined && !(await loadSegment(d, ws, segmentId))) return fail('invalid_segment')
    return json(await broadcastReach(d, ws, channel, tag ?? null, segmentId ?? null, messageTag ?? false))
  })

  server.registerTool(
    'create_broadcast',
    {
      title: 'Create broadcast',
      description:
        'Schedules a message to everyone with a tag, everyone in a segment (segmentId from list_segments; replaces tag), or everyone. Sent by the minute-ly scheduler. Up to 3 buttons, each { label, url } or { label, flowId } (a live automation started on tap; taps are counted in "clicked"). messageTag lets Messenger / Instagram reach people outside the 24h window, but Meta only allows it for event confirmations, post-purchase updates and account updates, never promotions; LINE ignores it.',
      inputSchema: { name: z.string().optional(), channel: flowChannelSchema.default('any'), tag: z.string().optional(), segmentId: z.number().int().optional(), text: z.string().min(1), imageUrl: z.string().url().optional(), buttons: broadcastButtonsSchema.optional(), messageTag: messageTagSchema.optional(), scheduledAt: z.string().datetime().optional() },
    },
    async ({ name, channel, tag, segmentId, text, imageUrl, buttons, messageTag, scheduledAt }) => {
      if (segmentId !== undefined && !(await loadSegment(d, ws, segmentId))) return fail('invalid_segment')
      const row = await d
        .insert(schema.broadcasts)
        .values({ workspaceId: ws, name: name ?? text.slice(0, 30), channel, tag: segmentId !== undefined ? null : tag ?? null, segmentId: segmentId ?? null, text, imageUrl: imageUrl ?? null, buttons: buttons?.length ? JSON.stringify(buttons) : null, messageTag: messageTag ?? null, scheduledAt: scheduledAt ?? new Date().toISOString() })
        .returning()
        .get()
      return json(row)
    },
  )

  server.registerTool('list_segments', { title: 'List segments', description: 'Saved contact filters (condition rules + all/any mode). Use the id as segmentId in broadcast_reach / create_broadcast.' }, async () => {
    const rows = await d.select().from(schema.segments).where(eq(schema.segments.workspaceId, ws)).orderBy(desc(schema.segments.id))
    return json(rows.map(parseSegment))
  })

  server.registerTool(
    'create_segment',
    { title: 'Create segment', description: 'Saves condition rules as a segment for filtering contacts and targeting broadcasts. Rules use the condition step format from get_flow_schema (e.g. { "field": "tag", "op": "has_tag", "value": "vip" }); mode "all" (default) or "any".', inputSchema: segmentInputSchema.shape },
    async ({ name, rules, mode }) => {
      const row = await d.insert(schema.segments).values({ workspaceId: ws, name, rules: JSON.stringify(rules), mode }).returning().get()
      return json(parseSegment(row!))
    },
  )

  server.registerTool('delete_segment', { title: 'Delete segment', description: 'Deletes a segment. Scheduled broadcasts that target it will reach nobody.', inputSchema: { id: z.number().int() } }, async ({ id }) => {
    if (!(await loadSegment(d, ws, id))) return fail('not_found')
    await d.delete(schema.segments).where(eq(schema.segments.id, id))
    return json({ ok: true })
  })

  server.registerTool(
    'subscribe_sequence',
    { title: 'Subscribe to / unsubscribe from a sequence', description: 'Enrolls a contact in a live sequence (the first step runs within a minute) or removes them with remove: true. A contact can be enrolled in a sequence only once at a time.', inputSchema: { contactId: z.number().int(), flowId: z.number().int(), remove: z.boolean().default(false) } },
    async ({ contactId, flowId, remove }) => {
      const contact = await getContact(d, ws, contactId)
      if (!contact) return fail('not_found')
      if (remove) await unsubscribeSequence(d, contactId, flowId)
      else {
        const res = await subscribeSequence(d, contact, flowId)
        if (res !== 'ok') return fail(res)
      }
      return json({ sequences: await contactSequences(d, contactId) })
    },
  )

  server.registerTool(
    'update_contact',
    {
      title: 'Update contact',
      description: 'Closes or reopens a conversation (status; a new message from the person reopens it), replaces the internal notes (not visible to the customer; empty string clears them) and/or renames the contact.',
      inputSchema: { id: z.number().int(), status: z.enum(['open', 'closed']).optional(), notes: z.string().trim().max(5000).optional(), displayName: z.string().optional() },
    },
    async ({ id, status, notes, displayName }) => {
      const patch: Partial<typeof schema.contacts.$inferInsert> = { updatedAt: new Date().toISOString() }
      if (status) patch.status = status
      if (notes !== undefined) patch.notes = notes || null
      if (displayName !== undefined) patch.displayName = displayName
      const r = await d.update(schema.contacts).set(patch).where(and(eq(schema.contacts.id, id), eq(schema.contacts.workspaceId, ws))).returning().get()
      return r ? json({ id: r.id, name: r.displayName, status: r.status, notes: r.notes }) : fail('not_found')
    },
  )

  server.registerTool(
    'get_bot',
    {
      title: 'Get Soku (reply bot)',
      description:
        'Settings of Soku, the AI reply bot that answers text messages no live automation matched, using only the approved FAQs, ready documents and in-stock products, and hands the conversation to a person when it cannot answer. Also its last 30 days: conversations handled, replies, hand-overs (with reasons), resolution rate, top FAQs and products, knowledge counts.',
    },
    async () => json({ config: await getBotConfig(d, ws), overview: await botOverview(d, ws, 30, (await getSetting<AiConfig>(d, ws, 'ai')) !== null) }),
  )

  server.registerTool(
    'update_bot',
    {
      title: 'Update Soku',
      description:
        'Changes only the given settings. enabled: true makes Soku answer real customers (needs an AI provider; each reply is billed by the provider). persona: who Soku is and what the business sells. guidelines / guardrails: up to 20 short rules each (tone; things never to do). unknownAction: "handoff" (pass to a person with handoffMessage) or "fallback" (send fallbackMessage) when the knowledge has no answer. maxTurns: replies per contact in 24 hours before a person takes over. autoClose: close the conversation when the customer is done (resolveMessage is sent then, if set). segmentId: only contacts in this segment (null = everyone). suggestFaqs: propose FAQs from finished conversations. language: auto | ja | en.',
      inputSchema: botConfigSchema.partial().shape,
    },
    async (patch) => {
      const r = await putBotConfig(d, ws, patch)
      return 'errors' in r ? fail('invalid_bot_config', r.errors) : json(r)
    },
  )

  server.registerTool('list_faqs', { title: 'List FAQs', description: 'FAQs Soku answers from (approved) and suggestions waiting for review (suggested; made from conversations or documents, not used until approved).', inputSchema: { status: z.enum(['approved', 'suggested', 'all']).default('all') } }, async ({ status }) =>
    json(await listFaqs(d, ws, status)),
  )

  server.registerTool(
    'upsert_faq',
    { title: 'Create / update FAQ', description: 'Creates a FAQ, or updates one with id. Set status "approved" to approve a suggestion. question ≤ 500, answer ≤ 4000 characters. variants: up to 10 other phrasings of the question (≤ 500 characters each, no repeats), answered the same way; given on update, they replace the stored list.', inputSchema: { id: z.number().int().optional(), question: z.string(), variants: z.array(z.string()).optional(), answer: z.string(), status: z.enum(['approved', 'suggested']).optional() } },
    async ({ id, ...body }) => {
      const r = await saveFaq(d, ws, id ?? null, body)
      return 'faq' in r ? json(r.faq) : fail(r.error, r.errors)
    },
  )

  server.registerTool('delete_faq', { title: 'Delete FAQ', description: 'Deletes a FAQ (also how a suggestion is rejected).', inputSchema: { id: z.number().int() } }, async ({ id }) => ((await deleteFaq(d, ws, id)) ? json({ ok: true }) : fail('not_found')))

  server.registerTool('list_products', { title: 'List products', description: 'Products Soku can recommend as cards (in-stock ones only), searched by name, sku or tag.', inputSchema: { q: z.string().optional() } }, async ({ q }) => json(await listProducts(d, ws, q)))

  server.registerTool(
    'upsert_product',
    {
      title: 'Create / update product',
      description: 'Creates a product (name required), or updates the given fields of the one with id. price is an integer in the currency (JPY by default), url / imageUrl http(s) (a product needs url to be sent as a card), tags ≤ 20.',
      inputSchema: { id: z.number().int().optional(), ...productInputSchema.partial().shape },
    },
    async ({ id, ...body }) => {
      const r = await saveProduct(d, ws, id ?? null, body)
      return 'product' in r ? json(r.product) : fail(r.error, r.errors)
    },
  )

  server.registerTool('delete_product', { title: 'Delete product', description: 'Deletes a product.', inputSchema: { id: z.number().int() } }, async ({ id }) => ((await deleteProduct(d, ws, id)) ? json({ ok: true }) : fail('not_found')))

  server.registerTool(
    'add_document',
    { title: 'Add document', description: 'Adds knowledge for Soku: an https page (url; HTML or plain text, not PDF; fetched now, a failure is saved with status "failed") or pasted text (≤ 200,000 characters).', inputSchema: { name: z.string().optional(), url: z.string().optional(), text: z.string().optional() } },
    async (body) => {
      const r = await addDocument(d, ws, body)
      return 'document' in r ? json(r.document) : fail(r.error, r.errors)
    },
  )

  server.registerTool('delete_document', { title: 'Delete document', description: 'Deletes a document and the FAQ suggestions made from it (approved FAQs stay).', inputSchema: { id: z.number().int() } }, async ({ id }) =>
    (await deleteDocument(d, ws, id)) ? json({ ok: true }) : fail('not_found'),
  )

  server.registerTool('list_notifications', { title: 'Notifications', description: 'Recent notifications created by "notify" actions and hand-over requests.', inputSchema: { unreadOnly: z.boolean().default(true) } }, async ({ unreadOnly }) => {
    const rows = await d.select().from(schema.notifications).where(and(eq(schema.notifications.workspaceId, ws), unreadOnly ? eq(schema.notifications.read, 0) : undefined)).orderBy(desc(schema.notifications.id)).limit(50)
    return json(rows)
  })

  return server
}

mcpRoutes.all('/', async (c) => {
  const ws = await checkBearer(c)
  if (ws === null) {
    return c.json({ error: 'unauthorized', hint: 'Send "Authorization: Bearer <token>" with the token from Settings → AI (MCP).' }, 401, { 'WWW-Authenticate': 'Bearer realm="sokuto"' })
  }
  const server = buildMcpServer(c.env, ws)
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(c)
})
