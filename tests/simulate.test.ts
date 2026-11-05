import { describe, it, expect } from 'vitest'
import { simulateFlow } from '../src/flows/simulate'
import type { Db } from '../src/db'
import type { FlowDefinition, FlowRecord } from '../src/flows/types'

const db = {} as unknown as Db

function flow(definition: FlowDefinition, over: Partial<FlowRecord> = {}): FlowRecord {
  return { id: 7, name: 'Test flow', channel: 'line', status: 'draft', definition, createdAt: '', updatedAt: '', ...over }
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

  it('renders bot variables from options', async () => {
    const f = flow({ triggers: [{ type: 'keyword', keywords: ['hours'] }], entry: 'm1', steps: [{ id: 'm1', type: 'message', text: 'Open {{bot.hours}}' }] })
    const withOpts = await simulateFlow(db, f, [{ type: 'message', text: 'hours' }], 'line', true, { botFields: { hours: '10:00〜19:00' } })
    expect(withOpts.steps[0]!.outputs.map((o) => o.text)).toEqual(['Open 10:00〜19:00'])
    const without = await simulateFlow(db, f, [{ type: 'message', text: 'hours' }])
    expect(without.steps[0]!.outputs.map((o) => o.text)).toEqual(['Open {{bot.hours}}'])
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
