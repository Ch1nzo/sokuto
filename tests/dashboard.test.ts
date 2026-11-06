import { describe, it, expect } from 'vitest'
import { donutArcs, labelIndices, niceMax, pctLabel, percentages } from '../admin/src/pages/dashboard/charts'

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

describe('percentages', () => {
  it('always adds up to 100 (largest remainder)', () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33])
    expect(percentages([2, 1])).toEqual([67, 33])
    expect(percentages([1, 48_213])).toEqual([0, 100])
    for (const v of [[7, 3, 1], [5, 5, 5, 5, 5, 5, 5], [1, 2, 3, 4, 5, 6], [999, 1, 1, 1]]) expect(sum(percentages(v))).toBe(100)
  })

  it('never divides by zero and ignores bad values', () => {
    expect(percentages([])).toEqual([])
    expect(percentages([0, 0, 0])).toEqual([0, 0, 0])
    expect(percentages([-3, Number.NaN, 4])).toEqual([0, 0, 100])
  })

  it('labels a non-zero sliver as <1%', () => {
    const [human, bot] = percentages([1, 48_213])
    expect(pctLabel(human!, 1)).toBe('<1%')
    expect(pctLabel(bot!, 48_213)).toBe('100%')
    expect(pctLabel(0, 0)).toBe('0%')
  })

  it('breaks remainder ties toward the larger value, then the earlier slot', () => {
    // 1/8 = 12.5 each for the small ones: equal remainders, equal values → earlier slots win
    expect(percentages([6, 1, 1])).toEqual([75, 13, 12])
  })
})

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 × 10ⁿ', () => {
    expect(niceMax(1)).toBe(1)
    expect(niceMax(3)).toBe(5)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(10)).toBe(10)
    expect(niceMax(101)).toBe(200)
    expect(niceMax(1000)).toBe(1000)
    expect(niceMax(48_213)).toBe(50_000)
    expect(niceMax(0.3)).toBe(0.5)
  })

  it('is never 0', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(niceMax(v)).toBe(1)
  })
})

describe('donutArcs', () => {
  it('returns empty paths for zeros', () => {
    expect(donutArcs([0, 0], 10)).toEqual([
      { d: '', fraction: 0 },
      { d: '', fraction: 0 },
    ])
  })

  it('draws a lone value as a full circle (two half arcs)', () => {
    const [a, b] = donutArcs([0, 5], 10, 2)
    expect(a).toEqual({ d: '', fraction: 0 })
    expect(b!.fraction).toBe(1)
    expect(b!.d).toBe('M 0 -10 A 10 10 0 1 1 0 10 A 10 10 0 1 1 0 -10')
  })

  it('splits the ring clockwise from 12 o’clock', () => {
    const [a, b] = donutArcs([1, 1], 10)
    expect(a!.d).toBe('M 0 -10 A 10 10 0 0 1 0 10')
    expect(b!.d).toBe('M 0 10 A 10 10 0 0 1 0 -10')
    const [big] = donutArcs([3, 1], 10)
    expect(big!.d).toBe('M 0 -10 A 10 10 0 1 1 -10 0') // 270° → large-arc flag
  })

  it('leaves a gap between segments', () => {
    const [a] = donutArcs([1, 1], 10, 2) // gap angle 0.2 rad, centred: starts 0.1 rad after 12 o'clock
    expect(a!.d.startsWith(`M ${Math.round(10 * Math.sin(0.1) * 1000) / 1000} `)).toBe(true)
  })
})

describe('labelIndices', () => {
  it('always labels the last day and thins long periods', () => {
    expect(labelIndices(7)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(labelIndices(30)).toEqual([4, 9, 14, 19, 24, 29])
    expect(labelIndices(90)).toEqual([14, 29, 44, 59, 74, 89])
    expect(labelIndices(1)).toEqual([0])
    expect(labelIndices(0)).toEqual([])
  })
})
