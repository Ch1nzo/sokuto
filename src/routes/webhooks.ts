import { Hono } from 'hono'
import type { AppEnv } from '../auth'
import { createDb } from '../db'
import { getChannelConfig, getOrCreateSecret } from '../settings'
import { LineAdapter, parseLineWebhook, verifyLineSignature } from '../channels/line'
import { MetaAdapter, parseMetaWebhook, verifyMetaSignature } from '../channels/meta'
import { handleInbound } from '../inbound'
import { parseWorkspaceId } from '../workspaces'
import { lazyAi, type AiCaller } from '../ai'
import type { InboundEvent } from '../channels/types'
import type { ChannelAdapter } from '../channels/adapter'

export const webhookRoutes = new Hono<AppEnv>()

/**
 * `/webhooks/<channel>/<workspace id>`; without the id it is workspace 1 (URLs from before workspaces).
 * An unknown workspace has no channel config, so it answers `*_not_configured`.
 */
webhookRoutes.use('/:channel/:ws?', async (c, next) => {
  const ws = parseWorkspaceId(c.req.param('ws') ?? '1')
  if (ws === null) return c.json({ error: 'workspace_not_found' }, 404)
  c.set('ws', ws)
  return next()
})

async function processAll(db: ReturnType<typeof createDb>, ws: number, adapterFor: (ev: InboundEvent) => ChannelAdapter | null, events: InboundEvent[], replyTokens: Map<string, string>, ai: AiCaller) {
  for (const ev of events) {
    const adapter = adapterFor(ev)
    if (!adapter) continue
    try {
      await handleInbound(db, ws, adapter, ev, replyTokens.get(ev.channelUserId), ai)
    } catch (err) {
      console.error('inbound failed', ev.channel, ev.type, err)
    }
  }
}

webhookRoutes.post('/line/:ws?', async (c) => {
  const db = createDb(c.env.DB)
  const ws = c.get('ws')
  const cfg = await getChannelConfig(db, c.env.KV, ws, 'line')
  if (!cfg) return c.json({ error: 'line_not_configured' }, 404)
  const body = await c.req.text()
  if (!(await verifyLineSignature(cfg.channelSecret, body, c.req.header('x-line-signature')))) return c.json({ error: 'bad_signature' }, 401)
  const { events, replyTokens } = parseLineWebhook(body)
  const adapter = new LineAdapter(cfg)
  c.executionCtx.waitUntil(processAll(db, ws, () => adapter, events, replyTokens, lazyAi(c.env, db, ws)))
  return c.json({ ok: true })
})

webhookRoutes.get('/meta/:ws?', async (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge') ?? ''
  const expected = await getOrCreateSecret(c.env.KV, 'meta_verify_token')
  if (mode === 'subscribe' && token === expected) return c.text(challenge)
  return c.text('verification failed', 403)
})

webhookRoutes.post('/meta/:ws?', async (c) => {
  const db = createDb(c.env.DB)
  const ws = c.get('ws')
  const cfg = await getChannelConfig(db, c.env.KV, ws, 'meta')
  if (!cfg) return c.json({ error: 'meta_not_configured' }, 404)
  const body = await c.req.text()
  if (!(await verifyMetaSignature(cfg.appSecret, body, c.req.header('x-hub-signature-256')))) return c.json({ error: 'bad_signature' }, 401)
  const { events, replyTokens } = parseMetaWebhook(body, cfg)
  const version = c.env.META_GRAPH_VERSION || undefined
  const adapters = { messenger: new MetaAdapter('messenger', cfg, version), instagram: cfg.instagramAccountId ? new MetaAdapter('instagram', cfg, version) : null }
  c.executionCtx.waitUntil(processAll(db, ws, (ev) => (ev.channel === 'instagram' ? adapters.instagram : adapters.messenger), events, replyTokens, lazyAi(c.env, db, ws)))
  return c.text('EVENT_RECEIVED')
})
