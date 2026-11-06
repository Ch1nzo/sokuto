/* Pure graph helpers for the canvas editor. Type-only imports so tests/ can load this file directly. */
import type { ButtonDef, FlowDefinition, Step } from '@shared/flows/types'

export type Point = { x: number; y: number }
export type Layout = Record<string, Point>
/** One outgoing pointer of a step = one source handle on its node. */
export type Outlet = { handle: string; label?: string; target: string | null }
export type GraphEdge = { id: string; source: string; sourceHandle: string; target: string; label?: string }

/** Node id and layout key of the trigger ("start") node. */
export const START = 'start'
const COL = 320
const ROW = 160

function buttonOutlets(buttons: ButtonDef[] | undefined, prefix: string, labelPrefix = ''): Outlet[] {
  return (buttons ?? []).flatMap((b, i) => (b.url ? [] : [{ handle: `${prefix}${i}`, label: labelPrefix + b.label, target: b.next ?? null }]))
}

/** Every outgoing pointer of a step (URL buttons and goto have none). */
export function outlets(step: Step): Outlet[] {
  switch (step.type) {
    case 'message':
      return [
        ...buttonOutlets(step.buttons, 'buttons.'),
        ...(step.cards ?? []).flatMap((c, i) => buttonOutlets(c.buttons, `cards.${i}.buttons.`, `#${i + 1} `)),
        { handle: 'next', target: step.next ?? null },
      ]
    case 'condition':
      return [
        { handle: 'yes', label: '✓', target: step.yes ?? null },
        { handle: 'no', label: '✗', target: step.no ?? null },
      ]
    case 'random': {
      const total = step.branches.reduce((sum, b) => sum + Math.max(0, b.weight), 0)
      return step.branches.map((b, i) => ({ handle: `branches.${i}`, label: total > 0 ? `${Math.round((Math.max(0, b.weight) / total) * 100)}%` : '—', target: b.next ?? null }))
    }
    case 'goto':
      return []
    default:
      return [{ handle: 'next', target: step.next ?? null }]
  }
}

/** Edges for every pointer that names an existing step, plus `start` → entry. */
export function edgesOf(def: FlowDefinition): GraphEdge[] {
  const ids = new Set(def.steps.map((s) => s.id))
  const edges: GraphEdge[] = def.entry && ids.has(def.entry) ? [{ id: `${START}:entry`, source: START, sourceHandle: 'entry', target: def.entry }] : []
  for (const s of def.steps) {
    for (const o of outlets(s)) if (o.target && ids.has(o.target)) edges.push({ id: `${s.id}:${o.handle}`, source: s.id, sourceHandle: o.handle, target: o.target, label: o.label })
  }
  return edges
}

/** Returns a copy of `step` with the pointer behind `handle` set to `target`. Unknown handles return the step unchanged. */
export function setPointer(step: Step, handle: string, target: string | null): Step {
  const [kind, a = '', , b = ''] = handle.split('.')
  const setButton = (bs: ButtonDef[], i: number) => bs.map((x, j) => (j === i ? { ...x, next: target } : x))
  switch (step.type) {
    case 'message':
      if (kind === 'buttons' && step.buttons) return { ...step, buttons: setButton(step.buttons, Number(a)) }
      if (kind === 'cards' && step.cards) return { ...step, cards: step.cards.map((c, j) => (j === Number(a) ? { ...c, buttons: setButton(c.buttons, Number(b)) } : c)) }
      break
    case 'condition':
      return kind === 'yes' || kind === 'no' ? { ...step, [kind]: target } : step
    case 'random':
      return kind === 'branches' ? { ...step, branches: step.branches.map((x, j) => (j === Number(a) ? { ...x, next: target } : x)) } : step
    case 'goto':
      return step
  }
  return kind === 'next' ? ({ ...step, next: target } as Step) : step
}

/**
 * Deterministic left→right layered layout: BFS from the entry (column 0, the start node sits one
 * column to the left), then every unreached step starts its own BFS in the next free column.
 * Rows stack per column; tall nodes (many outlets) take more room.
 */
export function autoLayout(def: FlowDefinition): Layout {
  const byId = new Map(def.steps.map((s) => [s.id, s]))
  const layout: Layout = { [START]: { x: -COL, y: 0 } }
  const colY: number[] = []
  let maxCol = -1
  const bfs = (root: string, col0: number) => {
    let level = [root]
    for (let col = col0; level.length > 0; col++) {
      const next: string[] = []
      for (const id of level) {
        const step = byId.get(id)
        if (!step || id in layout) continue
        const y = colY[col] ?? 0
        layout[id] = { x: col * COL, y }
        colY[col] = y + Math.max(ROW, 96 + 28 * outlets(step).length)
        maxCol = Math.max(maxCol, col)
        for (const o of outlets(step)) if (o.target && !(o.target in layout)) next.push(o.target)
      }
      level = next
    }
  }
  if (def.entry) bfs(def.entry, 0)
  for (const s of def.steps) if (!(s.id in layout)) bfs(s.id, maxCol + 1)
  return layout
}

/** Step ids named in validator errors (`step <id>…`, or zod paths `steps.<index>…`). */
export function errorStepIds(errors: string[], steps: Step[]): Set<string> {
  const ids = new Set<string>()
  for (const e of errors) {
    for (const m of e.matchAll(/\bstep ([^\s.:"]+)|\bsteps\.(\d+)/g)) {
      const id = m[1] ?? steps[Number(m[2])]?.id
      if (id) ids.add(id)
    }
  }
  return ids
}
