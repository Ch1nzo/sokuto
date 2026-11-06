/** Channels Sokutō can talk to. */
export type Channel = 'line' | 'messenger' | 'instagram'

export const CHANNELS: Channel[] = ['line', 'messenger', 'instagram']

/** Meta message tags that allow sending outside the 24h window. */
export const MESSAGE_TAGS = ['CONFIRMED_EVENT_UPDATE', 'POST_PURCHASE_UPDATE', 'ACCOUNT_UPDATE'] as const

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

/** One carousel column (LINE carousel / Meta generic template element). */
export type OutboundCard = { title: string; subtitle?: string; imageUrl?: string; buttons: OutboundButton[] }

/** Video / audio / file sent before the text. LINE needs previewImageUrl (video) and durationMs (audio). */
export type OutboundAttachment = { type: 'video' | 'audio' | 'file'; url: string; previewImageUrl?: string; durationMs?: number }

/** A normalized outbound message rendered per channel by the adapter. */
export type OutboundMessage = {
  text?: string
  imageUrl?: string
  /** Rendered as quick replies (LINE / Messenger / Instagram). */
  quickReplies?: OutboundButton[]
  /** Rendered as a button template where supported. */
  buttons?: OutboundButton[]
  /** Carousel sent after the text. */
  cards?: OutboundCard[]
  attachment?: OutboundAttachment
}

export type ChannelProfile = {
  displayName?: string
  avatarUrl?: string
  username?: string
  /** Instagram: whether the person follows the business account. */
  followsBusiness?: boolean
}

export type SendResult = { ok: true; messageId?: string } | { ok: false; error: string; code?: string }
