import type { Channel, ChannelProfile, InboundEvent, OutboundMessage, SendResult } from './types'

export type SendOptions = {
  /** LINE reply token, used once if available (free of quota). */
  replyToken?: string
  /** Meta: tag for messages outside the 24h window (rarely used). */
  tag?: string
}

export interface ChannelAdapter {
  readonly channel: Channel
  send(userId: string, message: OutboundMessage, opts?: SendOptions): Promise<SendResult>
  getProfile(userId: string): Promise<ChannelProfile>
  /** Public reply under a comment (Facebook / Instagram). */
  replyToComment?(commentId: string, text: string): Promise<SendResult>
  /** Private message to the author of a comment (Facebook / Instagram). */
  sendPrivateReply?(commentId: string, message: OutboundMessage): Promise<SendResult>
}

/** Adapter used by "Test" runs: records what the bot would send. */
export class RecordingAdapter implements ChannelAdapter {
  readonly sent: OutboundMessage[] = []
  readonly commentReplies: string[] = []
  constructor(readonly channel: Channel) {}
  async send(_userId: string, message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message)
    return { ok: true, messageId: `test-${this.sent.length}` }
  }
  async getProfile(): Promise<ChannelProfile> {
    return { displayName: 'Test user' }
  }
  async replyToComment(_commentId: string, text: string): Promise<SendResult> {
    this.commentReplies.push(text)
    return { ok: true }
  }
  async sendPrivateReply(_commentId: string, message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message)
    return { ok: true }
  }
}

export type ParsedWebhook = { events: InboundEvent[]; replyTokens: Map<string, string> }
