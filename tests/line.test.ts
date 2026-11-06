import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { lineLoadingSeconds, parseLineWebhook, renderLineMessages, verifyLineSignature } from '../src/channels/line'

describe('verifyLineSignature', () => {
  const secret = 'line-channel-secret'
  const body = JSON.stringify({ destination: 'U0', events: [] })
  const sig = createHmac('sha256', secret).update(body).digest('base64')

  it('accepts a valid signature', async () => {
    expect(await verifyLineSignature(secret, body, sig)).toBe(true)
  })

  it('rejects a wrong secret', async () => {
    expect(await verifyLineSignature('other-secret', body, sig)).toBe(false)
  })

  it('rejects a modified body', async () => {
    expect(await verifyLineSignature(secret, body + ' ', sig)).toBe(false)
  })

  it('rejects a missing header', async () => {
    expect(await verifyLineSignature(secret, body, undefined)).toBe(false)
    expect(await verifyLineSignature(secret, body, '')).toBe(false)
  })
})

describe('parseLineWebhook', () => {
  const src = (userId: string) => ({ type: 'user', userId })

  it('parses text, sticker, postback, follow and unfollow events', () => {
    const body = JSON.stringify({
      events: [
        { type: 'message', webhookEventId: 'e1', timestamp: 1000, replyToken: 'r1', source: src('U1'), message: { id: 'm1', type: 'text', text: 'こんにちは' } },
        { type: 'message', webhookEventId: 'e2', timestamp: 1001, replyToken: 'r2', source: src('U2'), message: { id: 'm2', type: 'sticker', stickerId: '52002734' } },
        { type: 'postback', webhookEventId: 'e3', timestamp: 1002, replyToken: 'r3', source: src('U3'), postback: { data: 'sk:1:m1:0' } },
        { type: 'follow', webhookEventId: 'e4', timestamp: 1003, replyToken: 'r4', source: src('U4'), follow: { isUnblocked: false } },
        { type: 'unfollow', webhookEventId: 'e5', timestamp: 1004, source: src('U5') },
      ],
    })
    const { events, replyTokens } = parseLineWebhook(body)
    expect(events).toHaveLength(5)
    expect(events[0]).toMatchObject({ channel: 'line', channelUserId: 'U1', eventId: 'e1', type: 'message', text: 'こんにちは', timestamp: 1000 })
    expect(events[1]).toMatchObject({ channelUserId: 'U2', eventId: 'e2', type: 'message', attachments: [{ type: 'sticker' }] })
    expect(events[1]!.text).toBeUndefined()
    expect(events[2]).toMatchObject({ eventId: 'e3', type: 'postback', payload: 'sk:1:m1:0' })
    expect(events[3]).toMatchObject({ eventId: 'e4', type: 'follow', channelUserId: 'U4' })
    expect(events[4]).toMatchObject({ eventId: 'e5', type: 'unfollow', channelUserId: 'U5' })

    expect(replyTokens.get('U1')).toBe('r1')
    expect(replyTokens.get('U2')).toBe('r2')
    expect(replyTokens.get('U3')).toBe('r3')
    expect(replyTokens.get('U4')).toBe('r4')
    expect(replyTokens.has('U5')).toBe(false)
  })

  it('falls back to userId:timestamp when webhookEventId is missing', () => {
    const { events } = parseLineWebhook(JSON.stringify({ events: [{ type: 'follow', timestamp: 42, source: src('U9') }] }))
    expect(events[0]!.eventId).toBe('U9:42')
  })

  it('skips events without a userId and ignores invalid JSON', () => {
    const { events } = parseLineWebhook(JSON.stringify({ events: [{ type: 'follow', timestamp: 1, source: { type: 'group' } }] }))
    expect(events).toHaveLength(0)
    expect(parseLineWebhook('not json').events).toEqual([])
    expect(parseLineWebhook('{}').events).toEqual([])
  })
})

describe('renderLineMessages', () => {
  it('renders text only as a single text message', () => {
    expect(renderLineMessages({ text: 'hello' })).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('renders nothing for an empty message', () => {
    expect(renderLineMessages({})).toEqual([])
  })

  it('renders buttons as a buttons template with at most 4 truncated actions', () => {
    const buttons = [
      { label: 'A very long button label exceeding twenty', payload: 'p1' },
      { label: 'Two', payload: 'p2' },
      { label: 'Link', url: 'https://example.com' },
      { label: 'Four' },
      { label: 'Five', payload: 'p5' },
    ]
    const out = renderLineMessages({ text: 'Choose', buttons })
    expect(out).toHaveLength(1)
    const msg = out[0] as { type: string; altText: string; template: { type: string; text: string; actions: Record<string, string>[] } }
    expect(msg.type).toBe('template')
    expect(msg.altText).toBe('Choose')
    expect(msg.template.type).toBe('buttons')
    expect(msg.template.text).toBe('Choose')
    expect(msg.template.actions).toHaveLength(4)
    for (const a of msg.template.actions) expect(a.label!.length).toBeLessThanOrEqual(20)
    expect(msg.template.actions[0]).toEqual({ type: 'postback', label: 'A very long button l', data: 'p1', displayText: 'A very long button label exceeding twenty' })
    expect(msg.template.actions[2]).toEqual({ type: 'uri', label: 'Link', uri: 'https://example.com' })
    // No payload: label is used as data.
    expect(msg.template.actions[3]).toMatchObject({ type: 'postback', data: 'Four' })
  })

  it('attaches quick replies to the last message as postback actions', () => {
    const out = renderLineMessages({ text: 'Pick', quickReplies: [{ label: 'Yes', payload: 'sk:1:m1:0' }, { label: 'No' }] })
    expect(out).toHaveLength(1)
    const qr = (out[0] as { quickReply: { items: { type: string; action: Record<string, string> }[] } }).quickReply
    expect(qr.items).toHaveLength(2)
    expect(qr.items[0]).toEqual({ type: 'action', action: { type: 'postback', label: 'Yes', data: 'sk:1:m1:0', displayText: 'Yes' } })
    expect(qr.items[1]!.action).toMatchObject({ type: 'postback', data: 'No' })
  })

  it('limits quick replies to 13 items', () => {
    const quickReplies = Array.from({ length: 20 }, (_, i) => ({ label: `o${i}` }))
    const out = renderLineMessages({ text: 'x', quickReplies })
    expect((out[0] as { quickReply: { items: unknown[] } }).quickReply.items).toHaveLength(13)
  })

  it('puts the image first and quick replies on the last message', () => {
    const out = renderLineMessages({ imageUrl: 'https://example.com/a.png', text: 'caption', quickReplies: [{ label: 'OK' }] })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ type: 'image', originalContentUrl: 'https://example.com/a.png', previewImageUrl: 'https://example.com/a.png' })
    expect(out[0]!.quickReply).toBeUndefined()
    expect(out[1]).toMatchObject({ type: 'text', text: 'caption' })
    expect(out[1]!.quickReply).toBeDefined()
  })

  it('renders an image-only message', () => {
    const out = renderLineMessages({ imageUrl: 'https://example.com/a.png' })
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('image')
  })
})

describe('renderLineMessages altText limit', () => {
  it('truncates template altText to 400 characters', () => {
    const out = renderLineMessages({ text: 'a'.repeat(1000), buttons: [{ label: 'A', payload: 'a' }] })
    const tpl = out.find((m) => m.type === 'template')!
    expect(tpl.altText).toBeTypeOf('string')
    expect((tpl.altText as string).length).toBeLessThanOrEqual(400)
  })
})

describe('renderLineMessages cards and attachments', () => {
  const card = (title: string, subtitle?: string) => ({ title, subtitle, imageUrl: 'https://example.com/c.png', buttons: [{ label: 'Buy', payload: 'sk:1:m1:0' }, { label: 'Site', url: 'https://example.com' }] })

  it('renders cards as a carousel after the text', () => {
    const out = renderLineMessages({ text: 'Pick a plan', cards: [card('A'.repeat(50), 'B'.repeat(70)), card('Plan B')], quickReplies: [{ label: 'Later', payload: 'x' }] })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ type: 'text', text: 'Pick a plan' })
    const tpl = out[1] as { type: string; altText: string; template: { type: string; columns: { thumbnailImageUrl?: string; title: string; text: string; actions: Record<string, string>[] }[] }; quickReply?: unknown }
    expect(tpl.type).toBe('template')
    expect(tpl.altText).toBe(`${'A'.repeat(50)} / Plan B`)
    expect(tpl.template.type).toBe('carousel')
    expect(tpl.template.columns).toHaveLength(2)
    expect(tpl.template.columns[0]).toMatchObject({ thumbnailImageUrl: 'https://example.com/c.png', title: 'A'.repeat(40), text: 'B'.repeat(60) })
    // Without a subtitle the title is the column text.
    expect(tpl.template.columns[1]!.text).toBe('Plan B')
    expect(tpl.template.columns[1]!.actions).toEqual([
      { type: 'postback', label: 'Buy', data: 'sk:1:m1:0', displayText: 'Buy' },
      { type: 'uri', label: 'Site', uri: 'https://example.com' },
    ])
    expect(tpl.quickReply).toBeDefined()
  })

  it('renders video with a preview and audio with a duration before the text', () => {
    const video = renderLineMessages({ text: 'Watch', attachment: { type: 'video', url: 'https://example.com/v.mp4', previewImageUrl: 'https://example.com/v.jpg' } })
    expect(video).toEqual([{ type: 'video', originalContentUrl: 'https://example.com/v.mp4', previewImageUrl: 'https://example.com/v.jpg' }, { type: 'text', text: 'Watch' }])
    const audio = renderLineMessages({ attachment: { type: 'audio', url: 'https://example.com/a.m4a', durationMs: 30000 } })
    expect(audio).toEqual([{ type: 'audio', originalContentUrl: 'https://example.com/a.m4a', duration: 30000 }])
  })

  it('sends files and videos without a preview as a text link', () => {
    expect(renderLineMessages({ attachment: { type: 'file', url: 'https://example.com/f.pdf' } })).toEqual([{ type: 'text', text: 'https://example.com/f.pdf' }])
    expect(renderLineMessages({ attachment: { type: 'video', url: 'https://example.com/v.mp4' } })).toEqual([{ type: 'text', text: 'https://example.com/v.mp4' }])
    expect(renderLineMessages({ attachment: { type: 'audio', url: 'https://example.com/a.m4a' } })).toEqual([{ type: 'text', text: 'https://example.com/a.m4a' }])
  })
})

describe('lineLoadingSeconds', () => {
  it('rounds up to a multiple of 5 within 5–60', () => {
    expect([1, 5, 7, 10, 61].map(lineLoadingSeconds)).toEqual([5, 5, 10, 10, 60])
  })
})
