import { describe, it, expect } from 'vitest'
import { segmentInputSchema, validateFlow } from '../src/flows/validate'

const validDef = {
  triggers: [{ type: 'keyword', keywords: ['price'], match: 'contains' }],
  entry: 'm1',
  steps: [
    { id: 'm1', type: 'message', text: 'Hi {{first_name}}', buttons: [{ label: 'Yes', next: 'q1' }, { label: 'Web', url: 'https://example.com' }] },
    { id: 'q1', type: 'question', text: 'Phone?', field: 'phone', next: 'c1' },
    { id: 'c1', type: 'condition', rules: [{ field: 'phone', op: 'is_set' }], yes: 'a1', no: null },
    { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'lead' }, { type: 'notify' }], next: 'd1' },
    { id: 'd1', type: 'delay', seconds: 60, next: 'r1' },
    { id: 'r1', type: 'random', branches: [{ weight: 1, next: 'm2' }, { weight: 1, next: null }] },
    { id: 'm2', type: 'message', text: '', imageUrl: 'https://example.com/a.png' },
  ],
}

function errorsOf(input: unknown): string[] {
  const r = validateFlow(input)
  if (r.ok) throw new Error('expected validation to fail')
  return r.errors
}

describe('validateFlow', () => {
  it('accepts a valid definition without warnings', () => {
    const r = validateFlow(validDef)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings).toEqual([])
      expect(r.definition.steps).toHaveLength(7)
    }
  })

  it('accepts an empty flow with a warning about missing triggers', () => {
    const r = validateFlow({ triggers: [], entry: null, steps: [] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => w.includes('no triggers'))).toBe(true)
  })

  it('warns about a comment trigger without a comment_reply step', () => {
    const r = validateFlow({ triggers: [{ type: 'comment', keywords: ['info'] }], entry: 'm1', steps: [{ id: 'm1', type: 'message', text: 'DM' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => w.includes('comment_reply'))).toBe(true)
  })

  it('does not warn when the comment flow has a comment_reply step', () => {
    const r = validateFlow({
      triggers: [{ type: 'comment' }],
      entry: 'cr',
      steps: [
        { id: 'cr', type: 'comment_reply', text: 'Sent you a DM', next: 'm1' },
        { id: 'm1', type: 'message', text: 'DM' },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it('rejects duplicate step ids', () => {
    const errors = errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', text: 'x' }, { id: 'a', type: 'message', text: 'y' }] })
    expect(errors.some((e) => e.includes('duplicate step id "a"'))).toBe(true)
  })

  it('rejects references to unknown steps', () => {
    const errors = errorsOf({
      triggers: [],
      entry: 'a',
      steps: [
        { id: 'a', type: 'message', text: 'x', next: 'missing', buttons: [{ label: 'b', next: 'nope' }] },
        { id: 'c', type: 'condition', rules: [{ field: 'x', op: 'is_set' }], yes: 'ghost', no: null },
        { id: 'r', type: 'random', branches: [{ weight: 1, next: 'phantom' }] },
      ],
    })
    expect(errors).toContain('step a.next points to unknown step "missing"')
    expect(errors).toContain('step a.buttons[0].next points to unknown step "nope"')
    expect(errors).toContain('step c.yes points to unknown step "ghost"')
    expect(errors).toContain('step r.branches[0].next points to unknown step "phantom"')
  })

  it('rejects an entry that names an unknown step', () => {
    const errors = errorsOf({ triggers: [], entry: 'zzz', steps: [{ id: 'a', type: 'message', text: 'x' }] })
    expect(errors).toContain('entry points to unknown step "zzz"')
  })

  it('requires an entry when steps exist', () => {
    const errors = errorsOf({ triggers: [], entry: null, steps: [{ id: 'a', type: 'message', text: 'x' }] })
    expect(errors).toContain('entry must name the first step')
  })

  it('rejects a message with neither text, imageUrl, cards nor attachment', () => {
    const errors = errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', text: '' }] })
    expect(errors).toContain('step a: message needs text, imageUrl, cards or attachment')
    // text defaults to '' when omitted
    expect(errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', imageUrl: '' }] })).toContain('step a: message needs text, imageUrl, cards or attachment')
  })

  it('accepts cards and attachments without text, with warnings for LINE links', () => {
    const trig = [{ type: 'keyword', keywords: ['a'] }]
    const cards = [
      { title: 'A', buttons: [{ label: 'Go', next: 'b' }] },
      { title: 'B', subtitle: 'sub', imageUrl: '', buttons: [{ label: 'Site', url: 'https://example.com' }] },
    ]
    const r = validateFlow({ triggers: trig, entry: 'a', steps: [{ id: 'a', type: 'message', cards }, { id: 'b', type: 'message', attachment: { type: 'video', url: 'https://example.com/v.mp4' } }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(['step b: video without previewImageUrl is sent as a link on LINE'])
    const ok = validateFlow({ triggers: trig, entry: 'a', steps: [{ id: 'a', type: 'message', attachment: { type: 'audio', url: 'https://example.com/a.m4a', durationMs: 3000 } }] })
    expect(ok.ok && ok.warnings).toEqual([])
    const file = validateFlow({ triggers: trig, entry: 'a', steps: [{ id: 'a', type: 'message', attachment: { type: 'file', url: 'https://example.com/f.pdf' } }] })
    expect(file.ok && file.warnings).toEqual(['step a: files are sent as a link on LINE and Instagram'])
  })

  it('rejects cards with different button counts, unknown card refs and http attachments', () => {
    const cards = [
      { title: 'A', buttons: [{ label: '1', next: 'zz' }] },
      { title: 'B', buttons: [{ label: '1' }, { label: '2' }] },
    ]
    const errors = errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', cards }] })
    expect(errors).toContain('step a: all cards must have the same number of buttons (LINE carousel)')
    expect(errors).toContain('step a.cards[0].buttons[0].next points to unknown step "zz"')
    expect(errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', cards: [{ title: 'A', buttons: [] }] }] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', attachment: { type: 'file', url: 'http://example.com/f.pdf' } }] }).length).toBeGreaterThan(0)
  })

  it('rejects invalid trigger shapes', () => {
    expect(errorsOf({ triggers: [{ type: 'keyword', keywords: [] }], entry: null, steps: [] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [{ type: 'keyword' }], entry: null, steps: [] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [{ type: 'ref', ref: '' }], entry: null, steps: [] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [{ type: 'bogus' }], entry: null, steps: [] }).length).toBeGreaterThan(0)
    const errors = errorsOf({ triggers: [{ type: 'keyword', keywords: ['x'], match: 'regex' }], entry: null, steps: [] })
    expect(errors.some((e) => e.startsWith('triggers.0'))).toBe(true)
  })

  it('limits any_message cooldownHours to more than 0 and at most 720', () => {
    expect(errorsOf({ triggers: [{ type: 'any_message', cooldownHours: 0 }], entry: null, steps: [] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [{ type: 'any_message', cooldownHours: 721 }], entry: null, steps: [] }).length).toBeGreaterThan(0)
    expect(validateFlow({ triggers: [{ type: 'any_message', cooldownHours: 24 }], entry: null, steps: [] }).ok).toBe(true)
  })

  it('accepts comment_reply variants with an empty text', () => {
    const r = validateFlow({ triggers: [{ type: 'comment' }], entry: 'cr', steps: [{ id: 'cr', type: 'comment_reply', text: '', texts: ['A', 'B'] }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it('rejects a comment_reply with neither text nor texts, and more than 4 texts', () => {
    expect(errorsOf({ triggers: [], entry: 'cr', steps: [{ id: 'cr', type: 'comment_reply', text: ' ', texts: [''] }] })).toContain('step cr: comment_reply needs text or texts')
    expect(errorsOf({ triggers: [], entry: 'cr', steps: [{ id: 'cr', type: 'comment_reply' }] })).toContain('step cr: comment_reply needs text or texts')
    expect(errorsOf({ triggers: [], entry: 'cr', steps: [{ id: 'cr', type: 'comment_reply', text: 'x', texts: ['1', '2', '3', '4', '5'] }] }).length).toBeGreaterThan(0)
  })

  it('accepts excludeKeywords and like on a comment trigger', () => {
    const r = validateFlow({ triggers: [{ type: 'comment', keywords: ['link'], excludeKeywords: ['spam'], like: true }], entry: null, steps: [] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.definition.triggers[0]).toEqual({ type: 'comment', keywords: ['link'], excludeKeywords: ['spam'], like: true })
  })

  it('rejects skipLabel with 13 choices', () => {
    const choices = Array.from({ length: 13 }, (_, i) => String(i))
    expect(errorsOf({ triggers: [], entry: 'q', steps: [{ id: 'q', type: 'question', text: 'x', field: 'f', choices, skipLabel: 'Skip' }] })).toContain('step q: skipLabel needs a free quick-reply slot (max 12 choices)')
    expect(validateFlow({ triggers: [], entry: 'q', steps: [{ id: 'q', type: 'question', text: 'x', field: 'f', choices: choices.slice(1), skipLabel: 'Skip' }] }).ok).toBe(true)
  })

  it('warns about validate without skipLabel', () => {
    const r = validateFlow({ triggers: [{ type: 'keyword', keywords: ['a'] }], entry: 'q', steps: [{ id: 'q', type: 'question', text: 'x', field: 'email', validate: 'email' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(['step q: validate without skipLabel: the person can only leave the question with a valid answer or a hand-over keyword'])
    expect(errorsOf({ triggers: [], entry: 'q', steps: [{ id: 'q', type: 'question', text: 'x', field: 'f', validate: 'zip' }] }).length).toBeGreaterThan(0)
  })

  it('accepts a request step and rejects http URLs, bad fields and more than 10 headers', () => {
    const def = (over: object) => ({
      triggers: [{ type: 'keyword', keywords: ['price'] }],
      entry: 'rq1',
      steps: [{ id: 'rq1', type: 'request', method: 'GET', url: 'https://api.example.com/x?q={{last_input}}', save: [{ field: 'price', path: 'data.price' }], next: 'm1', ...over }, { id: 'm1', type: 'message', text: '{{price}}' }],
    })
    const ok = validateFlow(def({}))
    expect(ok.ok && ok.warnings).toEqual([])
    expect(validateFlow(def({ method: 'POST', body: '{"phone": "{{phone}}"}', headers: { Authorization: 'Bearer x' }, save: [{ field: 'all', path: '' }], timeoutMs: 15000 })).ok).toBe(true)
    expect(errorsOf(def({ url: 'http://api.example.com/x' })).length).toBeGreaterThan(0)
    expect(errorsOf(def({ method: 'PUT' })).length).toBeGreaterThan(0)
    expect(errorsOf(def({ save: [{ field: 'bad field!', path: 'a' }] })).length).toBeGreaterThan(0)
    expect(errorsOf(def({ timeoutMs: 999 })).length).toBeGreaterThan(0)
    const headers = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`X-H${i}`, 'v']))
    expect(errorsOf(def({ headers })).some((e) => e.includes('at most 10 headers'))).toBe(true)
    expect(errorsOf(def({ next: 'zz' }))).toContain('step rq1.next points to unknown step "zz"')
  })

  it('rejects invalid step shapes and non-objects', () => {
    expect(errorsOf({ triggers: [], entry: 'q', steps: [{ id: 'q', type: 'question', text: 'x', field: 'bad field!' }] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [], entry: 'd', steps: [{ id: 'd', type: 'delay', seconds: 0 }] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'action', actions: [{ type: 'webhook', url: 'not a url' }] }] }).length).toBeGreaterThan(0)
    expect(errorsOf(null)[0]).toMatch(/^\(root\)/)
  })
})

describe('validateFlow (sequences)', () => {
  const seq = {
    triggers: [],
    entry: 'm1',
    steps: [
      { id: 'm1', type: 'message', text: 'Day 1', next: 'd1' },
      { id: 'd1', type: 'delay', seconds: 86400, next: 'm2' },
      { id: 'm2', type: 'message', text: 'Day 2' },
    ],
  }

  it('accepts a sequence without the no-triggers warning', () => {
    const r = validateFlow(seq, 'sequence')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it('rejects triggers and question steps in a sequence', () => {
    expect(validateFlow({ ...seq, triggers: [{ type: 'follow' }] }, 'sequence').ok).toBe(false)
    const r = validateFlow({ ...seq, steps: [...seq.steps, { id: 'q1', type: 'question', text: 'x', field: 'f' }] }, 'sequence')
    expect(r.ok ? [] : r.errors).toContain('step q1: question steps are not allowed in a sequence')
    // The same steps are fine in a normal flow.
    expect(validateFlow({ ...seq, steps: [...seq.steps, { id: 'q1', type: 'question', text: 'x', field: 'f' }] }).ok).toBe(true)
  })

  it('accepts subscribe / unsubscribe actions and requires a flowId', () => {
    const def = (action: unknown) => ({ triggers: [{ type: 'follow' }], entry: 'a1', steps: [{ id: 'a1', type: 'action', actions: [action] }] })
    expect(validateFlow(def({ type: 'subscribe', flowId: 3 })).ok).toBe(true)
    expect(validateFlow(def({ type: 'unsubscribe', flowId: 3 })).ok).toBe(true)
    expect(errorsOf(def({ type: 'subscribe' })).length).toBeGreaterThan(0)
  })
})

describe('segmentInputSchema', () => {
  const rule = { field: 'tag', op: 'has_tag', value: 'vip' }

  it('defaults mode to all and trims the name', () => {
    const r = segmentInputSchema.safeParse({ name: ' VIP ', rules: [rule] })
    expect(r.success && r.data).toEqual({ name: 'VIP', rules: [rule], mode: 'all' })
  })

  it('rejects empty rules, more than 20 rules, a blank name and an unknown mode', () => {
    expect(segmentInputSchema.safeParse({ name: 'VIP', rules: [] }).success).toBe(false)
    expect(segmentInputSchema.safeParse({ name: 'VIP', rules: Array(21).fill(rule) }).success).toBe(false)
    expect(segmentInputSchema.safeParse({ name: '  ', rules: [rule] }).success).toBe(false)
    expect(segmentInputSchema.safeParse({ name: 'VIP', rules: [rule], mode: 'none' }).success).toBe(false)
  })
})
