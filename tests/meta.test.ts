import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildMessengerProfile, parseMetaWebhook, renderMetaMessages, verifyMetaSignature } from '../src/channels/meta'
import { metaProfileSchema } from '../src/settings'

describe('verifyMetaSignature', () => {
  const secret = 'app-secret'
  const body = JSON.stringify({ object: 'page', entry: [] })
  const header = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a valid sha256= signature', async () => {
    expect(await verifyMetaSignature(secret, body, header)).toBe(true)
  })

  it('rejects a wrong secret, a missing header or a missing prefix', async () => {
    expect(await verifyMetaSignature('nope', body, header)).toBe(false)
    expect(await verifyMetaSignature(secret, body, undefined)).toBe(false)
    expect(await verifyMetaSignature(secret, body, header.slice('sha256='.length))).toBe(false)
    expect(await verifyMetaSignature(secret, body, header.replace('sha256=', 'sha1='))).toBe(false)
  })
})

const PAGE_ID = 'PAGE1'
const IG_ID = 'IG1'
const cfg = { pageId: PAGE_ID, instagramAccountId: IG_ID }

describe('parseMetaWebhook (page)', () => {
  const messaging = (m: Record<string, unknown>) => ({ sender: { id: 'PSID1' }, recipient: { id: PAGE_ID }, timestamp: 1700000000000, ...m })

  it('parses a text message', () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: PAGE_ID, messaging: [messaging({ message: { mid: 'mid.1', text: 'hello' } })] }] })
    const { events } = parseMetaWebhook(body, cfg)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ channel: 'messenger', channelUserId: 'PSID1', eventId: 'mid.1', type: 'message', text: 'hello', timestamp: 1700000000000 })
  })

  it('turns a quick reply into a postback with its payload', () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: PAGE_ID, messaging: [messaging({ message: { mid: 'mid.2', text: 'Yes', quick_reply: { payload: 'sk:1:m1:0' } } })] }] })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ type: 'postback', payload: 'sk:1:m1:0', text: 'Yes', eventId: 'mid.2' })
  })

  it('parses a plain postback', () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: PAGE_ID, messaging: [messaging({ postback: { mid: 'pb.1', payload: 'GET_STARTED', title: 'Start' } })] }] })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ type: 'postback', payload: 'GET_STARTED', text: 'Start', eventId: 'pb.1' })
    expect(ev!.ref).toBeUndefined()
  })

  it('turns a postback with a referral into a ref event', () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: PAGE_ID, messaging: [messaging({ postback: { payload: 'GET_STARTED', referral: { ref: 'campaign1' } } })] }] })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ type: 'ref', ref: 'campaign1', payload: 'GET_STARTED', eventId: 'PSID1:1700000000000:pb' })
  })

  it('parses a standalone referral', () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: PAGE_ID, messaging: [messaging({ referral: { ref: 'qr1', source: 'SHORTLINK', type: 'OPEN_THREAD' } })] }] })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ type: 'ref', ref: 'qr1', eventId: 'PSID1:1700000000000:ref' })
  })

  it('ignores echo messages', () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: PAGE_ID, messaging: [messaging({ message: { mid: 'mid.3', text: 'bot said', is_echo: true } })] }] })
    expect(parseMetaWebhook(body, cfg).events).toHaveLength(0)
  })

  it('parses a new feed comment', () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: PAGE_ID, time: 1700000000, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'PAGE1_post1', message: '詳細ください', from: { id: 'U100', name: 'Alice' } } }] }],
    })
    const { events } = parseMetaWebhook(body, cfg)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ channel: 'messenger', channelUserId: 'U100', eventId: 'c1', type: 'comment', text: '詳細ください', commentId: 'c1', postId: 'PAGE1_post1', timestamp: 1700000000000 })
  })

  it('ignores comments written by the page itself', () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: PAGE_ID, time: 1, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c2', post_id: 'p', message: 'thanks', from: { id: PAGE_ID } } }] }],
    })
    expect(parseMetaWebhook(body, cfg).events).toHaveLength(0)
  })

  it('ignores edited/removed comments and non-comment feed items', () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: PAGE_ID,
          time: 1,
          changes: [
            { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c3', from: { id: 'U1' } } },
            { field: 'feed', value: { item: 'reaction', verb: 'add', from: { id: 'U1' } } },
          ],
        },
      ],
    })
    expect(parseMetaWebhook(body, cfg).events).toHaveLength(0)
  })

  it('returns no events for invalid JSON', () => {
    expect(parseMetaWebhook('nope', cfg).events).toEqual([])
  })
})

describe('parseMetaWebhook (instagram)', () => {
  it('parses a comments change', () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ID, time: 1700000001, changes: [{ field: 'comments', value: { id: 'igc1', text: 'price?', from: { id: 'IGU1', username: 'bob' }, media: { id: 'media1' } } }] }],
    })
    const { events } = parseMetaWebhook(body, cfg)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ channel: 'instagram', channelUserId: 'IGU1', eventId: 'igc1', type: 'comment', text: 'price?', commentId: 'igc1', postId: 'media1', timestamp: 1700000001000 })
  })

  it('ignores comments from the instagram account itself', () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ID, time: 1, changes: [{ field: 'comments', value: { id: 'igc2', text: 'reply', from: { id: IG_ID } } }] }],
    })
    expect(parseMetaWebhook(body, cfg).events).toHaveLength(0)
  })

  it('does not treat instagram feed changes as messenger comments', () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ID, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'x', from: { id: 'U' } } }] }],
    })
    expect(parseMetaWebhook(body, cfg).events).toHaveLength(0)
  })

  it('parses a story mention', () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ID, messaging: [{ sender: { id: 'IGU2' }, recipient: { id: IG_ID }, timestamp: 5, message: { mid: 'igm1', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/story.jpg' } }] } }] }],
    })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ channel: 'instagram', type: 'story_mention', eventId: 'igm1', attachments: [{ type: 'image', url: 'https://cdn/story.jpg' }] })
  })

  it('parses a story reply', () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ID, messaging: [{ sender: { id: 'IGU3' }, recipient: { id: IG_ID }, timestamp: 6, message: { mid: 'igm2', text: 'nice!', reply_to: { story: { url: 'https://cdn/s2.jpg', id: 's2' } } } }] }],
    })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ channel: 'instagram', type: 'story_reply', eventId: 'igm2', text: 'nice!', attachments: [{ type: 'image', url: 'https://cdn/s2.jpg' }] })
  })

  it('maps message attachments', () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ID, messaging: [{ sender: { id: 'IGU4' }, recipient: { id: IG_ID }, timestamp: 7, message: { mid: 'igm3', attachments: [{ type: 'image', payload: { url: 'https://cdn/i.jpg' } }, { type: 'reel', payload: {} }] } }] }],
    })
    const [ev] = parseMetaWebhook(body, cfg).events
    expect(ev).toMatchObject({ type: 'message', attachments: [{ type: 'image', url: 'https://cdn/i.jpg' }, { type: 'file' }] })
  })
})

describe('renderMetaMessages', () => {
  it('renders plain text', () => {
    expect(renderMetaMessages({ text: 'hi' }, 'messenger')).toEqual([{ text: 'hi' }])
  })

  it('renders messenger buttons as a button template with at most 3 buttons', () => {
    const out = renderMetaMessages(
      {
        text: 'Choose',
        buttons: [
          { label: 'One', payload: 'p1' },
          { label: 'Site', url: 'https://example.com' },
          { label: 'A label longer than twenty chars', payload: 'p3' },
          { label: 'Four', payload: 'p4' },
        ],
      },
      'messenger',
    )
    expect(out).toHaveLength(1)
    const payload = (out[0] as { attachment: { type: string; payload: { template_type: string; text: string; buttons: Record<string, string>[] } } }).attachment
    expect(payload.type).toBe('template')
    expect(payload.payload.template_type).toBe('button')
    expect(payload.payload.text).toBe('Choose')
    expect(payload.payload.buttons).toHaveLength(3)
    expect(payload.payload.buttons[0]).toEqual({ type: 'postback', title: 'One', payload: 'p1' })
    expect(payload.payload.buttons[1]).toEqual({ type: 'web_url', title: 'Site', url: 'https://example.com' })
    expect(payload.payload.buttons[2]!.title).toHaveLength(20)
  })

  it('renders instagram postback buttons as text + quick replies', () => {
    const out = renderMetaMessages({ text: 'Choose', buttons: [{ label: 'Yes', payload: 'py' }, { label: 'No', payload: 'pn' }] }, 'instagram')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      text: 'Choose',
      quick_replies: [
        { content_type: 'text', title: 'Yes', payload: 'py' },
        { content_type: 'text', title: 'No', payload: 'pn' },
      ],
    })
  })

  it('renders instagram link buttons as a generic template', () => {
    const out = renderMetaMessages({ text: 'Links', buttons: [{ label: 'Shop', url: 'https://shop.example' }] }, 'instagram')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ text: 'Links' })
    expect((out[1] as { attachment: { payload: { template_type: string } } }).attachment.payload.template_type).toBe('generic')
  })

  it('appends quick replies to the last message with content_type text', () => {
    const out = renderMetaMessages({ imageUrl: 'https://example.com/a.png', text: 'Pick', quickReplies: [{ label: 'A', payload: 'pa' }, { label: 'B' }] }, 'messenger')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ attachment: { type: 'image', payload: { url: 'https://example.com/a.png', is_reusable: true } } })
    expect(out[0]!.quick_replies).toBeUndefined()
    expect(out[1]).toEqual({
      text: 'Pick',
      quick_replies: [
        { content_type: 'text', title: 'A', payload: 'pa' },
        { content_type: 'text', title: 'B', payload: 'B' },
      ],
    })
  })

  it('renders an image-only attachment', () => {
    expect(renderMetaMessages({ imageUrl: 'https://example.com/b.png' }, 'instagram')).toEqual([{ attachment: { type: 'image', payload: { url: 'https://example.com/b.png', is_reusable: true } } }])
  })
})

describe('renderMetaMessages cards and attachments', () => {
  const cards = [
    { title: 'T'.repeat(90), subtitle: 'S'.repeat(90), imageUrl: 'https://example.com/c.png', buttons: [{ label: 'Buy', payload: 'sk:1:m1:0' }, { label: 'Site', url: 'https://example.com' }] },
    { title: 'Plain', buttons: [] },
  ]

  for (const channel of ['messenger', 'instagram'] as const) {
    it(`renders cards as a generic template on ${channel}`, () => {
      const out = renderMetaMessages({ text: 'Plans', cards }, channel)
      expect(out).toHaveLength(2)
      expect(out[0]).toEqual({ text: 'Plans' })
      const payload = (out[1] as { attachment: { type: string; payload: { template_type: string; elements: Record<string, unknown>[] } } }).attachment
      expect(payload.type).toBe('template')
      expect(payload.payload.template_type).toBe('generic')
      expect(payload.payload.elements[0]).toEqual({
        title: 'T'.repeat(80),
        subtitle: 'S'.repeat(80),
        image_url: 'https://example.com/c.png',
        buttons: [
          { type: 'postback', title: 'Buy', payload: 'sk:1:m1:0' },
          { type: 'web_url', title: 'Site', url: 'https://example.com' },
        ],
      })
      expect(payload.payload.elements[1]!.buttons).toBeUndefined()
    })
  }

  it('sends video, audio and file as attachments before the text', () => {
    const out = renderMetaMessages({ text: 'Here', attachment: { type: 'file', url: 'https://example.com/f.pdf' } }, 'messenger')
    expect(out).toEqual([{ attachment: { type: 'file', payload: { url: 'https://example.com/f.pdf', is_reusable: true } } }, { text: 'Here' }])
    expect(renderMetaMessages({ attachment: { type: 'video', url: 'https://example.com/v.mp4' } }, 'instagram')).toEqual([{ attachment: { type: 'video', payload: { url: 'https://example.com/v.mp4', is_reusable: true } } }])
    expect(renderMetaMessages({ attachment: { type: 'audio', url: 'https://example.com/a.m4a', durationMs: 1000 } }, 'messenger')).toEqual([{ attachment: { type: 'audio', payload: { url: 'https://example.com/a.m4a', is_reusable: true } } }])
  })

  it('sends a file as a link on instagram', () => {
    expect(renderMetaMessages({ attachment: { type: 'file', url: 'https://example.com/f.pdf' } }, 'instagram')).toEqual([{ text: 'https://example.com/f.pdf' }])
  })
})

describe('renderMetaMessages URL quick replies', () => {
  it('renders URL quick replies as web_url buttons and keeps only non-URL quick replies', () => {
    const out = renderMetaMessages({ text: 'x', quickReplies: [{ label: 'Site', url: 'https://x' }, { label: 'A', payload: 'a' }] }, 'messenger')
    expect(out[0]).toMatchObject({ text: 'x' })
    const json = JSON.stringify(out)
    expect(json).toContain('"type":"web_url"')
    expect(json).toContain('"url":"https://x"')
    const last = out[out.length - 1]!
    expect(last.quick_replies).toEqual([{ content_type: 'text', title: 'A', payload: 'a' }])
    expect(out.filter((m) => m.quick_replies)).toHaveLength(1)
  })
})

describe('buildMessengerProfile', () => {
  const base = { menu: [], iceBreakers: [], applyToInstagram: false }

  it('builds every field with sk-flow payloads', () => {
    const { set, remove } = buildMessengerProfile({
      ...base,
      greeting: 'こんにちは',
      getStartedFlowId: 3,
      menu: [{ label: 'Shop', url: 'https://example.com' }, { label: 'Order', flowId: 4 }],
      iceBreakers: [{ question: 'Hours?', flowId: 5 }],
    })
    expect(remove).toEqual([])
    expect(set.get_started).toEqual({ payload: 'sk-flow:3' })
    expect(set.greeting).toEqual([{ locale: 'default', text: 'こんにちは' }])
    expect(set.persistent_menu).toEqual([
      {
        locale: 'default',
        composer_input_disabled: false,
        call_to_actions: [
          { type: 'web_url', title: 'Shop', url: 'https://example.com' },
          { type: 'postback', title: 'Order', payload: 'sk-flow:4' },
        ],
      },
    ])
    expect(set.ice_breakers).toEqual([{ locale: 'default', call_to_actions: [{ question: 'Hours?', payload: 'sk-flow:5' }] }])
  })

  it('lists empty settings for removal (menu before get_started) and cuts the greeting to 160', () => {
    const { set, remove } = buildMessengerProfile({ ...base, greeting: 'a'.repeat(200) })
    expect(Object.keys(set)).toEqual(['greeting'])
    expect((set.greeting as { text: string }[])[0]!.text).toHaveLength(160)
    expect(remove).toEqual(['persistent_menu', 'ice_breakers', 'get_started'])
  })

  it('schema requires exactly one of url / flowId per menu item', () => {
    const parse = (item: object) => metaProfileSchema.safeParse({ menu: [{ label: 'A', ...item }] }).success
    expect(parse({ flowId: 1 })).toBe(true)
    expect(parse({ url: 'https://example.com' })).toBe(true)
    expect(parse({})).toBe(false)
    expect(parse({ flowId: 1, url: 'https://example.com' })).toBe(false)
  })
})
