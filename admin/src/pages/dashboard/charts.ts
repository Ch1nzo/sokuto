/**
 * Pure chart math for the dashboard (no React, no DOM): unit-tested in tests/dashboard.test.ts.
 */

/** Response of `GET /api/dashboard?days=` (src/routes/api.ts). */
export type DashboardData = {
  days: number
  /** One entry per UTC day of the period, oldest first. `bot` + `human` ≤ `out`. */
  series: { day: string; in: number; out: number; bot: number; human: number; newContacts: number }[]
  /** `contacts` is all-time; `messagesIn` is the period. */
  channels: { channel: string; contacts: number; messagesIn: number }[]
  /** Current, disjoint: open (bot answering) + paused (open, bot paused) + closed = all contacts. */
  conversations: { open: number; closed: number; paused: number; unread: number }
  replies: { bot: number; human: number }
  flows: { id: number; name: string; kind: string; status: string; started: number; completed: number; errors: number; buttonClicks: number }[]
  broadcasts: { count: number; total: number; sent: number; failed: number; clicked: number }
  handoffs: number
}

/**
 * Whole-number percentages that always add up to 100 (largest-remainder method).
 * Negative / non-finite values count as 0; all zeros → all zeros (never divides by zero).
 */
export function percentages(values: number[]): number[] {
  const v = values.map((x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const total = v.reduce((s, x) => s + x, 0)
  if (total === 0) return v.map(() => 0)
  const exact = v.map((x) => (x / total) * 100)
  const out = exact.map(Math.floor)
  let left = 100 - out.reduce((s, x) => s + x, 0)
  // Hand the missing points to the largest remainders; ties go to the larger value, then the earlier slot.
  const order = v.map((_, i) => i).sort((a, b) => exact[b]! - Math.floor(exact[b]!) - (exact[a]! - Math.floor(exact[a]!)) || v[b]! - v[a]! || a - b)
  for (const i of order) {
    if (left <= 0) break
    out[i]! += 1
    left--
  }
  return out
}

/** Smallest of 1, 2, 5 × 10ⁿ that is ≥ `max` (axis top). Never 0, so it is always safe to divide by. */
export function niceMax(max: number): number {
  if (!(max > 0) || !Number.isFinite(max)) return 1
  let pow = 10 ** Math.floor(Math.log10(max))
  // Guard against log10 rounding (e.g. 999.9999 → 3).
  while (pow > max) pow /= 10
  while (pow * 10 <= max) pow *= 10
  for (const m of [1, 2, 5]) if (m * pow >= max) return m * pow
  return 10 * pow
}

export type Arc = {
  /** SVG path along the ring's centre line (draw with `stroke`); '' for a zero value. */
  d: string
  /** Share of the whole, 0–1. */
  fraction: number
}

const round = (n: number) => Math.round(n * 1000) / 1000
const point = (r: number, a: number) => `${round(r * Math.sin(a))} ${round(-r * Math.cos(a))}`

/**
 * Donut segments for a ring of radius `r` centred on (0, 0), clockwise from 12 o'clock.
 * `gap` is the empty arc length (in the same units as `r`) left between two segments; a lone
 * segment is a full circle. Zero values get `d: ''`.
 */
export function donutArcs(values: number[], r: number, gap = 0): Arc[] {
  const v = values.map((x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const total = v.reduce((s, x) => s + x, 0)
  if (total === 0) return v.map(() => ({ d: '', fraction: 0 }))
  const parts = v.filter((x) => x > 0).length
  const gapAngle = parts > 1 ? gap / r : 0
  let start = 0
  return v.map((x) => {
    const fraction = x / total
    const sweep = fraction * 2 * Math.PI
    const from = start
    start += sweep
    if (x === 0) return { d: '', fraction }
    if (parts === 1) {
      // A full circle cannot be one arc (start = end): two half circles.
      return { d: `M ${point(r, 0)} A ${r} ${r} 0 1 1 ${point(r, Math.PI)} A ${r} ${r} 0 1 1 ${point(r, 0)}`, fraction }
    }
    // Keep at least a sliver for tiny values instead of letting the gap swallow them.
    const len = Math.max(sweep - gapAngle, Math.min(sweep, 0.01))
    const a0 = from + (sweep - len) / 2
    const a1 = a0 + len
    return { d: `M ${point(r, a0)} A ${r} ${r} 0 ${len > Math.PI ? 1 : 0} 1 ${point(r, a1)}`, fraction }
  })
}

/** Indices of the x-axis labels: the last day always, then every n-th day back (about `max` labels; 7 days → all). */
export function labelIndices(count: number, max = 6): number[] {
  if (count <= 0) return []
  const step = count <= max + 1 ? 1 : Math.ceil(count / max)
  const out: number[] = []
  for (let i = count - 1; i >= 0; i -= step) out.push(i)
  return out.reverse()
}

/** "12%", or "<1%" for a non-zero value that rounds down to 0 %. */
export const pctLabel = (pct: number, value: number) => (pct === 0 && value > 0 ? '<1%' : `${pct}%`)
