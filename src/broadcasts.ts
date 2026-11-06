import type { OutboundMessage } from './channels/types'

/** A broadcast button: a link, or an automation started on tap (postback `sk-bc:<broadcastId>:<index>`). */
export type BroadcastButton = { label: string; url?: string; flowId?: number }

type BroadcastRow = { id: number; text: string; imageUrl: string | null; buttons: string | null; messageTag: string | null }

/** `broadcasts.buttons` JSON; anything malformed reads as no buttons. */
export function parseBroadcastButtons(json: string | null | undefined): BroadcastButton[] {
  try {
    const v: unknown = JSON.parse(json ?? '[]')
    return Array.isArray(v) ? (v as BroadcastButton[]) : []
  } catch {
    return []
  }
}

export function broadcastButtonPayload(id: number, index: number): string {
  return `sk-bc:${id}:${index}`
}

export function parseBroadcastPayload(payload: string | undefined): { broadcastId: number; index: number } | null {
  const m = /^sk-bc:(\d+):(\d+)$/.exec(payload ?? '')
  return m ? { broadcastId: Number(m[1]), index: Number(m[2]) } : null
}

export function buildBroadcastMessage(b: BroadcastRow): OutboundMessage {
  const buttons = parseBroadcastButtons(b.buttons).map((x, i) => (x.url ? { label: x.label, url: x.url } : { label: x.label, payload: broadcastButtonPayload(b.id, i) }))
  return { text: b.text, imageUrl: b.imageUrl ?? undefined, ...(buttons.length ? { buttons } : {}) }
}

/**
 * Meta allows ordinary messages only within 24h of the person's last message; outside it the broadcast
 * needs a message tag or is skipped. LINE has no window and ignores tags.
 */
export function broadcastSendPlan(contact: { channel: string; lastInboundAt: string | null }, b: Pick<BroadcastRow, 'messageTag'>, now: number): { skip: string } | { tag?: string } {
  if (contact.channel === 'line') return {}
  const last = contact.lastInboundAt ? new Date(contact.lastInboundAt).getTime() : 0
  if (now - last <= 24 * 3600 * 1000) return {}
  return b.messageTag ? { tag: b.messageTag } : { skip: 'outside 24h window' }
}
