import type { Env } from './env'

/**
 * Realtime inbox: one Durable Object (`InboxHub`, src/inbox-hub.ts) per workspace holds the admin tabs'
 * WebSockets. Whatever changes what the inbox shows publishes a small event to the workspace's hub, which
 * forwards it to every open tab; the tab then refetches over the normal API (events carry no data).
 */
export type InboxEvent = { t: 'inbox'; contactId?: number }

/** Lets a publish outlive the response (`ctx.waitUntil`) without the caller awaiting it. */
export type Defer = (p: Promise<unknown>) => void

const hub = (env: Env, ws: number) => env.INBOX_HUB.get(env.INBOX_HUB.idFromName(`ws:${ws}`))

/** Forwards a `GET /api/realtime` upgrade to the workspace's hub. */
export const connectInbox = (env: Env, ws: number, req: Request) => hub(env, ws).fetch(req)

/**
 * Tells the workspace's open admin tabs that the inbox changed (`contactId` when it was one conversation).
 * Never throws: realtime is a nicety, the inbox still has its safety poll. One DO request; cheap with no tab open.
 */
export async function notifyInbox(env: Env, ws: number, contactId?: number): Promise<void> {
  try {
    const event: InboxEvent = contactId === undefined ? { t: 'inbox' } : { t: 'inbox', contactId }
    const res = await hub(env, ws).fetch('https://inbox-hub/publish', { method: 'POST', body: JSON.stringify(event) })
    if (!res.ok) console.error('inbox publish failed', ws, res.status)
  } catch (err) {
    console.error('inbox publish failed', ws, err)
  }
}

/**
 * Collects the conversations one unit of work (a webhook request, a cron tick) touched and publishes once per
 * workspace at the end: with the contact id when exactly one conversation changed, else without.
 */
export class InboxChanges {
  private byWs = new Map<number, Set<number | null>>()

  /** `contactId` null = something workspace-wide (a broadcast batch). */
  add(ws: number, contactId: number | null) {
    let s = this.byWs.get(ws)
    if (!s) this.byWs.set(ws, (s = new Set()))
    s.add(contactId)
  }

  get size() {
    return this.byWs.size
  }

  async publish(env: Env) {
    const all = [...this.byWs].map(([ws, ids]) => {
      const [only] = ids
      return notifyInbox(env, ws, ids.size === 1 && only !== null ? only : undefined)
    })
    this.byWs.clear()
    await Promise.all(all)
  }
}

/**
 * Why a `GET /api/realtime` request may not open a socket, or null when it may. Browsers send the session
 * cookie with cross-site WebSocket handshakes (no CORS applies), so the `Origin` must be this site's own
 * origin: otherwise any page could listen in with the admin's cookie (cross-site WebSocket hijacking).
 */
export function realtimeRejection(req: Request): Response | null {
  if (req.method !== 'GET' || req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'upgrade_required' }, { status: 426, headers: { Upgrade: 'websocket' } })
  }
  const origin = req.headers.get('origin')
  if (!origin || origin !== new URL(req.url).origin) return Response.json({ error: 'bad_origin' }, { status: 403 })
  return null
}
