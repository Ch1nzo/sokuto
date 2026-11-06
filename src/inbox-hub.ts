import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'

/**
 * One per workspace (`idFromName('ws:<id>')`): the admin tabs' inbox WebSockets (src/realtime.ts).
 *
 * Uses the WebSocket Hibernation API, so an idle hub is evicted from memory while its sockets stay open
 * (no duration billed), and the tabs' 30 s `ping` keep-alives are answered by the runtime (`pong`) without
 * waking it. It stores nothing: a publish is fanned out to whoever is connected right now.
 */
export class InboxHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      // Auth, workspace and Origin were checked by the Worker (GET /api/realtime) before forwarding.
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    if (req.method === 'POST') {
      // Internal publish from the Worker through the stub (not reachable from outside).
      const event = await req.text()
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(event)
        } catch {
          /* closing socket: webSocketClose cleans up */
        }
      }
      return new Response(null, { status: 204 })
    }
    return new Response('not found', { status: 404 })
  }

  /** Tabs only send `ping` (auto-answered); anything else is ignored. */
  override async webSocketMessage(): Promise<void> {}

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error')
    } catch {
      /* already closed */
    }
  }
}
