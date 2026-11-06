import { describe, it, expect } from 'vitest'
import { buttonPayload, flattenButtons, flowPayload, matchTrigger, parseButtonPayload, parseFlowPayload, pickPath, renderText, startFlow } from '../src/flows/engine'
import { RecordingAdapter } from '../src/channels/adapter'
import type { Db } from '../src/db'
import type { FlowRecord, Trigger } from '../src/flows/types'
import type { InboundEvent } from '../src/channels/types'
import type { ContactRow } from '../src/contacts'

function flow(triggers: Trigger[], over: Partial<FlowRecord> = {}): FlowRecord {
  return { id: 1, name: 'f', channel: 'any', status: 'live', kind: 'flow', definition: { triggers, entry: null, steps: [] }, createdAt: '', updatedAt: '', ...over }
}

function ev(over: Partial<InboundEvent>): InboundEvent {
  return { channel: 'line', channelUserId: 'U1', eventId: 'e', type: 'message', timestamp: 0, ...over }
}

function contact(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: 1,
    channel: 'line',
    channelUserId: 'U1',
    displayName: 'Taro Yamada',
    avatarUrl: null,
    username: 'taro',
    fields: '{}',
    botPaused: 0,
    botPausedUntil: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    unread: 0,
    status: 'open',
    notes: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

describe('matchTrigger: keyword', () => {
  it('matches contains by default, case-insensitively', () => {
    const t: Trigger = { type: 'keyword', keywords: ['Price'] }
    expect(matchTrigger(flow([t]), ev({ text: 'what is the PRICE?' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ text: 'cost' }), false)).toBeNull()
  })

  it('matches exact', () => {
    const t: Trigger = { type: 'keyword', keywords: ['menu'], match: 'exact' }
    expect(matchTrigger(flow([t]), ev({ text: '  MENU ' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ text: 'menu please' }), false)).toBeNull()
  })

  it('matches starts_with', () => {
    const t: Trigger = { type: 'keyword', keywords: ['予約'], match: 'starts_with' }
    expect(matchTrigger(flow([t]), ev({ text: '予約したい' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ text: '明日予約' }), false)).toBeNull()
  })

  it('matches story replies but not postbacks or empty text', () => {
    const t: Trigger = { type: 'keyword', keywords: ['hi'] }
    expect(matchTrigger(flow([t]), ev({ type: 'story_reply', text: 'hi!' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ type: 'postback', text: 'hi', payload: 'hi' }), false)).toBeNull()
    expect(matchTrigger(flow([t]), ev({ text: '' }), false)).toBeNull()
  })
})

describe('matchTrigger: flow-level filters', () => {
  const t: Trigger = { type: 'keyword', keywords: ['hi'] }

  it('returns null on channel mismatch', () => {
    expect(matchTrigger(flow([t], { channel: 'messenger' }), ev({ channel: 'line', text: 'hi' }), false)).toBeNull()
    expect(matchTrigger(flow([t], { channel: 'line' }), ev({ channel: 'line', text: 'hi' }), false)).toBe(t)
    expect(matchTrigger(flow([t], { channel: 'any' }), ev({ channel: 'instagram', text: 'hi' }), false)).toBe(t)
  })

  it('returns null for draft flows', () => {
    expect(matchTrigger(flow([t], { status: 'draft' }), ev({ text: 'hi' }), false)).toBeNull()
  })
})

describe('matchTrigger: comment', () => {
  it('matches any comment without filters', () => {
    const t: Trigger = { type: 'comment' }
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'anything' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ type: 'message', text: 'anything' }), false)).toBeNull()
  })

  it('filters by keywords', () => {
    const t: Trigger = { type: 'comment', keywords: ['info'] }
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'INFO please' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'nice' }), false)).toBeNull()
  })

  it('filters by postIds', () => {
    const t: Trigger = { type: 'comment', postIds: ['p1'] }
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'x', postId: 'p1' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'x', postId: 'p2' }), false)).toBeNull()
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'x' }), false)).toBeNull()
  })

  it('skips comments that contain an exclude keyword', () => {
    const t: Trigger = { type: 'comment', keywords: ['link'], excludeKeywords: ['spam'] }
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'link pls SPAM' }), false)).toBeNull()
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'link pls' }), false)).toBe(t)
  })

  it('requires both postIds and keywords when both are set', () => {
    const t: Trigger = { type: 'comment', postIds: ['p1'], keywords: ['info'] }
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'info', postId: 'p1' }), false)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'hello', postId: 'p1' }), false)).toBeNull()
    expect(matchTrigger(flow([t]), ev({ type: 'comment', text: 'info', postId: 'p9' }), false)).toBeNull()
  })
})

describe('matchTrigger: other trigger types', () => {
  it('first_message only when isFirstMessage', () => {
    const t: Trigger = { type: 'first_message' }
    expect(matchTrigger(flow([t]), ev({ text: 'hello' }), true)).toBe(t)
    expect(matchTrigger(flow([t]), ev({ text: 'hello' }), false)).toBeNull()
  })

  it('any_message is a lower-priority fallback than keyword within one flow', () => {
    const any: Trigger = { type: 'any_message' }
    const kw: Trigger = { type: 'keyword', keywords: ['price'] }
    const f = flow([any, kw])
    expect(matchTrigger(f, ev({ text: 'price?' }), false)).toBe(kw)
    expect(matchTrigger(f, ev({ text: 'hello' }), false)).toBe(any)
    expect(matchTrigger(f, ev({ type: 'follow' }), false)).toBeNull()
  })

  it('the first fallback in order wins between first_message and any_message', () => {
    const first: Trigger = { type: 'first_message' }
    const any: Trigger = { type: 'any_message' }
    expect(matchTrigger(flow([first, any]), ev({ text: 'x' }), true)).toBe(first)
    expect(matchTrigger(flow([first, any]), ev({ text: 'x' }), false)).toBe(any)
  })

  it('never matches an intent trigger alone (classified by matchIntent)', () => {
    const intent: Trigger = { type: 'intent', description: 'asks about shipping' }
    const any: Trigger = { type: 'any_message' }
    expect(matchTrigger(flow([intent]), ev({ text: 'how much is shipping?' }), true)).toBeNull()
    expect(matchTrigger(flow([intent, any]), ev({ text: 'how much is shipping?' }), false)).toBe(any)
  })

  it('matches follow, ref, postback and story triggers', () => {
    const follow: Trigger = { type: 'follow' }
    const ref: Trigger = { type: 'ref', ref: 'qr1' }
    const pb: Trigger = { type: 'postback', payload: 'GET_STARTED' }
    const sm: Trigger = { type: 'story_mention' }
    const sr: Trigger = { type: 'story_reply' }
    const f = flow([follow, ref, pb, sm, sr])
    expect(matchTrigger(f, ev({ type: 'follow' }), false)).toBe(follow)
    expect(matchTrigger(f, ev({ type: 'ref', ref: 'qr1' }), false)).toBe(ref)
    expect(matchTrigger(f, ev({ type: 'ref', ref: 'other' }), false)).toBeNull()
    expect(matchTrigger(f, ev({ type: 'postback', payload: 'GET_STARTED' }), false)).toBe(pb)
    expect(matchTrigger(f, ev({ type: 'postback', payload: 'X' }), false)).toBeNull()
    expect(matchTrigger(f, ev({ type: 'story_mention' }), false)).toBe(sm)
    expect(matchTrigger(f, ev({ type: 'story_reply', text: 'wow' }), false)).toBe(sr)
  })
})

describe('startFlow', () => {
  const run = async (trigger: Trigger) => {
    const adapter = new RecordingAdapter('messenger')
    await startFlow({ db: {} as unknown as Db, adapter, contact: contact(), flow: flow([trigger]), commentId: 'c1', dryRun: true }, trigger)
    return adapter.likedComments
  }

  it('likes the comment when trigger.like is set', async () => {
    expect(await run({ type: 'comment', like: true })).toEqual(['c1'])
    expect(await run({ type: 'comment' })).toEqual([])
  })
})

describe('renderText', () => {
  const c = contact({ fields: JSON.stringify({ phone: '090-1234-5678', 'order.id': 'A1' }) })

  it('replaces name, first_name, username and last_input', () => {
    expect(renderText('Hi {{name}} / {{first_name}} / @{{username}} / {{last_input}}', c, 'yes')).toBe('Hi Taro Yamada / Taro / @taro / yes')
  })

  it('replaces fields in double and single brace forms, with whitespace and field. prefix', () => {
    expect(renderText('{{phone}} {phone} {{ phone }} {{field.phone}} {{order.id}}', c)).toBe('090-1234-5678 090-1234-5678 090-1234-5678 090-1234-5678 A1')
  })

  it('leaves unknown placeholders as is', () => {
    expect(renderText('{{unknown}} and {other}', c)).toBe('{{unknown}} and {other}')
  })

  it('keeps Japanese names without spaces whole for first_name', () => {
    expect(renderText('{{first_name}}', contact({ displayName: '山田太郎' }))).toBe('山田太郎')
    expect(renderText('{{first_name}}', contact({ displayName: 'テスト 太郎' }))).toBe('テスト')
  })

  it('renders empty strings for missing contact data', () => {
    expect(renderText('[{{name}}][{{first_name}}][{{username}}][{{last_input}}]', contact({ displayName: null, username: null }))).toBe('[][][][]')
  })

  it('tolerates invalid fields JSON', () => {
    expect(renderText('{{phone}} {{name}}', contact({ fields: 'not json' }))).toBe('{{phone}} Taro Yamada')
  })

  it('renders bot variables', () => {
    const p = contact({ fields: JSON.stringify({ phone: '090' }) })
    expect(renderText('{{bot.hours}} / {bot.hours} / {{bot.none}} / {{phone}}', p, undefined, { hours: '10-19' })).toBe('10-19 / 10-19 / {{bot.none}} / 090')
    expect(renderText('{{bot.open-days}}', p, undefined, { 'open-days': 'Mon-Fri' })).toBe('Mon-Fri')
  })

  it('escapes substituted values with encode, leaving the template alone', () => {
    const p = contact({ fields: JSON.stringify({ q: 'a b&c/d', quote: 'say "hi"\n' }) })
    expect(renderText('https://x.test/?q={{q}}&n={{name}}', p, undefined, undefined, encodeURIComponent)).toBe('https://x.test/?q=a%20b%26c%2Fd&n=Taro%20Yamada')
    const body = renderText('{"v": "{{quote}}", "u": "{{unknown}}"}', p, undefined, undefined, (v) => JSON.stringify(v).slice(1, -1))
    expect(JSON.parse(body)).toEqual({ v: 'say "hi"\n', u: '{{unknown}}' })
  })
})

describe('pickPath', () => {
  const data = { data: { price: 1200, ok: true, tags: ['a'], none: null }, items: [{ name: 'Tea' }] }

  it('reads dotted paths and array indexes', () => {
    expect(pickPath(data, 'data.price')).toBe('1200')
    expect(pickPath(data, 'data.ok')).toBe('true')
    expect(pickPath(data, 'items.0.name')).toBe('Tea')
  })

  it('returns JSON for objects and the whole value for an empty path', () => {
    expect(pickPath(data, 'data.tags')).toBe('["a"]')
    expect(pickPath({ a: 1 }, '')).toBe('{"a":1}')
    expect(pickPath('plain text', '')).toBe('plain text')
  })

  it('returns an empty string for missing values', () => {
    for (const path of ['data.missing', 'data.none', 'items.5.name', 'data.price.x', 'constructor', 'data.tags.map']) expect(pickPath(data, path)).toBe('')
    expect(pickPath('plain text', 'a')).toBe('')
    expect(pickPath(null, 'a')).toBe('')
  })
})

describe('buttonPayload / parseButtonPayload', () => {
  it('round trips', () => {
    const p = buttonPayload(12, 'm1', 3)
    expect(p).toBe('sk:12:m1:3')
    expect(parseButtonPayload(p)).toEqual({ flowId: 12, stepId: 'm1', index: 3 })
  })

  it('flattenButtons lists top-level buttons, then card buttons in order', () => {
    const labels = flattenButtons({
      id: 'm1',
      type: 'message',
      text: '',
      buttons: [{ label: 'a' }, { label: 'b' }],
      cards: [
        { title: 'x', buttons: [{ label: 'c' }, { label: 'd' }] },
        { title: 'y', buttons: [{ label: 'e' }, { label: 'f' }] },
      ],
    }).map((b) => b.label)
    expect(labels).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(flattenButtons({ id: 'm2', type: 'message', text: 'x' })).toEqual([])
  })

  it('rejects garbage', () => {
    for (const bad of [undefined, '', 'sk', 'sk:1:m1', 'sk:x:m1:0', 'sk:1:m1:y', 'sk:1::0', 'sk:1:a:b:0', 'xx:1:m1:0', 'sk-choice:yes', ' sk:1:m1:0']) {
      expect(parseButtonPayload(bad)).toBeNull()
    }
  })
})

describe('flowPayload / parseFlowPayload', () => {
  it('round trips', () => {
    expect(flowPayload(3)).toBe('sk-flow:3')
    expect(parseFlowPayload(flowPayload(42))).toBe(42)
  })

  it('rejects other payloads', () => {
    for (const bad of [undefined, '', 'sk-flow:', 'sk-flow:x', 'sk-flow:1:2', 'sk:1:m1:0', 'sk-choice:1', ' sk-flow:1']) {
      expect(parseFlowPayload(bad)).toBeNull()
    }
  })
})
