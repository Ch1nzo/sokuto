import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Realtime inbox events: one WebSocket per tab (`GET /api/realtime?ws=<id>`, src/realtime.ts) to the workspace's
 * InboxHub. Events carry no data, only "the inbox changed" (and which conversation, when it was one); listeners
 * refetch over the normal API. Every page keeps a slower safety poll, so a lost socket only costs latency.
 */
export type InboxEvent = { t: 'inbox'; contactId?: number }
type Listener = (e: InboxEvent) => void

const PING_MS = 30_000
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000
/** A tab hidden this long lets its socket go; becoming visible reconnects (and refetches once). */
const HIDDEN_CLOSE_MS = 5 * 60_000

export class RealtimeClient {
  private socket: WebSocket | null = null
  private listeners = new Set<Listener>()
  private attempt = 0
  private everOpened = false
  private stopped = false
  private parked = false
  private retryTimer: number | undefined
  private pingTimer: number | undefined
  private hiddenTimer: number | undefined

  constructor(
    private workspaceId: string,
    private onConnected: (connected: boolean) => void,
  ) {}

  start() {
    document.addEventListener('visibilitychange', this.onVisibility)
    this.connect()
  }

  stop() {
    this.stopped = true
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.clearTimeout(this.retryTimer)
    window.clearTimeout(this.hiddenTimer)
    this.close()
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit(e: InboxEvent) {
    for (const fn of this.listeners) fn(e)
  }

  private connect() {
    if (this.stopped || this.socket) return
    window.clearTimeout(this.retryTimer)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/api/realtime?ws=${encodeURIComponent(this.workspaceId)}`)
    this.socket = ws
    ws.onopen = () => {
      // Events may have been missed while the socket was down (or failing): one refetch catches up.
      const missed = this.everOpened || this.attempt > 0
      this.attempt = 0
      this.everOpened = true
      this.onConnected(true)
      this.pingTimer = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS)
      if (missed) this.emit({ t: 'inbox' })
    }
    ws.onmessage = (m) => {
      if (typeof m.data !== 'string' || m.data === 'pong') return
      try {
        const e = JSON.parse(m.data) as InboxEvent
        if (e?.t === 'inbox') this.emit(typeof e.contactId === 'number' ? { t: 'inbox', contactId: e.contactId } : { t: 'inbox' })
      } catch {
        /* not ours */
      }
    }
    ws.onclose = () => {
      if (this.socket !== ws) return
      this.socket = null
      window.clearInterval(this.pingTimer)
      this.onConnected(false)
      if (this.stopped || this.parked) return
      // Exponential backoff with jitter (1 s → 30 s), so a restart does not get every tab back at once.
      const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt++)
      this.retryTimer = window.setTimeout(() => this.connect(), base / 2 + Math.random() * (base / 2))
    }
  }

  private close() {
    const ws = this.socket
    if (!ws) return
    this.socket = null
    window.clearInterval(this.pingTimer)
    ws.onopen = ws.onmessage = ws.onclose = null
    ws.close(1000)
    this.onConnected(false)
  }

  private onVisibility = () => {
    window.clearTimeout(this.hiddenTimer)
    if (document.hidden) {
      this.hiddenTimer = window.setTimeout(() => {
        this.parked = true
        window.clearTimeout(this.retryTimer)
        this.close()
      }, HIDDEN_CLOSE_MS)
      return
    }
    if (this.parked || !this.socket) {
      this.parked = false
      this.attempt = 0
      this.connect()
    }
  }
}

type RealtimeState = { subscribe: (fn: Listener) => () => void; connected: boolean }

/** Provided by the shell (App.tsx) while logged in. */
export const RealtimeContext = createContext<RealtimeState>({ subscribe: () => () => {}, connected: false })

export const useRealtime = () => useContext(RealtimeContext)

/** Calls `fn` on every inbox event, always the latest `fn` (no resubscribe per render). */
export function useInboxEvents(fn: Listener) {
  const { subscribe } = useRealtime()
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe])
}
