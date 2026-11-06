import { describe, it, expect } from 'vitest'
import { validateFlow } from '../src/flows/validate'

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

  it('rejects a message with neither text nor imageUrl', () => {
    const errors = errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', text: '' }] })
    expect(errors).toContain('step a: message needs text or imageUrl')
    // text defaults to '' when omitted
    expect(errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'message', imageUrl: '' }] })).toContain('step a: message needs text or imageUrl')
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

  it('rejects invalid step shapes and non-objects', () => {
    expect(errorsOf({ triggers: [], entry: 'q', steps: [{ id: 'q', type: 'question', text: 'x', field: 'bad field!' }] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [], entry: 'd', steps: [{ id: 'd', type: 'delay', seconds: 0 }] }).length).toBeGreaterThan(0)
    expect(errorsOf({ triggers: [], entry: 'a', steps: [{ id: 'a', type: 'action', actions: [{ type: 'webhook', url: 'not a url' }] }] }).length).toBeGreaterThan(0)
    expect(errorsOf(null)[0]).toMatch(/^\(root\)/)
  })
})
