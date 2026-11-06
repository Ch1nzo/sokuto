import { describe, it, expect } from 'vitest'
import { simulateFlow } from '../src/flows/simulate'
import type { Db } from '../src/db'
import type { FlowDefinition, FlowRecord } from '../src/flows/types'
import type { AiCaller, AiRequest } from '../src/ai'

const db = {} as unknown as Db

function flow(definition: FlowDefinition, over: Partial<FlowRecord> = {}): FlowRecord {
  return { id: 7, workspaceId: 1, name: 'Test flow', channel: 'line', status: 'draft', kind: 'flow', definition, createdAt: '', updatedAt: '', ...over }
}

describe('simulateFlow', () => {
  const leadFlow = flow({
    triggers: [{ type: 'keyword', keywords: ['price'] }],
    entry: 'm1',
    steps: [
      { id: 'm1', type: 'message', text: 'Hi {{first_name}}!', next: 'q1' },
      { id: 'q1', type: 'question', text: 'Your phone number?', field: 'phone', next: 'a1' },
      { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'lead' }, { type: 'notify', text: 'New lead {{phone}}' }], next: 'm2' },
      { id: 'm2', type: 'message', text: 'Thanks, we will call {{phone}}', next: null },
    ],
  })

  it('runs a keyword flow through a question and actions', async () => {
    const first = await simulateFlow(db, leadFlow, [{ type: 'message', text: 'price' }])
    expect(first.steps).toHaveLength(1)
    const s0 = first.steps[0]!
    expect(s0.triggered).toBe(true)
    expect(s0.outputs.map((o) => o.text)).toEqual(['Hi テスト!', 'Your phone number?'])
    expect(s0.waiting).toBe('input')
    expect(s0.stepId).toBe('q1')
    expect(first.completed).toBe(false)

    const r = await simulateFlow(db, leadFlow, [
      { type: 'message', text: 'price' },
      { type: 'message', text: '090-1111-2222' },
    ])
    const s1 = r.steps[1]!
    expect(s1.triggered).toBe(true)
    expect(s1.outputs.map((o) => o.text)).toEqual(['Thanks, we will call 090-1111-2222'])
    expect(s1.waiting).toBeNull()
    expect(r.fields.phone).toBe('090-1111-2222')
    expect(r.tags).toContain('lead')
    expect(r.notifications).toEqual(['New lead 090-1111-2222'])
    expect(r.completed).toBe(true)
  })

  it('waits for a button tap and follows the chosen branch', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['menu'] }],
      entry: 'm1',
      steps: [
        { id: 'm1', type: 'message', text: 'Pick one', buttons: [{ label: 'Coffee', next: 'c' }, { label: 'Tea', next: 't' }] },
        { id: 'c', type: 'message', text: 'Coffee it is' },
        { id: 't', type: 'message', text: 'Tea it is' },
      ],
    })
    const r = await simulateFlow(db, f, [
      { type: 'message', text: 'menu' },
      { type: 'message', button: 'Tea' },
    ])
    const s0 = r.steps[0]!
    expect(s0.waiting).toBe('button')
    expect(s0.stepId).toBe('m1')
    expect(s0.outputs).toHaveLength(1)
    expect(s0.outputs[0]!.quickReplies?.map((q) => [q.label, q.payload])).toEqual([
      ['Coffee', 'sk:7:m1:0'],
      ['Tea', 'sk:7:m1:1'],
    ])
    const s1 = r.steps[1]!
    expect(s1.triggered).toBe(true)
    expect(s1.outputs.map((o) => o.text)).toEqual(['Tea it is'])
    expect(r.completed).toBe(true)
  })

  it('card buttons use a global payload index and resume the chosen branch', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['menu'] }],
      entry: 'm1',
      steps: [
        {
          id: 'm1',
          type: 'message',
          text: 'Pick one',
          buttons: [{ label: 'Later', next: 'l' }],
          cards: [
            { title: 'Coffee', subtitle: 'Hot', buttons: [{ label: 'Coffee', next: 'c' }] },
            { title: 'Tea', imageUrl: 'https://example.com/tea.png', buttons: [{ label: 'Tea', next: 't' }] },
          ],
        },
        { id: 'l', type: 'message', text: 'Later then' },
        { id: 'c', type: 'message', text: 'Coffee it is' },
        { id: 't', type: 'message', text: 'Tea it is' },
      ],
    })
    const r = await simulateFlow(db, f, [
      { type: 'message', text: 'menu' },
      { type: 'message', button: 'Tea' },
    ])
    const out = r.steps[0]!.outputs[0]!
    expect(r.steps[0]!.waiting).toBe('button')
    expect(out.quickReplies?.map((q) => q.payload)).toEqual(['sk:7:m1:0'])
    expect(out.cards?.[0]).toEqual({ title: 'Coffee', subtitle: 'Hot', imageUrl: undefined, buttons: [{ label: 'Coffee', url: undefined, payload: 'sk:7:m1:1' }] })
    expect(out.cards?.[1]!.buttons[0]!.payload).toBe('sk:7:m1:2')
    expect(r.steps[1]!.outputs.map((o) => o.text)).toEqual(['Tea it is'])
    expect(r.completed).toBe(true)
  })

  it('branches on a numeric condition with lte', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['rate'] }],
      entry: 'q1',
      steps: [
        { id: 'q1', type: 'question', text: 'Rate us 1-5', field: 'rating', next: 'c1' },
        { id: 'c1', type: 'condition', rules: [{ field: 'rating', op: 'lte', value: '2' }], yes: 'low', no: 'high' },
        { id: 'low', type: 'message', text: 'Sorry to hear that' },
        { id: 'high', type: 'message', text: 'Thank you!' },
      ],
    })
    const low = await simulateFlow(db, f, [{ type: 'message', text: 'rate' }, { type: 'message', text: '2' }])
    expect(low.steps[1]!.outputs.map((o) => o.text)).toEqual(['Sorry to hear that'])
    const high = await simulateFlow(db, f, [{ type: 'message', text: 'rate' }, { type: 'message', text: '5' }])
    expect(high.steps[1]!.outputs.map((o) => o.text)).toEqual(['Thank you!'])
    const nan = await simulateFlow(db, f, [{ type: 'message', text: 'rate' }, { type: 'message', text: 'great' }])
    expect(nan.steps[1]!.outputs.map((o) => o.text)).toEqual(['Thank you!'])
  })

  it('replies publicly and privately to a comment', async () => {
    const f = flow(
      {
        triggers: [{ type: 'comment', keywords: ['info'] }],
        entry: 'cr',
        steps: [
          { id: 'cr', type: 'comment_reply', text: 'Sent you a DM, {{first_name}}', next: 'm1' },
          { id: 'm1', type: 'message', text: 'Here is the info' },
        ],
      },
      { channel: 'messenger' },
    )
    const r = await simulateFlow(db, f, [{ type: 'comment', text: 'info please' }])
    const s0 = r.steps[0]!
    expect(s0.triggered).toBe(true)
    expect(s0.commentReplies).toEqual(['Sent you a DM, テスト'])
    expect(s0.outputs.map((o) => o.text)).toEqual(['Here is the info'])
    expect(r.completed).toBe(true)
  })

  it('comment_reply uses the first variant in dry runs', async () => {
    const reply = (text: string, texts?: string[]) => flow({ triggers: [{ type: 'comment' }], entry: 'cr', steps: [{ id: 'cr', type: 'comment_reply', text, texts }] }, { channel: 'instagram' })
    expect((await simulateFlow(db, reply('', ['B', 'C']), [{ type: 'comment', text: 'hi' }])).steps[0]!.commentReplies).toEqual(['B'])
    expect((await simulateFlow(db, reply('A', ['B', 'C']), [{ type: 'comment', text: 'hi' }])).steps[0]!.commentReplies).toEqual(['A'])
  })

  it('is_follower is true for the test user', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['go'] }],
      entry: 'c1',
      steps: [
        { id: 'c1', type: 'condition', rules: [{ field: 'is_follower', op: 'equals', value: 'true' }], yes: 'y', no: 'n' },
        { id: 'y', type: 'message', text: 'yes' },
        { id: 'n', type: 'message', text: 'no' },
      ],
    }, { channel: 'any' })
    for (const channel of ['instagram', 'line'] as const) {
      const r = await simulateFlow(db, f, [{ type: 'message', text: 'go' }], channel)
      expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['yes'])
    }
  })

  it('does nothing for input that matches no trigger', async () => {
    const r = await simulateFlow(db, leadFlow, [{ type: 'message', text: 'hello' }])
    expect(r.steps[0]!.triggered).toBe(false)
    expect(r.steps[0]!.outputs).toEqual([])
    expect(r.steps[0]!.commentReplies).toEqual([])
    expect(r.completed).toBe(true)
  })

  it('follows a random step with a single branch', async () => {
    const f = flow({
      triggers: [{ type: 'any_message' }],
      entry: 'r1',
      steps: [
        { id: 'r1', type: 'random', branches: [{ weight: 1, next: 'm1' }] },
        { id: 'm1', type: 'message', text: 'Picked' },
      ],
    })
    const r = await simulateFlow(db, f, [{ type: 'message', text: 'x' }])
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['Picked'])
    expect(r.completed).toBe(true)
  })

  it('skips delay steps in a dry run', async () => {
    const f = flow({
      triggers: [{ type: 'follow' }],
      entry: 'm1',
      steps: [
        { id: 'm1', type: 'message', text: 'Welcome', next: 'd1' },
        { id: 'd1', type: 'delay', seconds: 3600, next: 'm2' },
        { id: 'm2', type: 'message', text: 'An hour later' },
      ],
    })
    const r = await simulateFlow(db, f, [{ type: 'follow' }])
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['Welcome', 'An hour later'])
    expect(r.steps[0]!.waiting).toBeNull()
    expect(r.completed).toBe(true)
  })

  it('skips request steps in a dry run and records a note', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['price'] }],
      entry: 'rq1',
      steps: [
        { id: 'rq1', type: 'request', method: 'GET', url: 'https://api.example.com/price?q={{last_input}}', save: [{ field: 'price', path: 'data.price' }], next: 'm1' },
        { id: 'm1', type: 'message', text: 'Price: {{price}}' },
      ],
    })
    const r = await simulateFlow(db, f, [{ type: 'message', text: 'price tea' }])
    expect(r.notes).toEqual(['request rq1: skipped GET https://api.example.com/price?q=price%20tea'])
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['Price: {{price}}'])
    expect(r.fields).toEqual({})
    expect(r.completed).toBe(true)
  })

  it('treats draft flows as live and respects first_message', async () => {
    const f = flow({ triggers: [{ type: 'first_message' }], entry: 'm1', steps: [{ id: 'm1', type: 'message', text: 'First!' }] })
    const r = await simulateFlow(db, f, [{ type: 'message', text: 'a' }, { type: 'message', text: 'b' }])
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['First!'])
    expect(r.steps[1]!.triggered).toBe(false)
    const old = await simulateFlow(db, f, [{ type: 'message', text: 'a' }], 'line', false)
    expect(old.steps[0]!.triggered).toBe(false)
  })

  it('accepts a question choice tapped as a button', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['size'] }],
      entry: 'q1',
      steps: [
        { id: 'q1', type: 'question', text: 'Size?', field: 'size', choices: ['S', 'M', 'L'], next: 'm1' },
        { id: 'm1', type: 'message', text: 'Size {{size}} noted' },
      ],
    })
    const r = await simulateFlow(db, f, [{ type: 'message', text: 'size' }, { type: 'message', button: 'M' }])
    expect(r.steps[0]!.outputs[0]!.quickReplies?.map((q) => q.payload)).toEqual(['sk-choice:S', 'sk-choice:M', 'sk-choice:L'])
    expect(r.steps[1]!.outputs.map((o) => o.text)).toEqual(['Size M noted'])
    expect(r.fields.size).toBe('M')
  })

  const emailFlow = (q: Record<string, unknown> = {}) =>
    flow({
      triggers: [{ type: 'keyword', keywords: ['join'] }],
      entry: 'q1',
      steps: [
        { id: 'q1', type: 'question', text: 'Email?', field: 'email', validate: 'email', ...q, next: 'm2' },
        { id: 'm2', type: 'message', text: 'OK {{email}}' },
      ],
    })

  it('re-asks an invalid answer and accepts a valid one', async () => {
    const r = await simulateFlow(db, emailFlow({ retryText: 'メール形式で' }), [
      { type: 'message', text: 'join' },
      { type: 'message', text: 'nope' },
      { type: 'message', text: 'a@b.co' },
    ])
    expect(r.steps[1]!.outputs.map((o) => o.text)).toEqual(['メール形式で'])
    expect(r.steps[1]!.waiting).toBe('input')
    expect(r.steps[2]!.outputs.map((o) => o.text)).toEqual(['OK a@b.co'])
    expect(r.fields.email).toBe('a@b.co')
    expect(r.completed).toBe(true)
  })

  it('uses the default retry text', async () => {
    const r = await simulateFlow(db, emailFlow(), [
      { type: 'message', text: 'join' },
      { type: 'message', text: 'nope' },
    ])
    expect(r.steps[1]!.outputs.map((o) => o.text)).toEqual(['入力内容を確認して、もう一度送ってください。'])
    expect(r.completed).toBe(false)
  })

  it('skips a question with the skip quick reply', async () => {
    const r = await simulateFlow(db, emailFlow({ skipLabel: 'スキップ' }), [
      { type: 'message', text: 'join' },
      { type: 'message', button: 'スキップ' },
    ])
    expect(r.steps[0]!.outputs[0]!.quickReplies?.at(-1)).toEqual({ label: 'スキップ', payload: 'sk-skip' })
    expect(r.steps[1]!.outputs.map((o) => o.text)).toEqual(['OK {{email}}'])
    expect(r.fields.email).toBeUndefined()
    expect(r.completed).toBe(true)
  })

  it('renders bot variables from options', async () => {
    const f = flow({ triggers: [{ type: 'keyword', keywords: ['hours'] }], entry: 'm1', steps: [{ id: 'm1', type: 'message', text: 'Open {{bot.hours}}' }] })
    const withOpts = await simulateFlow(db, f, [{ type: 'message', text: 'hours' }], 'line', true, { botFields: { hours: '10:00〜19:00' } })
    expect(withOpts.steps[0]!.outputs.map((o) => o.text)).toEqual(['Open 10:00〜19:00'])
    const without = await simulateFlow(db, f, [{ type: 'message', text: 'hours' }])
    expect(without.steps[0]!.outputs.map((o) => o.text)).toEqual(['Open {{bot.hours}}'])
  })
})

describe('sequences', () => {
  const seq = flow(
    {
      triggers: [],
      entry: 'm1',
      steps: [
        { id: 'm1', type: 'message', text: 'Day 1', buttons: [{ label: 'A', next: 'm3' }], next: 'd1' },
        { id: 'd1', type: 'delay', seconds: 86400, next: 'm2' },
        { id: 'm2', type: 'message', text: 'Day 2' },
        { id: 'm3', type: 'message', text: 'Picked A' },
      ],
    },
    { kind: 'sequence' },
  )

  it('plays a sequence from start without waiting for buttons or delays', async () => {
    const r = await simulateFlow(db, seq, [{ type: 'start' }])
    const s0 = r.steps[0]!
    expect(s0.triggered).toBe(true)
    expect(s0.outputs.map((o) => o.text)).toEqual(['Day 1', 'Day 2'])
    expect(s0.waiting).toBeNull()
    expect(r.completed).toBe(true)
  })

  it('runs a button branch tapped after the sequence moved on', async () => {
    const r = await simulateFlow(db, seq, [{ type: 'start' }, { type: 'message', button: 'A' }])
    expect(r.steps[1]!.triggered).toBe(true)
    expect(r.steps[1]!.outputs.map((o) => o.text)).toEqual(['Picked A'])
  })

  it('start runs a normal flow from its entry without a trigger', async () => {
    const f = flow({ triggers: [{ type: 'keyword', keywords: ['x'] }], entry: 'm1', steps: [{ id: 'm1', type: 'message', text: 'Hello', buttons: [{ label: 'Go', next: 'm2' }] }, { id: 'm2', type: 'message', text: 'Gone' }] })
    const r = await simulateFlow(db, f, [{ type: 'start' }])
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['Hello'])
    expect(r.steps[0]!.waiting).toBe('button')
  })
})

describe('time and recency conditions', () => {
  const branch = (rules: Array<{ field: string; op: 'equals' | 'gte' | 'lt' | 'is_empty'; value?: string }>) =>
    flow({
      triggers: [{ type: 'keyword', keywords: ['go'] }],
      entry: 'c1',
      steps: [
        { id: 'c1', type: 'condition', rules, yes: 'y', no: 'n' },
        { id: 'y', type: 'message', text: 'yes' },
        { id: 'n', type: 'message', text: 'no' },
      ],
    })
  const run = async (f: FlowRecord, timezone?: string, now?: () => Date) => (await simulateFlow(db, f, [{ type: 'message', text: 'go' }], 'line', true, { timezone, now })).steps[0]!.outputs.map((o) => o.text)
  const at = (iso: string) => () => new Date(iso)

  it('evaluates hour and weekday in the given timezone', async () => {
    const officeHours = branch([
      { field: 'hour', op: 'gte', value: '9' },
      { field: 'hour', op: 'lt', value: '18' },
      { field: 'weekday', op: 'equals', value: '1' },
    ])
    // Monday 12:00 in Tokyo, 03:00 in UTC.
    expect(await run(officeHours, 'Asia/Tokyo', at('2025-01-06T03:00:00Z'))).toEqual(['yes'])
    expect(await run(officeHours, 'UTC', at('2025-01-06T03:00:00Z'))).toEqual(['no'])
    // Sunday 12:00 in Tokyo.
    expect(await run(officeHours, 'Asia/Tokyo', at('2025-01-05T03:00:00Z'))).toEqual(['no'])
  })

  it('days_since_created counts whole days', async () => {
    const f = branch([
      { field: 'days_since_created', op: 'equals', value: '3' },
      { field: 'days_since_last_inbound', op: 'is_empty' },
    ])
    const start = Date.now()
    expect(await run(f, undefined, () => new Date(start + 3.5 * 86_400_000))).toEqual(['yes'])
    expect(await run(f)).toEqual(['no'])
  })

  it('falls back to UTC for an invalid timezone', async () => {
    const f = branch([{ field: 'hour', op: 'equals', value: '3' }])
    expect(await run(f, 'Not/AZone', at('2025-01-06T03:00:00Z'))).toEqual(['yes'])
    expect(await run(f, 'Asia/Tokyo', at('2025-01-06T03:00:00Z'))).toEqual(['no'])
  })
})

describe('numeric conditions on unset fields', () => {
  it('takes the no branch when the contact field is unset (empty is not 0)', async () => {
    const f = flow({
      triggers: [{ type: 'keyword', keywords: ['go'] }],
      entry: 'c1',
      steps: [
        { id: 'c1', type: 'condition', rules: [{ field: 'rating', op: 'lte', value: '2' }], yes: 'low', no: 'high' },
        { id: 'low', type: 'message', text: 'low' },
        { id: 'high', type: 'message', text: 'high' },
      ],
    })
    const r = await simulateFlow(db, f, [{ type: 'message', text: 'go' }])
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['high'])
  })
})

describe('ai step', () => {
  const aiFlow = (maxTurns?: number) =>
    flow({
      triggers: [{ type: 'keyword', keywords: ['help'] }],
      entry: 'ai1',
      steps: [
        { id: 'ai1', type: 'ai', instructions: 'You help {{first_name}} at {{bot.shop}}.', knowledge: 'Open 9-17', maxTurns, next: 'm1' },
        { id: 'm1', type: 'message', text: 'Bye' },
      ],
    })
  /** Fake model: echoes the last user message, done once the user says thanks. */
  const echo = (calls: AiRequest[]): AiCaller => async (req) => {
    calls.push(req)
    const last = req.messages.at(-1)!.content
    return '```json\n' + JSON.stringify({ reply: `echo: ${last}`, done: last.includes('thanks') }) + '\n```'
  }
  const texts = (r: Awaited<ReturnType<typeof simulateFlow>>) => r.steps.map((s) => s.outputs.map((o) => o.text))

  it('ai step keeps the conversation until done', async () => {
    const calls: AiRequest[] = []
    const r = await simulateFlow(db, aiFlow(), [{ type: 'message', text: 'help' }, { type: 'message', text: 'hours?' }, { type: 'message', text: 'thanks' }], undefined, true, { ai: echo(calls), botFields: { shop: 'Cafe X' } })
    expect(texts(r)).toEqual([['echo: help'], ['echo: hours?'], ['echo: thanks', 'Bye']])
    expect(r.steps.map((s) => s.waiting)).toEqual(['ai', 'ai', null])
    expect(r.completed).toBe(true)
    // Contact data never reaches the system prompt; only {{bot.*}} is expanded there.
    expect(calls[0]!.system).toContain('You help {{first_name}} at Cafe X.')
    expect(calls[0]!.system).toContain('# Knowledge\nOpen 9-17')
    expect(calls[0]!.system).toContain('"done"')
    expect(calls[2]!.messages.map((m) => `${m.role}:${m.content.slice(0, 10)}`)).toEqual(['user:help', 'assistant:{"reply":"', 'user:hours?', 'assistant:{"reply":"', 'user:thanks'])
  })

  it('ai step stops at maxTurns', async () => {
    const r = await simulateFlow(db, aiFlow(2), [{ type: 'message', text: 'help' }, { type: 'message', text: 'more' }], undefined, true, { ai: echo([]) })
    expect(texts(r)).toEqual([['echo: help'], ['echo: more', 'Bye']])
    expect(r.completed).toBe(true)
  })

  it('ai step without a caller records a note and continues', async () => {
    const r = await simulateFlow(db, aiFlow(), [{ type: 'message', text: 'help' }])
    expect(texts(r)).toEqual([['Bye']])
    expect(r.notes).toEqual(['ai ai1: ai_not_configured'])
    const failing = await simulateFlow(db, aiFlow(), [{ type: 'message', text: 'help' }], undefined, true, { ai: async () => Promise.reject(new Error('ai_http_500')) })
    expect(failing.notes).toEqual(['ai ai1: ai_http_500'])
    expect(texts(failing)).toEqual([['Bye']])
  })

  it('greets when the step is reached without a message', async () => {
    const calls: AiRequest[] = []
    await simulateFlow(db, aiFlow(), [{ type: 'start' }], undefined, true, { ai: echo(calls) })
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: '(The conversation starts now. Greet the user.)' }])
  })
})

describe('intent trigger', () => {
  const shipping = flow({ triggers: [{ type: 'intent', description: 'asks about shipping', examples: ['送料は?'] }], entry: 'm1', steps: [{ id: 'm1', type: 'message', text: 'Shipping is free.' }] })

  it('intent trigger starts the flow when the classifier picks it', async () => {
    const calls: AiRequest[] = []
    const ai: AiCaller = async (req) => {
      calls.push(req)
      return '{"flowId": 7}'
    }
    const r = await simulateFlow(db, shipping, [{ type: 'message', text: 'how much is delivery?' }], undefined, true, { ai })
    expect(r.steps[0]!.triggered).toBe(true)
    expect(r.steps[0]!.outputs.map((o) => o.text)).toEqual(['Shipping is free.'])
    expect(calls[0]!.system).toContain('flowId 7: asks about shipping')
  })

  it('does not start the flow when the classifier returns null, nor call it for 1-character messages', async () => {
    let n = 0
    const ai: AiCaller = async () => {
      n++
      return '{"flowId": null}'
    }
    const r = await simulateFlow(db, shipping, [{ type: 'message', text: 'hello there' }, { type: 'message', text: 'k' }], undefined, true, { ai })
    expect(r.steps.map((s) => s.triggered)).toEqual([false, false])
    expect(n).toBe(1)
  })
})
