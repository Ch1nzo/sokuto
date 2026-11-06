import { describe, it, expect } from 'vitest'
import { broadcastButtonPayload, broadcastSendPlan, buildBroadcastMessage, parseBroadcastButtons, parseBroadcastPayload } from '../src/broadcasts'
import { renderMetaMessages } from '../src/channels/meta'
import { broadcastButtonsSchema } from '../src/flows/validate'

const NOW = Date.parse('2026-11-06T12:00:00Z')
const HOUR = 3600 * 1000

const bc = (p: Partial<{ id: number; text: string; imageUrl: string | null; buttons: string | null; messageTag: string | null }> = {}) => ({ id: 7, text: 'Sale today', imageUrl: null, buttons: null, messageTag: null, ...p })
const contact = (channel: string, hoursAgo: number | null) => ({ channel, lastInboundAt: hoursAgo === null ? null : new Date(NOW - hoursAgo * HOUR).toISOString() })

describe('parseBroadcastButtons', () => {
  it('reads the stored JSON and treats null / malformed / non-array as no buttons', () => {
    expect(parseBroadcastButtons('[{"label":"Shop","url":"https://shop.example"}]')).toEqual([{ label: 'Shop', url: 'https://shop.example' }])
    expect(parseBroadcastButtons(null)).toEqual([])
    expect(parseBroadcastButtons('{oops')).toEqual([])
    expect(parseBroadcastButtons('{"label":"x"}')).toEqual([])
  })
})

describe('broadcast payload', () => {
  it('round-trips and rejects other payloads', () => {
    expect(broadcastButtonPayload(12, 2)).toBe('sk-bc:12:2')
    expect(parseBroadcastPayload(broadcastButtonPayload(12, 2))).toEqual({ broadcastId: 12, index: 2 })
    expect(parseBroadcastPayload('sk:12:m1:0')).toBeNull()
    expect(parseBroadcastPayload('sk-bc:12')).toBeNull()
    expect(parseBroadcastPayload(undefined)).toBeNull()
  })
})

describe('buildBroadcastMessage', () => {
  it('sends text and image only when there are no buttons', () => {
    expect(buildBroadcastMessage(bc({ imageUrl: 'https://example.com/a.png' }))).toEqual({ text: 'Sale today', imageUrl: 'https://example.com/a.png' })
  })

  it('turns links into URL buttons and automations into sk-bc postbacks', () => {
    const msg = buildBroadcastMessage(bc({ buttons: JSON.stringify([{ label: 'Shop', url: 'https://shop.example' }, { label: 'Book', flowId: 3 }]) }))
    expect(msg.buttons).toEqual([
      { label: 'Shop', url: 'https://shop.example' },
      { label: 'Book', payload: 'sk-bc:7:1' },
    ])
  })

  it('renders as a Messenger button template', () => {
    const out = renderMetaMessages(buildBroadcastMessage(bc({ buttons: JSON.stringify([{ label: 'Book', flowId: 3 }]) })), 'messenger')
    expect(out).toEqual([{ attachment: { type: 'template', payload: { template_type: 'button', text: 'Sale today', buttons: [{ type: 'postback', title: 'Book', payload: 'sk-bc:7:0' }] } } }])
  })
})

describe('broadcastSendPlan', () => {
  it('LINE always sends without a tag', () => {
    expect(broadcastSendPlan(contact('line', null), bc({ messageTag: 'ACCOUNT_UPDATE' }), NOW)).toEqual({})
  })

  it('Meta within 24h sends without a tag even when one is set', () => {
    expect(broadcastSendPlan(contact('messenger', 23), bc({ messageTag: 'ACCOUNT_UPDATE' }), NOW)).toEqual({})
  })

  it('Meta outside 24h is skipped without a tag', () => {
    expect(broadcastSendPlan(contact('instagram', 25), bc(), NOW)).toEqual({ skip: 'outside 24h window' })
    expect(broadcastSendPlan(contact('messenger', null), bc(), NOW)).toEqual({ skip: 'outside 24h window' })
  })

  it('Meta outside 24h sends with the message tag', () => {
    expect(broadcastSendPlan(contact('messenger', 48), bc({ messageTag: 'POST_PURCHASE_UPDATE' }), NOW)).toEqual({ tag: 'POST_PURCHASE_UPDATE' })
  })
})

describe('broadcastButtonsSchema', () => {
  it('needs exactly one of url / flowId and at most 3 buttons', () => {
    expect(broadcastButtonsSchema.safeParse([{ label: ' Shop ', url: 'https://shop.example' }, { label: 'Book', flowId: 3 }]).success).toBe(true)
    expect(broadcastButtonsSchema.safeParse([{ label: 'Both', url: 'https://shop.example', flowId: 3 }]).success).toBe(false)
    expect(broadcastButtonsSchema.safeParse([{ label: 'Neither' }]).success).toBe(false)
    expect(broadcastButtonsSchema.safeParse([{ label: '  ', flowId: 3 }]).success).toBe(false)
    expect(broadcastButtonsSchema.safeParse(Array(4).fill({ label: 'x', flowId: 1 })).success).toBe(false)
  })
})
