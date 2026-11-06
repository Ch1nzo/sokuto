import { hmacSha256, toBase64, timingSafeEqual } from '../crypto'
import type { ChannelAdapter, ParsedWebhook, SendOptions } from './adapter'
import type { ChannelProfile, InboundEvent, OutboundButton, OutboundMessage, SendResult } from './types'
import type { LineConfig, LineRichMenu } from '../settings'
import { flowPayload } from '../flows/engine'

const API = 'https://api.line.me'
const DATA_API = 'https://api-data.line.me'

export async function verifyLineSignature(channelSecret: string, body: string, signature: string | undefined): Promise<boolean> {
  if (!signature) return false
  const expected = toBase64(await hmacSha256(channelSecret, body))
  return timingSafeEqual(expected, signature)
}

type LineEvent = {
  type: string
  webhookEventId?: string
  timestamp: number
  replyToken?: string
  source?: { type: string; userId?: string }
  message?: { id: string; type: string; text?: string; stickerId?: string }
  postback?: { data: string; params?: Record<string, string> }
  follow?: { isUnblocked?: boolean }
}

export function parseLineWebhook(body: string): ParsedWebhook {
  const events: InboundEvent[] = []
  const replyTokens = new Map<string, string>()
  let parsed: { events?: LineEvent[] }
  try {
    parsed = JSON.parse(body)
  } catch {
    return { events, replyTokens }
  }
  for (const ev of parsed.events ?? []) {
    const userId = ev.source?.userId
    if (!userId) continue
    const eventId = ev.webhookEventId ?? `${userId}:${ev.timestamp}`
    if (ev.replyToken) replyTokens.set(userId, ev.replyToken)
    const base = { channel: 'line' as const, channelUserId: userId, eventId, timestamp: ev.timestamp }
    if (ev.type === 'message' && ev.message) {
      const m = ev.message
      if (m.type === 'text') events.push({ ...base, type: 'message', text: m.text ?? '' })
      else
        events.push({
          ...base,
          type: 'message',
          attachments: [{ type: m.type === 'sticker' ? 'sticker' : m.type === 'image' ? 'image' : m.type === 'video' ? 'video' : m.type === 'audio' ? 'audio' : m.type === 'location' ? 'location' : 'file' }],
        })
    } else if (ev.type === 'postback' && ev.postback) {
      events.push({ ...base, type: 'postback', payload: ev.postback.data })
    } else if (ev.type === 'follow') {
      events.push({ ...base, type: 'follow' })
    } else if (ev.type === 'unfollow') {
      events.push({ ...base, type: 'unfollow' })
    }
  }
  return { events, replyTokens }
}

type LineMessageObject = Record<string, unknown>

function quickReply(items: OutboundButton[]) {
  return {
    items: items.slice(0, 13).map((b) => ({
      type: 'action',
      action: b.url
        ? { type: 'uri', label: b.label.slice(0, 20), uri: b.url }
        : { type: 'postback', label: b.label.slice(0, 20), data: b.payload ?? b.label, displayText: b.label },
    })),
  }
}

export function renderLineMessages(msg: OutboundMessage): LineMessageObject[] {
  const out: LineMessageObject[] = []
  if (msg.imageUrl) out.push({ type: 'image', originalContentUrl: msg.imageUrl, previewImageUrl: msg.imageUrl })
  if (msg.buttons && msg.buttons.length > 0) {
    out.push({
      type: 'template',
      altText: (msg.text ?? msg.buttons.map((b) => b.label).join(' / ')).slice(0, 400),
      template: {
        type: 'buttons',
        text: (msg.text ?? ' ').slice(0, 160),
        actions: msg.buttons.slice(0, 4).map((b) =>
          b.url ? { type: 'uri', label: b.label.slice(0, 20), uri: b.url } : { type: 'postback', label: b.label.slice(0, 20), data: b.payload ?? b.label, displayText: b.label },
        ),
      },
    })
  } else if (msg.text) {
    out.push({ type: 'text', text: msg.text.slice(0, 5000) })
  }
  if (msg.quickReplies && msg.quickReplies.length > 0 && out.length > 0) {
    out[out.length - 1]!.quickReply = quickReply(msg.quickReplies)
  }
  return out
}

/** LINE loading animation accepts 5–60 s in steps of 5. */
export function lineLoadingSeconds(seconds: number): number {
  return Math.min(60, Math.max(5, Math.ceil(seconds / 5) * 5))
}

export class LineAdapter implements ChannelAdapter {
  readonly channel = 'line' as const
  private usedReplyTokens = new Set<string>()
  constructor(private cfg: LineConfig) {}

  private headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.channelAccessToken}` }
  }

  async send(userId: string, message: OutboundMessage, opts?: SendOptions): Promise<SendResult> {
    const messages = renderLineMessages(message)
    if (messages.length === 0) return { ok: true }
    const replyToken = opts?.replyToken && !this.usedReplyTokens.has(opts.replyToken) ? opts.replyToken : undefined
    let res: Response
    if (replyToken) {
      this.usedReplyTokens.add(replyToken)
      res = await fetch(`${API}/v2/bot/message/reply`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ replyToken, messages }) })
      if (res.ok) return { ok: true }
      // Reply token expired or already used: fall back to push.
    }
    res = await fetch(`${API}/v2/bot/message/push`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ to: userId, messages }) })
    if (res.ok) return { ok: true }
    const text = await res.text()
    return { ok: false, error: `LINE ${res.status}: ${text.slice(0, 300)}`, code: String(res.status) }
  }

  async getProfile(userId: string): Promise<ChannelProfile> {
    const res = await fetch(`${API}/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: this.headers() })
    if (!res.ok) return {}
    const p = (await res.json()) as { displayName?: string; pictureUrl?: string }
    return { displayName: p.displayName, avatarUrl: p.pictureUrl }
  }

  async typing(userId: string, seconds: number): Promise<void> {
    await fetch(`${API}/v2/bot/chat/loading/start`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ chatId: userId, loadingSeconds: lineLoadingSeconds(seconds) }) }).catch(() => undefined)
  }
}

/** Setup helpers used by the admin wizard. */
export async function lineBotInfo(accessToken: string): Promise<{ ok: true; userId: string; basicId: string; displayName: string } | { ok: false; error: string }> {
  const res = await fetch(`${API}/v2/bot/info`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return { ok: false, error: `LINE ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const j = (await res.json()) as { userId: string; basicId: string; displayName: string }
  return { ok: true, ...j }
}

export async function lineSetWebhook(accessToken: string, endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API}/v2/bot/channel/webhook/endpoint`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ endpoint }),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: `LINE ${res.status}: ${(await res.text()).slice(0, 200)}` }
}

export async function lineTestWebhook(accessToken: string): Promise<{ ok: boolean; detail?: string }> {
  const res = await fetch(`${API}/v2/bot/channel/webhook/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: '{}',
  })
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; reason?: string; detail?: string }
  return { ok: Boolean(j.success), detail: j.detail ?? j.reason }
}

/** Rich menu layout (number of areas) → [columns, rows]. */
export const GRID: Record<LineRichMenu['layout'], [number, number]> = { 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 6: [3, 2] }

/** LINE rich menu object: the image is split into an even grid, areas left to right, top to bottom. */
export function buildRichMenu(m: LineRichMenu) {
  const width = 2500
  const height = m.size === 'full' ? 1686 : 843
  const [cols, rows] = GRID[m.layout]
  const areas = m.cells.slice(0, cols * rows).map((c, i) => {
    const x = Math.round(((i % cols) * width) / cols)
    const y = Math.round((Math.floor(i / cols) * height) / rows)
    const label = c.label?.slice(0, 20) || undefined
    const action =
      c.type === 'uri'
        ? { type: 'uri', label, uri: c.value }
        : c.type === 'message'
          ? { type: 'message', label, text: c.value }
          : { type: 'postback', label, data: c.type === 'flow' ? flowPayload(Number(c.value)) : c.value, displayText: c.type === 'flow' ? label : undefined }
    return {
      bounds: { x, y, width: Math.round((((i % cols) + 1) * width) / cols) - x, height: Math.round(((Math.floor(i / cols) + 1) * height) / rows) - y },
      action,
    }
  })
  return { size: { width, height }, selected: true, name: 'Sokuto', chatBarText: m.chatBarText.slice(0, 14), areas }
}

type LineResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Calls the LINE API with the channel token. JSON bodies are serialized; anything else (image bytes) is sent as is. */
export async function lineRequest<T = Record<string, unknown>>(token: string, method: string, url: string, body?: unknown, contentType = 'application/json'): Promise<LineResult<T>> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit),
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, error: `LINE ${res.status}: ${text.slice(0, 300)}` }
  try {
    return { ok: true, data: JSON.parse(text || '{}') as T }
  } catch {
    return { ok: true, data: {} as T }
  }
}

export function lineCreateRichMenu(token: string, menu: ReturnType<typeof buildRichMenu>) {
  return lineRequest<{ richMenuId: string }>(token, 'POST', `${API}/v2/bot/richmenu`, menu)
}

export function lineUploadRichMenuImage(token: string, id: string, bytes: ArrayBuffer, contentType: string) {
  return lineRequest(token, 'POST', `${DATA_API}/v2/bot/richmenu/${encodeURIComponent(id)}/content`, bytes, contentType)
}

export function lineSetDefaultRichMenu(token: string, id: string) {
  return lineRequest(token, 'POST', `${API}/v2/bot/user/all/richmenu/${encodeURIComponent(id)}`)
}

export function lineClearDefaultRichMenu(token: string) {
  return lineRequest(token, 'DELETE', `${API}/v2/bot/user/all/richmenu`)
}

export function lineDeleteRichMenu(token: string, id: string) {
  return lineRequest(token, 'DELETE', `${API}/v2/bot/richmenu/${encodeURIComponent(id)}`)
}
