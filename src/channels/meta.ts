import { hmacSha256, toHex, timingSafeEqual } from '../crypto'
import type { ChannelAdapter, ParsedWebhook, SendOptions } from './adapter'
import type { Channel, ChannelProfile, InboundEvent, OutboundButton, OutboundMessage, SendResult } from './types'
import type { MetaConfig } from '../settings'

export const DEFAULT_GRAPH_VERSION = 'v25.0'

export async function verifyMetaSignature(appSecret: string, body: string, header: string | undefined): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false
  const expected = 'sha256=' + toHex(await hmacSha256(appSecret, body))
  return timingSafeEqual(expected, header)
}

type Messaging = {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    is_echo?: boolean
    quick_reply?: { payload: string }
    attachments?: { type: string; payload?: { url?: string } }[]
    reply_to?: { story?: { url?: string; id?: string } }
  }
  postback?: { mid?: string; payload: string; title?: string; referral?: { ref?: string } }
  referral?: { ref?: string; source?: string; type?: string }
}

type Change = {
  field: string
  value: {
    item?: string
    verb?: string
    comment_id?: string
    post_id?: string
    parent_id?: string
    message?: string
    from?: { id: string; name?: string; username?: string }
    // instagram comments
    id?: string
    text?: string
    media?: { id: string }
  }
}

type WebhookBody = { object: string; entry?: { id: string; time?: number; messaging?: Messaging[]; changes?: Change[] }[] }

/** Parses both `page` (Messenger + Facebook comments) and `instagram` webhook payloads. */
export function parseMetaWebhook(body: string, cfg: { pageId?: string; instagramAccountId?: string }): ParsedWebhook {
  const events: InboundEvent[] = []
  const replyTokens = new Map<string, string>()
  let parsed: WebhookBody
  try {
    parsed = JSON.parse(body)
  } catch {
    return { events, replyTokens }
  }
  const channel: Channel = parsed.object === 'instagram' ? 'instagram' : 'messenger'
  for (const entry of parsed.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue
      const base = { channel, channelUserId: m.sender.id, timestamp: m.timestamp }
      if (m.message) {
        const story = m.message.reply_to?.story
        const mention = m.message.attachments?.find((a) => a.type === 'story_mention')
        const attachments = m.message.attachments
          ?.filter((a) => a.type !== 'story_mention')
          .map((a) => ({ type: (['image', 'video', 'audio', 'file'].includes(a.type) ? a.type : 'file') as 'image' | 'video' | 'audio' | 'file', url: a.payload?.url }))
        if (mention) events.push({ ...base, type: 'story_mention', eventId: m.message.mid, attachments: [{ type: 'image', url: mention.payload?.url }] })
        else if (story) events.push({ ...base, type: 'story_reply', eventId: m.message.mid, text: m.message.text, attachments: [{ type: 'image', url: story.url }] })
        else if (m.message.quick_reply) events.push({ ...base, type: 'postback', eventId: m.message.mid, payload: m.message.quick_reply.payload, text: m.message.text })
        else events.push({ ...base, type: 'message', eventId: m.message.mid, text: m.message.text, attachments })
      } else if (m.postback) {
        const ref = m.postback.referral?.ref
        events.push({ ...base, type: ref ? 'ref' : 'postback', eventId: m.postback.mid ?? `${m.sender.id}:${m.timestamp}:pb`, payload: m.postback.payload, text: m.postback.title, ref })
      } else if (m.referral?.ref) {
        events.push({ ...base, type: 'ref', eventId: `${m.sender.id}:${m.timestamp}:ref`, ref: m.referral.ref })
      }
    }
    for (const c of entry.changes ?? []) {
      const v = c.value
      if (channel === 'messenger' && c.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.comment_id && v.from) {
        if (cfg.pageId && v.from.id === cfg.pageId) continue // our own comments
        events.push({ channel, channelUserId: v.from.id, eventId: v.comment_id, type: 'comment', text: v.message, commentId: v.comment_id, postId: v.post_id, timestamp: (entry.time ?? Date.now() / 1000) * 1000 })
      }
      if (channel === 'instagram' && c.field === 'comments' && v.id && v.from) {
        if (cfg.instagramAccountId && v.from.id === cfg.instagramAccountId) continue
        events.push({ channel, channelUserId: v.from.id, eventId: v.id, type: 'comment', text: v.text, commentId: v.id, postId: v.media?.id, timestamp: (entry.time ?? Date.now() / 1000) * 1000 })
      }
    }
  }
  return { events, replyTokens }
}

function metaButton(b: OutboundButton) {
  return b.url ? { type: 'web_url', title: b.label.slice(0, 20), url: b.url } : { type: 'postback', title: b.label.slice(0, 20), payload: b.payload ?? b.label }
}

function linksTemplate(links: OutboundButton[], title: string | undefined): Record<string, unknown> {
  return { attachment: { type: 'template', payload: { template_type: 'generic', elements: [{ title: title?.slice(0, 80) || 'Links', buttons: links.slice(0, 3).map(metaButton) }] } } }
}

/** Renders one OutboundMessage into one or more Send API `message` objects. */
export function renderMetaMessages(msg: OutboundMessage, channel: Channel): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  if (msg.imageUrl) out.push({ attachment: { type: 'image', payload: { url: msg.imageUrl, is_reusable: true } } })
  const buttons = msg.buttons ?? []
  // Meta quick replies cannot carry URLs: URL entries are rendered as web_url template buttons instead.
  const quick = (msg.quickReplies ?? []).filter((b) => !b.url)
  const quickLinks = (msg.quickReplies ?? []).filter((b) => b.url)
  if (buttons.length > 0 && channel === 'messenger') {
    out.push({ attachment: { type: 'template', payload: { template_type: 'button', text: (msg.text ?? ' ').slice(0, 640), buttons: buttons.slice(0, 3).map(metaButton) } } })
    if (quickLinks.length > 0) out.push(linksTemplate(quickLinks, msg.text))
  } else if (buttons.length > 0) {
    // Instagram: postback buttons are best delivered as quick replies.
    if (msg.text) out.push({ text: msg.text.slice(0, 1000) })
    quick.unshift(...buttons.filter((b) => !b.url))
    const links = [...buttons.filter((b) => b.url), ...quickLinks]
    if (links.length > 0) out.push(linksTemplate(links, msg.text))
  } else {
    if (msg.text) out.push({ text: msg.text.slice(0, 2000) })
    if (quickLinks.length > 0) out.push(linksTemplate(quickLinks, msg.text))
  }
  if (quick.length > 0 && out.length > 0) {
    const last = out[out.length - 1]!
    last.quick_replies = quick.slice(0, 13).map((b) => ({ content_type: 'text', title: b.label.slice(0, 20), payload: b.payload ?? b.label }))
  }
  return out
}

export class MetaAdapter implements ChannelAdapter {
  constructor(
    readonly channel: Channel,
    private cfg: MetaConfig,
    private version: string = DEFAULT_GRAPH_VERSION,
  ) {}

  private url(path: string, params: Record<string, string> = {}) {
    const u = new URL(`https://graph.facebook.com/${this.version}/${path}`)
    u.searchParams.set('access_token', this.cfg.pageAccessToken)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return u.toString()
  }

  private async post(path: string, body: unknown): Promise<SendResult> {
    const res = await fetch(this.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await res.json().catch(() => ({}))) as { message_id?: string; id?: string; error?: { message?: string; code?: number; error_subcode?: number } }
    if (res.ok && !j.error) return { ok: true, messageId: j.message_id ?? j.id }
    const code = j.error?.code ? `${j.error.code}${j.error.error_subcode ? '/' + j.error.error_subcode : ''}` : String(res.status)
    return { ok: false, error: `Meta ${code}: ${j.error?.message ?? res.statusText}`, code }
  }

  async send(userId: string, message: OutboundMessage, opts?: SendOptions): Promise<SendResult> {
    const messages = renderMetaMessages(message, this.channel)
    let last: SendResult = { ok: true }
    for (const m of messages) {
      const body: Record<string, unknown> = { recipient: { id: userId }, message: m, messaging_type: opts?.tag ? 'MESSAGE_TAG' : 'RESPONSE' }
      if (opts?.tag) body.tag = opts.tag
      last = await this.post('me/messages', body)
      if (!last.ok) return last
    }
    return last
  }

  async sendPrivateReply(commentId: string, message: OutboundMessage): Promise<SendResult> {
    const messages = renderMetaMessages(message, this.channel)
    let last: SendResult = { ok: true }
    for (const m of messages) {
      last = await this.post('me/messages', { recipient: { comment_id: commentId }, message: m })
      if (!last.ok) return last
    }
    return last
  }

  async replyToComment(commentId: string, text: string): Promise<SendResult> {
    const path = this.channel === 'instagram' ? `${commentId}/replies` : `${commentId}/comments`
    return this.post(path, { message: text })
  }

  async likeComment(commentId: string): Promise<SendResult> {
    return this.post(`${commentId}/likes`, {})
  }

  async typing(userId: string): Promise<void> {
    await this.post('me/messages', { recipient: { id: userId }, sender_action: 'typing_on' }).catch(() => undefined)
  }

  async getProfile(userId: string): Promise<ChannelProfile> {
    const fields = this.channel === 'instagram' ? 'name,username,profile_pic,is_user_follow_business' : 'first_name,last_name,profile_pic'
    const res = await fetch(this.url(userId, { fields }))
    if (!res.ok) return {}
    const p = (await res.json()) as { name?: string; username?: string; first_name?: string; last_name?: string; profile_pic?: string; is_user_follow_business?: boolean }
    const displayName = p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ')
    return { displayName: displayName || undefined, username: p.username, avatarUrl: p.profile_pic, followsBusiness: p.is_user_follow_business }
  }
}

/** Setup helpers used by the admin wizard. */
export async function metaInspectPageToken(token: string, version = DEFAULT_GRAPH_VERSION) {
  const u = new URL(`https://graph.facebook.com/${version}/me`)
  u.searchParams.set('fields', 'id,name,instagram_business_account{id,username}')
  u.searchParams.set('access_token', token)
  const res = await fetch(u)
  const j = (await res.json().catch(() => ({}))) as { id?: string; name?: string; instagram_business_account?: { id: string; username?: string }; error?: { message?: string } }
  if (!res.ok || j.error || !j.id) return { ok: false as const, error: j.error?.message ?? `HTTP ${res.status}` }
  return { ok: true as const, pageId: j.id, pageName: j.name ?? '', instagramAccountId: j.instagram_business_account?.id, instagramUsername: j.instagram_business_account?.username }
}

export async function metaSubscribePage(token: string, pageId: string, version = DEFAULT_GRAPH_VERSION) {
  const u = new URL(`https://graph.facebook.com/${version}/${pageId}/subscribed_apps`)
  u.searchParams.set('access_token', token)
  u.searchParams.set('subscribed_fields', 'messages,messaging_postbacks,messaging_referrals,messaging_optins,feed')
  const res = await fetch(u, { method: 'POST' })
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } }
  if (!res.ok || j.error) return { ok: false as const, error: j.error?.message ?? `HTTP ${res.status}` }
  return { ok: true as const }
}
