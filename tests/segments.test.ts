import { describe, it, expect } from 'vitest'
import { matchesSegment, parseSegment, type Segment } from '../src/segments'
import type { ContactRow } from '../src/contacts'

const row = (over: Partial<{ rules: string; mode: string }> = {}) => ({ id: 1, name: 'VIP', rules: '[]', mode: 'all', createdAt: '2025-01-01T00:00:00.000Z', ...over })

function contact(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: 1,
    channel: 'line',
    channelUserId: 'u1',
    displayName: 'Taro',
    avatarUrl: null,
    username: null,
    fields: JSON.stringify({ city: 'Tokyo' }),
    botPaused: 0,
    botPausedUntil: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    unread: 0,
    status: 'open',
    notes: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('parseSegment', () => {
  it('parses rules and mode', () => {
    const s = parseSegment(row({ rules: '[{"field":"tag","op":"has_tag","value":"vip"}]', mode: 'any' }))
    expect(s).toMatchObject({ id: 1, name: 'VIP', mode: 'any', rules: [{ field: 'tag', op: 'has_tag', value: 'vip' }] })
  })

  it('falls back to no rules for bad JSON and to all for an unknown mode', () => {
    expect(parseSegment(row({ rules: '{oops', mode: 'x' }))).toMatchObject({ rules: [], mode: 'all' })
    expect(parseSegment(row({ rules: '{"field":"tag"}' })).rules).toEqual([])
  })
})

describe('matchesSegment', () => {
  const seg = (rules: Segment['rules'], mode: Segment['mode'] = 'all'): Segment => ({ id: 1, name: 's', rules, mode, createdAt: '' })
  const vipInTokyo = [
    { field: 'tag', op: 'has_tag', value: 'vip' },
    { field: 'city', op: 'equals', value: 'tokyo' },
  ] satisfies Segment['rules']

  it('needs every rule in all mode and one in any mode', () => {
    expect(matchesSegment(seg(vipInTokyo), contact(), ['vip'])).toBe(true)
    expect(matchesSegment(seg(vipInTokyo), contact(), [])).toBe(false)
    expect(matchesSegment(seg(vipInTokyo, 'any'), contact(), [])).toBe(true)
    expect(matchesSegment(seg(vipInTokyo, 'any'), contact({ fields: '{}' }), [])).toBe(false)
  })

  it('matches nobody without rules', () => {
    expect(matchesSegment(seg([]), contact(), ['vip'])).toBe(false)
  })
})
