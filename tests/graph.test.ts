import { describe, it, expect } from 'vitest'
import type { FlowDefinition, Step } from '../src/flows/types'
import { START, autoLayout, edgesOf, errorStepIds, outlets, setPointer } from '../admin/src/pages/flow-editor/graph'

const message: Step = {
  id: 'm1',
  type: 'message',
  text: 'Hi',
  buttons: [{ label: 'Yes', next: 'q1' }, { label: 'Web', url: 'https://example.com' }, { label: 'No', next: null }],
  cards: [{ title: 'A', buttons: [{ label: 'Buy', next: 'c1' }, { label: 'Site', url: 'https://example.com/a' }] }],
  next: 'c1',
}
const condition: Step = { id: 'c1', type: 'condition', rules: [{ field: 'tag', op: 'has_tag', value: 'vip' }], yes: 'r1', no: null }
const random: Step = { id: 'r1', type: 'random', branches: [{ weight: 3, next: 'g1' }, { weight: 1, next: null }] }
const question: Step = { id: 'q1', type: 'question', text: 'Phone?', field: 'phone', next: 'c1' }
const goto: Step = { id: 'g1', type: 'goto', flowId: 2 }
const orphan: Step = { id: 'm9', type: 'message', text: 'never reached', next: 'q1' }

const def: FlowDefinition = { triggers: [], entry: 'm1', steps: [message, condition, random, question, goto, orphan] }

describe('outlets', () => {
  it('lists message buttons, card buttons and next, skipping URL buttons', () => {
    expect(outlets(message)).toEqual([
      { handle: 'buttons.0', label: 'Yes', target: 'q1' },
      { handle: 'buttons.2', label: 'No', target: null },
      { handle: 'cards.0.buttons.0', label: '#1 Buy', target: 'c1' },
      { handle: 'next', target: 'c1' },
    ])
  })

  it('gives condition yes/no, random branches with percentages, others next, goto nothing', () => {
    expect(outlets(condition)).toEqual([
      { handle: 'yes', label: '✓', target: 'r1' },
      { handle: 'no', label: '✗', target: null },
    ])
    expect(outlets(random)).toEqual([
      { handle: 'branches.0', label: '75%', target: 'g1' },
      { handle: 'branches.1', label: '25%', target: null },
    ])
    expect(outlets(question)).toEqual([{ handle: 'next', target: 'c1' }])
    expect(outlets(goto)).toEqual([])
  })
})

describe('edgesOf', () => {
  it('has one edge per pointer to an existing step plus the start edge', () => {
    const edges = edgesOf({ ...def, steps: [...def.steps, { id: 'm8', type: 'message', text: 'x', next: 'missing' }] })
    expect(edges[0]).toEqual({ id: 'start:entry', source: START, sourceHandle: 'entry', target: 'm1' })
    expect(edges.map((e) => e.id)).toEqual(['start:entry', 'm1:buttons.0', 'm1:cards.0.buttons.0', 'm1:next', 'c1:yes', 'r1:branches.0', 'q1:next', 'm9:next'])
    expect(edges.find((e) => e.id === 'c1:yes')?.label).toBe('✓')
  })

  it('has no start edge without an entry', () => {
    expect(edgesOf({ ...def, entry: null }).some((e) => e.source === START)).toBe(false)
  })
})

describe('setPointer', () => {
  it('sets every kind of pointer without mutating the step', () => {
    const before = JSON.stringify(message)
    const m = setPointer(message, 'buttons.2', 'g1')
    expect(m.type === 'message' && m.buttons?.[2]).toEqual({ label: 'No', next: 'g1' })
    const c = setPointer(message, 'cards.0.buttons.0', null)
    expect(c.type === 'message' && c.cards?.[0]?.buttons[0]).toEqual({ label: 'Buy', next: null })
    expect(setPointer(message, 'next', 'q1')).toMatchObject({ next: 'q1' })
    expect(JSON.stringify(message)).toBe(before)

    expect(setPointer(condition, 'no', 'm1')).toMatchObject({ yes: 'r1', no: 'm1' })
    const r = setPointer(random, 'branches.1', 'm1')
    expect(r.type === 'random' && r.branches.map((b) => b.next)).toEqual(['g1', 'm1'])
    expect(setPointer(question, 'next', null)).toMatchObject({ next: null })
    expect(setPointer(goto, 'next', 'm1')).toBe(goto)
    expect(setPointer(condition, 'next', 'm1')).toBe(condition)
  })
})

describe('autoLayout', () => {
  it('puts the entry in column 0, start left of it, and still places unreached steps', () => {
    const layout = autoLayout(def)
    expect(layout[START]).toEqual({ x: -320, y: 0 })
    expect(layout.m1).toEqual({ x: 0, y: 0 })
    expect(layout.q1?.x).toBe(320)
    expect(layout.c1?.x).toBe(320)
    expect(layout.r1?.x).toBe(640)
    expect(layout.g1?.x).toBe(960)
    expect(layout.m9?.x).toBe(1280)
    expect(Object.keys(layout).sort()).toEqual([START, ...def.steps.map((s) => s.id)].sort())
    // no two nodes share a spot
    expect(new Set(Object.values(layout).map((p) => `${p.x},${p.y}`)).size).toBe(Object.keys(layout).length)
  })

  it('is deterministic', () => {
    expect(autoLayout(def)).toEqual(autoLayout(structuredClone(def)))
  })
})

describe('errorStepIds', () => {
  it('extracts ids from validator messages and zod paths', () => {
    const ids = errorStepIds(['• step m1.next points to unknown step "x"', 'step c1: message needs text', 'steps.3.text: Too small', 'entry must name the first step'], def.steps)
    expect([...ids].sort()).toEqual(['c1', 'm1', 'q1'])
  })
})
