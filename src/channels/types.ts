/** Channels Sokuto can talk to. */
export type Channel = 'line' | 'messenger' | 'instagram'

export const CHANNELS: Channel[] = ['line', 'messenger', 'instagram']

/** A normalized inbound event, independent of the originating platform. */
export type InboundEvent = {
  channel: Channel
  /** Platform user id (LINE userId, Messenger PSID, Instagram IGSID). */
  channelUserId: string
  /** Platform-side unique id used for de-duplication. */
  eventId: string
  type: 'message' | 'postback' | 'comment' | 'follow' | 'unfollow' | 'story_mention' | 'story_reply' | 'ref'
  text?: string
  /** Button / quick-reply payload. */
  payload?: string
  /** Referral value from a link (m.me/<page>?ref=..., ig.me, LINE liff state). */
  ref?: string
  /** Comment specific. */
  commentId?: string
  postId?: string
  /** Attachments such as images or stickers. */
  attachments?: { type: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'location'; url?: string }[]
  timestamp: number
}

export type OutboundButton = { label: string; payload?: string; url?: string }

/** A normalized outbound message rendered per channel by the adapter. */
export type OutboundMessage = {
  text?: string
  imageUrl?: string
  /** Rendered as quick replies (LINE / Messenger / Instagram). */
  quickReplies?: OutboundButton[]
  /** Rendered as a button template where supported. */
  buttons?: OutboundButton[]
}

export type ChannelProfile = {
  displayName?: string
  avatarUrl?: string
  username?: string
}

export type SendResult = { ok: true; messageId?: string } | { ok: false; error: string; code?: string }
