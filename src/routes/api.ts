import { Hono } from 'hono'
import type { ZodError } from 'zod'
import { and, desc, eq, gte, like, or, sql } from 'drizzle-orm'
import type { AppEnv } from '../auth'
import { createDb, schema, type Db } from '../db'
import type { Env } from '../env'
import {
  configuredChannels,
  deleteChannelConfig,
  deleteSetting,
  getAiConfig,
  getChannelConfig,
  getGeneral,
  getOrCreateSecret,
  getSetting,
  lineRichMenuSchema,
  metaProfileSchema,
  putAiConfig,
  putChannelConfig,
  putSetting,
  type AiConfig,
  type GeneralSettings,
  type LineRichMenu,
  type MetaProfile,
} from '../settings'
import {
  buildRichMenu,
  lineBotInfo,
  lineClearDefaultRichMenu,
  lineCreateRichMenu,
  lineDeleteRichMenu,
  lineSetDefaultRichMenu,
  lineSetWebhook,
  lineTestWebhook,
  lineUploadRichMenuImage,
} from '../channels/line'
import { IG_PROFILE_FIELDS, PROFILE_FIELDS, buildMessengerProfile, metaDeleteProfile, metaInspectPageToken, metaSetProfile, metaSubscribePage } from '../channels/meta'
import { getAdapter } from '../channels/registry'
import type { Channel } from '../channels/types'
import { addTag, getTags, parseFields, removeTag, setBotPaused } from '../contacts'
import { contactSequences, logMessage, parseFlow, subscribeSequence, unsubscribeSequence } from '../flows/engine'
import { TEMPLATES } from '../flows/templates'
import { flowChannelSchema, flowKindSchema, segmentInputSchema, validateFlow } from '../flows/validate'
import { simulateFlow, type SimulatedInput } from '../flows/simulate'
import { broadcastReach, runScheduledTasks } from '../scheduler'
import { loadSegment, matchesSegment, parseSegment, tagsByContact } from '../segments'
import { randomToken, sha256Hex } from '../crypto'
import { complete } from '../ai'

export const apiRoutes = new Hono<AppEnv>()

const db = (env: Env) => createDb(env.DB)
const baseUrl = (url: string) => new URL(url).origin

/* ---------- Overview ---------- */
apiRoutes.get('/overview', async (c) => {
  const d = db(c.env)
  const since7 = new Date(Date.now() - 7 * 86400_000).toISOString()
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const [contacts, new7, msgIn7, msgOut7, flowsLive, notifications, events30] = await Promise.all([
    d.select({ n: sql<number>`count(*)` }).from(schema.contacts).get(),
    d.select({ n: sql<number>`count(*)` }).from(schema.contacts).where(gte(schema.contacts.createdAt, since7)).get(),
    d.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(eq(schema.messages.direction, 'in'), gte(schema.messages.createdAt, since7))).get(),
    d.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(eq(schema.messages.direction, 'out'), gte(schema.messages.createdAt, since7))).get(),
    d.select({ n: sql<number>`count(*)` }).from(schema.flows).where(eq(schema.flows.status, 'live')).get(),
    d.select().from(schema.notifications).where(eq(schema.notifications.read, 0)).orderBy(desc(schema.notifications.createdAt)).limit(10),
    d.select({ type: schema.events.type, n: sql<number>`count(*)` }).from(schema.events).where(gte(schema.events.createdAt, since30)).groupBy(schema.events.type),
  ])
  const general = await getGeneral(d)
  return c.json({
    general,
    channels: await configuredChannels(d),
    stats: { contacts: contacts?.n ?? 0, newContacts7d: new7?.n ?? 0, messagesIn7d: msgIn7?.n ?? 0, messagesOut7d: msgOut7?.n ?? 0, flowsLive: flowsLive?.n ?? 0, events30d: Object.fromEntries(events30.map((e) => [e.type, e.n])) },
    notifications,
  })
})

apiRoutes.get('/notifications', async (c) => {
  const rows = await db(c.env).select().from(schema.notifications).orderBy(desc(schema.notifications.createdAt)).limit(50)
  return c.json({ notifications: rows })
})
apiRoutes.post('/notifications/read', async (c) => {
  await db(c.env).update(schema.notifications).set({ read: 1 }).where(eq(schema.notifications.read, 0))
  return c.json({ ok: true })
})

/* ---------- Channels ---------- */
apiRoutes.get('/channels', async (c) => {
  const d = db(c.env)
  const origin = baseUrl(c.req.url)
  const line = await getChannelConfig(d, c.env.KV, 'line')
  const meta = await getChannelConfig(d, c.env.KV, 'meta')
  return c.json({
    line: line ? { configured: true, displayName: line.displayName, botBasicId: line.botBasicId } : { configured: false },
    meta: meta ? { configured: true, appId: meta.appId, pageId: meta.pageId, pageName: meta.pageName, instagramAccountId: meta.instagramAccountId, instagramUsername: meta.instagramUsername } : { configured: false },
    webhooks: { line: `${origin}/webhooks/line`, meta: `${origin}/webhooks/meta` },
    metaVerifyToken: await getOrCreateSecret(c.env.KV, 'meta_verify_token'),
    privacyUrl: `${origin}/privacy`,
    dataDeletionUrl: `${origin}/data-deletion`,
    profile: await getSetting<MetaProfile>(d, 'profile:meta'),
    richmenu: await getSetting<StoredRichMenu>(d, 'richmenu:line'),
  })
})

apiRoutes.post('/channels/line', async (c) => {
  const d = db(c.env)
  const body = await c.req.json<{ channelSecret?: string; channelAccessToken?: string }>()
  const channelSecret = body.channelSecret?.trim() ?? ''
  const channelAccessToken = body.channelAccessToken?.trim() ?? ''
  if (!channelSecret || !channelAccessToken) return c.json({ error: 'missing_fields' }, 400)
  const info = await lineBotInfo(channelAccessToken)
  if (!info.ok) return c.json({ error: 'invalid_token', detail: info.error }, 400)
  await putChannelConfig(d, c.env.KV, 'line', { channelSecret, channelAccessToken, botBasicId: info.basicId, displayName: info.displayName })
  const webhook = await lineSetWebhook(channelAccessToken, `${baseUrl(c.req.url)}/webhooks/line`)
  return c.json({ ok: true, displayName: info.displayName, basicId: info.basicId, webhookSet: webhook.ok, webhookError: webhook.error })
})

apiRoutes.post('/channels/line/test', async (c) => {
  const cfg = await getChannelConfig(db(c.env), c.env.KV, 'line')
  if (!cfg) return c.json({ error: 'line_not_configured' }, 404)
  const set = await lineSetWebhook(cfg.channelAccessToken, `${baseUrl(c.req.url)}/webhooks/line`)
  const test = await lineTestWebhook(cfg.channelAccessToken)
  return c.json({ webhookSet: set.ok, webhookError: set.error, ...test })
})

apiRoutes.delete('/channels/line', async (c) => {
  await deleteChannelConfig(db(c.env), 'line')
  return c.json({ ok: true })
})

apiRoutes.post('/channels/meta', async (c) => {
  const d = db(c.env)
  const body = await c.req.json<{ appId?: string; appSecret?: string; pageAccessToken?: string }>()
  const appId = body.appId?.trim() ?? ''
  const appSecret = body.appSecret?.trim() ?? ''
  const pageAccessToken = body.pageAccessToken?.trim() ?? ''
  if (!appId || !appSecret || !pageAccessToken) return c.json({ error: 'missing_fields' }, 400)
  const version = c.env.META_GRAPH_VERSION || undefined
  const info = await metaInspectPageToken(pageAccessToken, version)
  if (!info.ok) return c.json({ error: 'invalid_token', detail: info.error }, 400)
  await putChannelConfig(d, c.env.KV, 'meta', { appId, appSecret, pageAccessToken, pageId: info.pageId, pageName: info.pageName, instagramAccountId: info.instagramAccountId, instagramUsername: info.instagramUsername })
  const sub = await metaSubscribePage(pageAccessToken, info.pageId, version)
  return c.json({ ok: true, pageName: info.pageName, pageId: info.pageId, instagramUsername: info.instagramUsername, subscribed: sub.ok, subscribeError: sub.ok ? undefined : sub.error })
})

apiRoutes.post('/channels/meta/test', async (c) => {
  const cfg = await getChannelConfig(db(c.env), c.env.KV, 'meta')
  if (!cfg || !cfg.pageId) return c.json({ error: 'meta_not_configured' }, 404)
  const version = c.env.META_GRAPH_VERSION || undefined
  const info = await metaInspectPageToken(cfg.pageAccessToken, version)
  const sub = info.ok ? await metaSubscribePage(cfg.pageAccessToken, cfg.pageId, version) : { ok: false as const, error: info.error }
  return c.json({ tokenValid: info.ok, tokenError: info.ok ? undefined : info.error, subscribed: sub.ok, subscribeError: sub.ok ? undefined : sub.error })
})

apiRoutes.delete('/channels/meta', async (c) => {
  await deleteChannelConfig(db(c.env), 'meta')
  return c.json({ ok: true })
})

/* ---------- Channel profile (Messenger / Instagram) and LINE rich menu ---------- */
type StoredRichMenu = LineRichMenu & { richMenuId: string }
const zodErrors = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)

/** DELETEs the emptied fields, then POSTs the rest. A failed DELETE is reported but does not fail the save. */
async function applyMetaProfile(token: string, version: string | undefined, p: { set: Record<string, unknown>; remove: string[] }, platform?: 'instagram') {
  const del = p.remove.length > 0 ? await metaDeleteProfile(token, version, p.remove, platform) : { ok: true as const }
  const post = Object.keys(p.set).length > 0 ? await metaSetProfile(token, version, p.set, platform) : { ok: true as const }
  return { ok: post.ok, error: post.ok ? (del.ok ? undefined : del.error) : post.error }
}

apiRoutes.put('/channels/meta/profile', async (c) => {
  const d = db(c.env)
  const cfg = await getChannelConfig(d, c.env.KV, 'meta')
  if (!cfg) return c.json({ error: 'meta_not_configured' }, 404)
  const parsed = metaProfileSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_profile', errors: zodErrors(parsed.error) }, 400)
  const profile = parsed.data
  if (profile.menu.length > 0 && !profile.getStartedFlowId) return c.json({ error: 'get_started_required' }, 400)
  const version = c.env.META_GRAPH_VERSION || undefined
  const { set, remove } = buildMessengerProfile(profile)
  const messenger = await applyMetaProfile(cfg.pageAccessToken, version, { set, remove })
  // Instagram only when opted in, or to clear what an earlier save applied there.
  const prev = await getSetting<MetaProfile>(d, 'profile:meta')
  const ig = profile.applyToInstagram
    ? { set: Object.fromEntries(Object.entries(set).filter(([k]) => IG_PROFILE_FIELDS.includes(k))), remove: remove.filter((f) => IG_PROFILE_FIELDS.includes(f)) }
    : { set: {}, remove: IG_PROFILE_FIELDS }
  const instagram = cfg.instagramAccountId && (profile.applyToInstagram || prev?.applyToInstagram) ? await applyMetaProfile(cfg.pageAccessToken, version, ig, 'instagram') : undefined
  await putSetting(d, 'profile:meta', profile)
  return c.json({ ok: messenger.ok && (instagram?.ok ?? true), results: { messenger, instagram }, profile })
})

apiRoutes.delete('/channels/meta/profile', async (c) => {
  const d = db(c.env)
  const cfg = await getChannelConfig(d, c.env.KV, 'meta')
  if (!cfg) return c.json({ error: 'meta_not_configured' }, 404)
  const version = c.env.META_GRAPH_VERSION || undefined
  const prev = await getSetting<MetaProfile>(d, 'profile:meta')
  const messenger = await metaDeleteProfile(cfg.pageAccessToken, version, PROFILE_FIELDS)
  const instagram = cfg.instagramAccountId && prev?.applyToInstagram ? await metaDeleteProfile(cfg.pageAccessToken, version, IG_PROFILE_FIELDS, 'instagram') : undefined
  await deleteSetting(d, 'profile:meta')
  return c.json({ ok: messenger.ok && (instagram?.ok ?? true), results: { messenger, instagram } })
})

const MAX_RICHMENU_IMAGE = 1024 * 1024

apiRoutes.put('/channels/line/richmenu', async (c) => {
  const d = db(c.env)
  const cfg = await getChannelConfig(d, c.env.KV, 'line')
  if (!cfg) return c.json({ error: 'line_not_configured' }, 404)
  const parsed = lineRichMenuSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_richmenu', errors: zodErrors(parsed.error) }, 400)
  const menu = parsed.data
  const img = await fetch(menu.imageUrl).catch(() => null)
  const contentType = img?.headers.get('content-type')?.split(';')[0]!.trim() ?? ''
  if (!img?.ok || (contentType !== 'image/jpeg' && contentType !== 'image/png')) return c.json({ error: 'invalid_image' }, 400)
  const bytes = await img.arrayBuffer()
  if (bytes.byteLength > MAX_RICHMENU_IMAGE) return c.json({ error: 'image_too_large' }, 400)
  const token = cfg.channelAccessToken
  const created = await lineCreateRichMenu(token, buildRichMenu(menu))
  if (!created.ok) return c.json({ error: 'line_error', detail: created.error }, 502)
  const id = created.data.richMenuId
  for (const step of [() => lineUploadRichMenuImage(token, id, bytes, contentType), () => lineSetDefaultRichMenu(token, id)]) {
    const r = await step()
    if (!r.ok) {
      await lineDeleteRichMenu(token, id)
      return c.json({ error: 'line_error', detail: r.error }, 502)
    }
  }
  const prev = await getSetting<StoredRichMenu>(d, 'richmenu:line')
  if (prev?.richMenuId) await lineDeleteRichMenu(token, prev.richMenuId)
  await putSetting(d, 'richmenu:line', { ...menu, richMenuId: id } satisfies StoredRichMenu)
  return c.json({ ok: true, richMenuId: id })
})

apiRoutes.delete('/channels/line/richmenu', async (c) => {
  const d = db(c.env)
  const cfg = await getChannelConfig(d, c.env.KV, 'line')
  if (!cfg) return c.json({ error: 'line_not_configured' }, 404)
  const prev = await getSetting<StoredRichMenu>(d, 'richmenu:line')
  // Best effort: a menu already removed in LINE Official Account Manager must not block deleting the setting.
  if (prev?.richMenuId) {
    await lineClearDefaultRichMenu(cfg.channelAccessToken)
    await lineDeleteRichMenu(cfg.channelAccessToken, prev.richMenuId)
  }
  await deleteSetting(d, 'richmenu:line')
  return c.json({ ok: true })
})

/* ---------- Flows ---------- */
apiRoutes.get('/templates', (c) => c.json({ templates: TEMPLATES }))

apiRoutes.get('/flows', async (c) => {
  const d = db(c.env)
  const rows = await d.select().from(schema.flows).orderBy(desc(schema.flows.updatedAt))
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const runs = await d.select({ flowId: schema.events.flowId, n: sql<number>`count(*)` }).from(schema.events).where(and(eq(schema.events.type, 'trigger_fired'), gte(schema.events.createdAt, since30))).groupBy(schema.events.flowId)
  const runMap = new Map(runs.map((r) => [r.flowId, r.n]))
  return c.json({ flows: rows.map(parseFlow).map((f) => ({ ...f, runs30d: runMap.get(f.id) ?? 0 })) })
})

apiRoutes.post('/flows', async (c) => {
  const d = db(c.env)
  const body = await c.req.json<{ name?: string; channel?: string; kind?: string; definition?: unknown; template?: string }>()
  const template = body.template ? TEMPLATES.find((t) => t.slug === body.template) : undefined
  const channelParsed = flowChannelSchema.safeParse(body.channel ?? template?.channel ?? 'any')
  if (!channelParsed.success) return c.json({ error: 'invalid_channel' }, 400)
  // Templates are flows: a template with kind "sequence" fails validation below (triggers / question steps).
  const kindParsed = flowKindSchema.safeParse(body.kind ?? 'flow')
  if (!kindParsed.success) return c.json({ error: 'invalid_kind' }, 400)
  const kind = kindParsed.data
  const definitionInput = body.definition ?? template?.definition ?? { triggers: [], entry: null, steps: [] }
  const v = validateFlow(definitionInput, kind)
  if (!v.ok) return c.json({ error: 'invalid_definition', errors: v.errors }, 400)
  const general = await getGeneral(d)
  const name = body.name?.trim() || template?.name[general.language] || (kind === 'sequence' ? '新しいシーケンス' : '新しい自動化')
  const row = await d.insert(schema.flows).values({ name, channel: channelParsed.data, kind, definition: JSON.stringify(v.definition) }).returning().get()
  return c.json({ flow: parseFlow(row!), warnings: v.warnings }, 201)
})

async function loadFlow(d: Db, id: string) {
  const n = Number(id)
  if (!Number.isInteger(n)) return null
  const row = await d.select().from(schema.flows).where(eq(schema.flows.id, n)).get()
  return row ? parseFlow(row) : null
}

apiRoutes.get('/flows/:id', async (c) => {
  const flow = await loadFlow(db(c.env), c.req.param('id'))
  return flow ? c.json({ flow }) : c.json({ error: 'not_found' }, 404)
})

apiRoutes.put('/flows/:id', async (c) => {
  const d = db(c.env)
  const flow = await loadFlow(d, c.req.param('id'))
  if (!flow) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ name?: string; channel?: string; definition?: unknown; status?: string }>()
  const patch: Partial<typeof schema.flows.$inferInsert> = { updatedAt: new Date().toISOString() }
  let warnings: string[] = []
  if (body.name !== undefined) patch.name = String(body.name).trim() || flow.name
  if (body.channel !== undefined) {
    const ch = flowChannelSchema.safeParse(body.channel)
    if (!ch.success) return c.json({ error: 'invalid_channel' }, 400)
    patch.channel = ch.data
  }
  if (body.definition !== undefined) {
    const v = validateFlow(body.definition, flow.kind)
    if (!v.ok) return c.json({ error: 'invalid_definition', errors: v.errors }, 400)
    patch.definition = JSON.stringify(v.definition)
    warnings = v.warnings
  }
  if (body.status === 'live' || body.status === 'draft') patch.status = body.status
  const row = await d.update(schema.flows).set(patch).where(eq(schema.flows.id, flow.id)).returning().get()
  if (patch.status === 'draft') await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, flow.id))
  return c.json({ flow: parseFlow(row!), warnings })
})

apiRoutes.post('/flows/:id/publish', async (c) => {
  const d = db(c.env)
  const flow = await loadFlow(d, c.req.param('id'))
  if (!flow) return c.json({ error: 'not_found' }, 404)
  const v = validateFlow(flow.definition, flow.kind)
  if (!v.ok) return c.json({ error: 'invalid_definition', errors: v.errors }, 400)
  await d.update(schema.flows).set({ status: 'live', updatedAt: new Date().toISOString() }).where(eq(schema.flows.id, flow.id))
  return c.json({ ok: true, warnings: v.warnings })
})

apiRoutes.post('/flows/:id/unpublish', async (c) => {
  const d = db(c.env)
  const flow = await loadFlow(d, c.req.param('id'))
  if (!flow) return c.json({ error: 'not_found' }, 404)
  await d.update(schema.flows).set({ status: 'draft', updatedAt: new Date().toISOString() }).where(eq(schema.flows.id, flow.id))
  await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, flow.id))
  return c.json({ ok: true })
})

apiRoutes.delete('/flows/:id', async (c) => {
  const d = db(c.env)
  const flow = await loadFlow(d, c.req.param('id'))
  if (!flow) return c.json({ error: 'not_found' }, 404)
  await d.delete(schema.flows).where(eq(schema.flows.id, flow.id))
  await d.delete(schema.sessions).where(eq(schema.sessions.flowId, flow.id))
  await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.flowId, flow.id))
  return c.json({ ok: true })
})

apiRoutes.post('/flows/:id/test', async (c) => {
  const d = db(c.env)
  const flow = await loadFlow(d, c.req.param('id'))
  if (!flow) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ inputs?: SimulatedInput[]; channel?: Channel; newContact?: boolean; definition?: unknown }>()
  let target = flow
  if (body.definition !== undefined) {
    const v = validateFlow(body.definition, flow.kind)
    if (!v.ok) return c.json({ error: 'invalid_definition', errors: v.errors }, 400)
    target = { ...flow, definition: v.definition }
  }
  const { botFields, timezone } = await getGeneral(d)
  const result = await simulateFlow(d, target, body.inputs ?? [], body.channel, body.newContact ?? true, { botFields, timezone })
  return c.json(result)
})

/* ---------- Contacts ---------- */
apiRoutes.get('/tags', async (c) => {
  const rows = await db(c.env).select({ tag: schema.contactTags.tag, n: sql<number>`count(*)` }).from(schema.contactTags).groupBy(schema.contactTags.tag).orderBy(desc(sql`count(*)`))
  return c.json({ tags: rows })
})

apiRoutes.get('/contacts', async (c) => {
  const d = db(c.env)
  const q = c.req.query('q')?.trim()
  const tag = c.req.query('tag')?.trim()
  const channel = c.req.query('channel')?.trim()
  const segment = c.req.query('segment')?.trim()
  const page = Math.max(1, Number(c.req.query('page') ?? '1'))
  const size = 50
  const conds = []
  if (q) conds.push(or(like(schema.contacts.displayName, `%${q}%`), like(schema.contacts.username, `%${q}%`), like(schema.contacts.fields, `%${q}%`)))
  if (channel) conds.push(eq(schema.contacts.channel, channel))
  if (tag) conds.push(sql`${schema.contacts.id} in (select contact_id from contact_tags where tag = ${tag})`)
  const where = conds.length ? and(...conds) : undefined
  if (segment) {
    const seg = await loadSegment(d, Number(segment))
    if (!seg) return c.json({ error: 'not_found' }, 404)
    const tagMap = await tagsByContact(d)
    // ponytail: O(n) in-memory scan over all contacts (rules are not SQL, and D1 caps bound parameters at 100); move to SQL if contacts outgrow Worker memory
    const matched = (await d.select().from(schema.contacts).where(where).orderBy(desc(schema.contacts.updatedAt))).filter((r) => matchesSegment(seg, r, tagMap.get(r.id) ?? []))
    return c.json({ contacts: matched.slice((page - 1) * size, page * size).map((r) => ({ ...r, fields: parseFields(r), tags: tagMap.get(r.id) ?? [] })), total: matched.length, page, size })
  }
  const rows = await d.select().from(schema.contacts).where(where).orderBy(desc(schema.contacts.updatedAt)).limit(size).offset((page - 1) * size)
  const total = await d.select({ n: sql<number>`count(*)` }).from(schema.contacts).where(where).get()
  const ids = rows.map((r) => r.id)
  const tags = ids.length ? await d.select().from(schema.contactTags).where(sql`${schema.contactTags.contactId} in ${ids}`) : []
  return c.json({ contacts: rows.map((r) => ({ ...r, fields: parseFields(r), tags: tags.filter((t) => t.contactId === r.id).map((t) => t.tag) })), total: total?.n ?? 0, page, size })
})

apiRoutes.get('/contacts/export.csv', async (c) => {
  const d = db(c.env)
  const rows = await d.select().from(schema.contacts).orderBy(schema.contacts.id)
  const tags = await d.select().from(schema.contactTags)
  const fieldNames = new Set<string>()
  const parsed = rows.map((r) => ({ r, f: parseFields(r) }))
  for (const { f } of parsed) for (const k of Object.keys(f)) fieldNames.add(k)
  const cols = ['id', 'channel', 'channel_user_id', 'name', 'username', 'tags', 'created_at', 'last_inbound_at', ...fieldNames]
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [cols.map(esc).join(',')]
  for (const { r, f } of parsed) {
    const t = tags.filter((x) => x.contactId === r.id).map((x) => x.tag).join('|')
    lines.push([r.id, r.channel, r.channelUserId, r.displayName, r.username, t, r.createdAt, r.lastInboundAt, ...[...fieldNames].map((k) => f[k])].map(esc).join(','))
  }
  return c.body('﻿' + lines.join('\r\n'), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="contacts.csv"' })
})

async function loadContact(d: Db, id: string) {
  const n = Number(id)
  if (!Number.isInteger(n)) return null
  return (await d.select().from(schema.contacts).where(eq(schema.contacts.id, n)).get()) ?? null
}

apiRoutes.get('/contacts/:id', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const tags = await getTags(d, contact.id)
  const session = await d.select().from(schema.sessions).where(eq(schema.sessions.contactId, contact.id)).get()
  return c.json({ contact: { ...contact, fields: parseFields(contact), tags }, session: session ?? null, sequences: await contactSequences(d, contact.id) })
})

apiRoutes.patch('/contacts/:id', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ displayName?: string; fields?: Record<string, string>; botPaused?: boolean }>()
  const patch: Partial<typeof schema.contacts.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (body.displayName !== undefined) patch.displayName = String(body.displayName)
  if (body.fields !== undefined) patch.fields = JSON.stringify(body.fields)
  await d.update(schema.contacts).set(patch).where(eq(schema.contacts.id, contact.id))
  if (body.botPaused !== undefined) await setBotPaused(d, contact.id, Boolean(body.botPaused))
  return c.json({ ok: true })
})

apiRoutes.post('/contacts/:id/tags', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ tag?: string }>()
  if (!body.tag?.trim()) return c.json({ error: 'missing_tag' }, 400)
  await addTag(d, contact.id, body.tag)
  return c.json({ tags: await getTags(d, contact.id) })
})

apiRoutes.delete('/contacts/:id/tags/:tag', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  await removeTag(d, contact.id, c.req.param('tag'))
  return c.json({ tags: await getTags(d, contact.id) })
})

apiRoutes.post('/contacts/:id/sequences', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ flowId?: number }>()
  if (!Number.isInteger(body.flowId)) return c.json({ error: 'missing_flow_id' }, 400)
  const res = await subscribeSequence(d, contact, body.flowId!)
  if (res !== 'ok') return c.json({ error: res }, 400)
  return c.json({ sequences: await contactSequences(d, contact.id) }, 201)
})

apiRoutes.delete('/contacts/:id/sequences/:flowId', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  await unsubscribeSequence(d, contact.id, Number(c.req.param('flowId')))
  return c.json({ sequences: await contactSequences(d, contact.id) })
})

apiRoutes.delete('/contacts/:id', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  await d.delete(schema.messages).where(eq(schema.messages.contactId, contact.id))
  await d.delete(schema.contactTags).where(eq(schema.contactTags.contactId, contact.id))
  await d.delete(schema.sessions).where(eq(schema.sessions.contactId, contact.id))
  await d.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.contactId, contact.id))
  await d.delete(schema.contacts).where(eq(schema.contacts.id, contact.id))
  return c.json({ ok: true })
})

/* ---------- Inbox ---------- */
apiRoutes.get('/inbox', async (c) => {
  const d = db(c.env)
  const filter = c.req.query('filter') ?? 'all'
  const rows = await d
    .select()
    .from(schema.contacts)
    .where(filter === 'paused' ? eq(schema.contacts.botPaused, 1) : filter === 'unread' ? sql`${schema.contacts.unread} > 0` : undefined)
    .orderBy(desc(sql`coalesce(${schema.contacts.lastInboundAt}, ${schema.contacts.lastOutboundAt}, ${schema.contacts.createdAt})`))
    .limit(100)
  const ids = rows.map((r) => r.id)
  const last = ids.length
    ? await d
        .select()
        .from(schema.messages)
        .where(sql`${schema.messages.id} in (select max(id) from messages where contact_id in ${ids} group by contact_id)`)
    : []
  return c.json({ conversations: rows.map((r) => ({ contact: { ...r, fields: parseFields(r) }, lastMessage: last.find((m) => m.contactId === r.id) ?? null })) })
})

apiRoutes.get('/inbox/:id/messages', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const rows = await d.select().from(schema.messages).where(eq(schema.messages.contactId, contact.id)).orderBy(desc(schema.messages.id)).limit(200)
  await d.update(schema.contacts).set({ unread: 0 }).where(eq(schema.contacts.id, contact.id))
  return c.json({ messages: rows.reverse().map((m) => ({ ...m, payload: m.payload ? JSON.parse(m.payload) : null })) })
})

apiRoutes.post('/inbox/:id/send', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ text?: string; imageUrl?: string; pauseBot?: boolean }>()
  const text = body.text?.trim() ?? ''
  if (!text && !body.imageUrl) return c.json({ error: 'empty' }, 400)
  const adapter = await getAdapter(c.env, d, contact.channel as Channel)
  if (!adapter) return c.json({ error: 'channel_not_configured' }, 400)
  const res = await adapter.send(contact.channelUserId, { text: text || undefined, imageUrl: body.imageUrl })
  await logMessage(d, { contactId: contact.id, direction: 'out', source: 'human', kind: text ? 'text' : 'image', text, payload: body.imageUrl ? { imageUrl: body.imageUrl } : undefined, error: res.ok ? undefined : res.error })
  if (body.pauseBot !== false) {
    await setBotPaused(d, contact.id, true)
    await d.delete(schema.sessions).where(eq(schema.sessions.contactId, contact.id))
  }
  return res.ok ? c.json({ ok: true }) : c.json({ ok: false, error: res.error }, 502)
})

apiRoutes.post('/inbox/:id/bot', async (c) => {
  const d = db(c.env)
  const contact = await loadContact(d, c.req.param('id'))
  if (!contact) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ paused?: boolean }>()
  await setBotPaused(d, contact.id, Boolean(body.paused))
  return c.json({ ok: true })
})

/* ---------- Broadcasts ---------- */
apiRoutes.get('/broadcasts', async (c) => {
  const rows = await db(c.env).select().from(schema.broadcasts).orderBy(desc(schema.broadcasts.id)).limit(100)
  return c.json({ broadcasts: rows })
})

apiRoutes.get('/broadcasts/reach', async (c) => {
  const d = db(c.env)
  const channel = (c.req.query('channel') || 'any') as Channel | 'any'
  const tag = c.req.query('tag')?.trim() || null
  const segmentId = await segmentIdOf(d, c.req.query('segmentId'))
  if (segmentId === false) return c.json({ error: 'invalid_segment' }, 400)
  return c.json(await broadcastReach(d, channel, tag, segmentId))
})

apiRoutes.post('/broadcasts', async (c) => {
  const d = db(c.env)
  const body = await c.req.json<{ name?: string; channel?: string; tag?: string; text?: string; imageUrl?: string; scheduledAt?: string; segmentId?: number | null }>()
  const text = body.text?.trim() ?? ''
  if (!text) return c.json({ error: 'missing_text' }, 400)
  const ch = flowChannelSchema.safeParse(body.channel ?? 'any')
  if (!ch.success) return c.json({ error: 'invalid_channel' }, 400)
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : new Date()
  if (Number.isNaN(scheduledAt.getTime())) return c.json({ error: 'invalid_date' }, 400)
  const segmentId = await segmentIdOf(d, body.segmentId)
  if (segmentId === false) return c.json({ error: 'invalid_segment' }, 400)
  const row = await d
    .insert(schema.broadcasts)
    .values({ name: body.name?.trim() || text.slice(0, 30), channel: ch.data, tag: segmentId ? null : body.tag?.trim() || null, segmentId, text, imageUrl: body.imageUrl?.trim() || null, scheduledAt: scheduledAt.toISOString() })
    .returning()
    .get()
  return c.json({ broadcast: row }, 201)
})

apiRoutes.post('/broadcasts/:id/cancel', async (c) => {
  const d = db(c.env)
  const id = Number(c.req.param('id'))
  await d.update(schema.broadcasts).set({ status: 'canceled' }).where(and(eq(schema.broadcasts.id, id), or(eq(schema.broadcasts.status, 'scheduled'), eq(schema.broadcasts.status, 'running'))))
  await d.update(schema.broadcastJobs).set({ status: 'skipped', error: 'canceled' }).where(and(eq(schema.broadcastJobs.broadcastId, id), eq(schema.broadcastJobs.status, 'pending')))
  return c.json({ ok: true })
})

/* ---------- Segments ---------- */
/** An optional segment id from a query or body: null when absent, false when it names no segment. */
async function segmentIdOf(d: Db, raw: unknown): Promise<number | null | false> {
  if (raw === undefined || raw === null || raw === '') return null
  const seg = await loadSegment(d, Number(raw))
  return seg ? seg.id : false
}

const issues = (e: ZodError) => e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)

apiRoutes.get('/segments', async (c) => {
  const rows = await db(c.env).select().from(schema.segments).orderBy(desc(schema.segments.id))
  return c.json({ segments: rows.map(parseSegment) })
})

apiRoutes.post('/segments', async (c) => {
  const v = segmentInputSchema.safeParse(await c.req.json())
  if (!v.success) return c.json({ error: 'invalid_segment', errors: issues(v.error) }, 400)
  const row = await db(c.env).insert(schema.segments).values({ name: v.data.name, rules: JSON.stringify(v.data.rules), mode: v.data.mode }).returning().get()
  return c.json({ segment: parseSegment(row!) }, 201)
})

apiRoutes.put('/segments/:id', async (c) => {
  const d = db(c.env)
  const seg = await loadSegment(d, Number(c.req.param('id')))
  if (!seg) return c.json({ error: 'not_found' }, 404)
  const v = segmentInputSchema.safeParse(await c.req.json())
  if (!v.success) return c.json({ error: 'invalid_segment', errors: issues(v.error) }, 400)
  const row = await d.update(schema.segments).set({ name: v.data.name, rules: JSON.stringify(v.data.rules), mode: v.data.mode }).where(eq(schema.segments.id, seg.id)).returning().get()
  return c.json({ segment: parseSegment(row!) })
})

apiRoutes.delete('/segments/:id', async (c) => {
  const d = db(c.env)
  const seg = await loadSegment(d, Number(c.req.param('id')))
  if (!seg) return c.json({ error: 'not_found' }, 404)
  await d.delete(schema.segments).where(eq(schema.segments.id, seg.id))
  return c.json({ ok: true })
})

/* ---------- Reports ---------- */
apiRoutes.get('/reports', async (c) => {
  const d = db(c.env)
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? '30')))
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const byFlow = await d
    .select({ flowId: schema.events.flowId, type: schema.events.type, n: sql<number>`count(*)` })
    .from(schema.events)
    .where(gte(schema.events.createdAt, since))
    .groupBy(schema.events.flowId, schema.events.type)
  const daily = await d
    .select({ day: sql<string>`substr(${schema.messages.createdAt}, 1, 10)`, direction: schema.messages.direction, n: sql<number>`count(*)` })
    .from(schema.messages)
    .where(gte(schema.messages.createdAt, since))
    .groupBy(sql`substr(${schema.messages.createdAt}, 1, 10)`, schema.messages.direction)
  const newContacts = await d
    .select({ day: sql<string>`substr(${schema.contacts.createdAt}, 1, 10)`, n: sql<number>`count(*)` })
    .from(schema.contacts)
    .where(gte(schema.contacts.createdAt, since))
    .groupBy(sql`substr(${schema.contacts.createdAt}, 1, 10)`)
  const flows = (await d.select().from(schema.flows)).map(parseFlow)
  const perFlow = flows.map((f) => {
    const counts: Record<string, number> = {}
    for (const r of byFlow) if (r.flowId === f.id) counts[r.type] = r.n
    return { id: f.id, name: f.name, status: f.status, channel: f.channel, started: counts.trigger_fired ?? 0, messagesSent: counts.step_sent ?? 0, buttonClicks: counts.button_clicked ?? 0, inputs: counts.input_saved ?? 0, completed: counts.flow_completed ?? 0, errors: counts.error ?? 0 }
  })
  const dayMap: Record<string, { in: number; out: number; newContacts: number }> = {}
  for (const r of daily) (dayMap[r.day] ??= { in: 0, out: 0, newContacts: 0 })[r.direction as 'in' | 'out'] = r.n
  for (const r of newContacts) (dayMap[r.day] ??= { in: 0, out: 0, newContacts: 0 }).newContacts = r.n
  const series = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }))
  return c.json({ days, flows: perFlow, series })
})

/* ---------- Settings ---------- */
/** AI settings without the API key. */
const aiInfo = (cfg: AiConfig | null) => (cfg ? { configured: true, provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl } : { configured: false })

apiRoutes.get('/settings', async (c) => {
  const d = db(c.env)
  const general = await getGeneral(d)
  const mcpConfigured = (await c.env.KV.get('mcp:token_hash')) !== null
  const ai = aiInfo(await getSetting<AiConfig>(d, 'ai'))
  return c.json({ general, mcp: { configured: mcpConfigured, url: `${baseUrl(c.req.url)}/mcp` }, ai })
})

apiRoutes.put('/settings', async (c) => {
  const d = db(c.env)
  const body = await c.req.json<Partial<GeneralSettings>>()
  const current = await getGeneral(d)
  const bf = body.botFields
  if (bf !== undefined && !(bf && typeof bf === 'object' && !Array.isArray(bf) && Object.keys(bf).length <= 50 && Object.entries(bf).every(([k, v]) => /^[\w-]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 2000))) {
    return c.json({ error: 'invalid_bot_fields' }, 400)
  }
  const next: GeneralSettings = {
    botName: typeof body.botName === 'string' && body.botName.trim() ? body.botName.trim() : current.botName,
    language: body.language === 'en' || body.language === 'ja' ? body.language : current.language,
    timezone: typeof body.timezone === 'string' && body.timezone ? body.timezone : current.timezone,
    paused: typeof body.paused === 'boolean' ? body.paused : current.paused,
    handoffKeywords: Array.isArray(body.handoffKeywords) ? body.handoffKeywords.map(String).filter(Boolean) : current.handoffKeywords,
    handoffReply: typeof body.handoffReply === 'string' ? body.handoffReply : current.handoffReply,
    botFields: bf ?? current.botFields,
  }
  await putSetting(d, 'general', next)
  return c.json({ general: next })
})

apiRoutes.post('/settings/mcp/rotate', async (c) => {
  if (c.get('auth') !== 'session') return c.json({ error: 'session_required' }, 403)
  const token = `sk_${randomToken(32)}`
  await c.env.KV.put('mcp:token_hash', await sha256Hex(token))
  return c.json({ token, url: `${baseUrl(c.req.url)}/mcp` })
})

apiRoutes.delete('/settings/mcp', async (c) => {
  if (c.get('auth') !== 'session') return c.json({ error: 'session_required' }, 403)
  await c.env.KV.delete('mcp:token_hash')
  return c.json({ ok: true })
})

apiRoutes.put('/settings/ai', async (c) => {
  const d = db(c.env)
  const body = await c.req.json<Partial<Record<keyof AiConfig, unknown>>>()
  const provider = body.provider
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'workers_ai') return c.json({ error: 'invalid_provider' }, 400)
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const model = str(body.model)
  const baseUrl = provider === 'openai' ? str(body.baseUrl) : ''
  const current = await getAiConfig(d, c.env.KV)
  // Keep the saved key only for the same endpoint, so changing the Base URL cannot send it elsewhere.
  const sameEndpoint = current?.provider === provider && (current.baseUrl ?? '') === baseUrl
  const apiKey = provider === 'workers_ai' ? '' : str(body.apiKey) || (sameEndpoint ? (current?.apiKey ?? '') : '')
  if (provider !== 'workers_ai' && !apiKey) return c.json({ error: 'missing_api_key' }, 400)
  if (provider === 'openai' && !model) return c.json({ error: 'missing_model' }, 400)
  const cfg: AiConfig = { provider, ...(apiKey && { apiKey }), ...(model && { model }), ...(baseUrl && { baseUrl }) }
  await putAiConfig(d, c.env.KV, cfg)
  return c.json({ ai: aiInfo(cfg) })
})

apiRoutes.delete('/settings/ai', async (c) => {
  await deleteSetting(db(c.env), 'ai')
  return c.json({ ok: true })
})

apiRoutes.post('/settings/ai/test', async (c) => {
  const cfg = await getAiConfig(db(c.env), c.env.KV)
  if (!cfg) return c.json({ ok: false, error: 'ai_not_configured' })
  try {
    // Default max_tokens: Claude models may think first, and a tiny cap could leave no text.
    const reply = await complete(cfg, { system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }] }, c.env.AI)
    return c.json({ ok: true, reply })
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

/* ---------- Maintenance ---------- */
apiRoutes.post('/scheduler/run', async (c) => c.json(await runScheduledTasks(c.env, db(c.env))))
