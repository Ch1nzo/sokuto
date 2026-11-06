import { describe, it, expect } from 'vitest'
import { evalRule, matchRules, type RuleSubject } from '../src/flows/rules'
import type { ConditionRule } from '../src/flows/types'
import type { ContactRow } from '../src/contacts'

function contact(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: 1,
    channel: 'line',
    channelUserId: 'u1',
    displayName: 'Taro Yamada',
    avatarUrl: null,
    username: null,
    fields: JSON.stringify({ city: ' Tokyo ', rating: '3', blank: '   ', tag: 'vip' }),
    botPaused: 0,
    botPausedUntil: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    unread: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }
}

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({ contact: contact(), tags: ['vip'], ...over })
const ev = (field: string, op: ConditionRule['op'], value?: string, s = subject()) => evalRule({ field, op, value }, s)

describe('evalRule', () => {
  it('compares equals / not_equals / contains trimmed and case-insensitive', () => {
    expect(ev('city', 'equals', 'tokyo')).toBe(true)
    expect(ev('city', 'equals', ' TOKYO ')).toBe(true)
    expect(ev('city', 'not_equals', 'osaka')).toBe(true)
    expect(ev('city', 'not_equals', 'TOKYO')).toBe(false)
    expect(ev('city', 'contains', 'OK')).toBe(true)
    expect(ev('city', 'contains', 'kyoto')).toBe(false)
  })

  it('checks has_tag / not_has_tag against the given tags only', () => {
    expect(ev('tag', 'has_tag', 'vip')).toBe(true)
    expect(ev('tag', 'has_tag', 'other')).toBe(false)
    expect(ev('tag', 'not_has_tag', 'other')).toBe(true)
    // The contact field "tag" is ignored: only subject.tags count.
    expect(ev('tag', 'has_tag', 'vip', subject({ tags: [] }))).toBe(false)
    expect(ev('tag', 'not_has_tag', 'vip', subject({ tags: [] }))).toBe(true)
  })

  it('treats whitespace-only values as empty', () => {
    expect(ev('city', 'is_set')).toBe(true)
    expect(ev('blank', 'is_set')).toBe(false)
    expect(ev('blank', 'is_empty')).toBe(true)
    expect(ev('missing', 'is_empty')).toBe(true)
  })

  it('compares numbers and returns false for non-numeric values', () => {
    expect(ev('rating', 'gt', '2')).toBe(true)
    expect(ev('rating', 'lte', '2')).toBe(false)
    expect(ev('city', 'gt', '1')).toBe(false)
    expect(ev('city', 'lte', '1')).toBe(false)
    expect(ev('missing', 'lte', '1')).toBe(false)
    expect(ev('rating', 'lte', 'abc')).toBe(false)
  })

  it('reads the special fields channel / name / last_input / is_follower', () => {
    expect(ev('channel', 'equals', 'line')).toBe(true)
    expect(ev('name', 'contains', 'taro')).toBe(true)
    expect(ev('last_input', 'equals', 'hello', subject({ lastInput: 'Hello ' }))).toBe(true)
    expect(ev('last_input', 'is_empty')).toBe(true)
    expect(ev('is_follower', 'equals', 'true')).toBe(true)
    expect(ev('is_follower', 'equals', 'false', subject({ isFollower: false }))).toBe(true)
  })
})

describe('matchRules', () => {
  const yes: ConditionRule = { field: 'channel', op: 'equals', value: 'line' }
  const no: ConditionRule = { field: 'channel', op: 'equals', value: 'instagram' }

  it('needs one rule for any and every rule for all (the default)', () => {
    expect(matchRules([yes, no], 'any', subject())).toBe(true)
    expect(matchRules([no, no], 'any', subject())).toBe(false)
    expect(matchRules([yes, no], 'all', subject())).toBe(false)
    expect(matchRules([yes, no], undefined, subject())).toBe(false)
    expect(matchRules([yes, yes], undefined, subject())).toBe(true)
  })
})
