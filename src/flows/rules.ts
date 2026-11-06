import { parseFields, type ContactRow } from '../contacts'
import type { ConditionRule } from './types'

/** Everything a condition can look at, gathered by the caller (no I/O here). */
export type RuleSubject = { contact: ContactRow; tags: string[]; lastInput?: string; timezone?: string; now?: () => Date; isFollower?: boolean }

export function normalize(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Hour (0-23) and weekday (0 = Sunday) of `now` in `timezone`; an invalid zone falls back to UTC. */
export function localParts(now: Date, timezone?: string): { hour: number; weekday: number } {
  const format = (timeZone: string) => new Intl.DateTimeFormat('en-US', { hourCycle: 'h23', hour: 'numeric', weekday: 'short', timeZone })
  let fmt: Intl.DateTimeFormat
  try {
    fmt = format(timezone || 'UTC')
  } catch {
    fmt = format('UTC')
  }
  const parts = fmt.formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { hour: Number(part('hour')), weekday: WEEKDAYS.indexOf(part('weekday')) }
}

/** Whole days between `iso` and `now` as a string, '' when unknown. */
export function daysSince(iso: string | null | undefined, now: Date): string {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? '' : String(Math.floor((now.getTime() - t) / 86_400_000))
}

/** The value a rule compares: a special field or a contact field. */
export function ruleValue(field: string, s: RuleSubject): string {
  const now = s.now?.() ?? new Date()
  switch (field) {
    case 'channel':
      return s.contact.channel
    case 'last_input':
      return s.lastInput ?? ''
    case 'name':
      return s.contact.displayName ?? ''
    case 'is_follower':
      return String(s.isFollower ?? true)
    case 'hour':
      return String(localParts(now, s.timezone).hour)
    case 'weekday':
      return String(localParts(now, s.timezone).weekday)
    case 'days_since_created':
      return daysSince(s.contact.createdAt, now)
    case 'days_since_last_inbound':
      return daysSince(s.contact.lastInboundAt, now)
    default:
      return parseFields(s.contact)[field] ?? ''
  }
}

export function evalRule(rule: ConditionRule, s: RuleSubject): boolean {
  const value = ruleValue(rule.field, s)
  const expected = rule.value ?? ''
  switch (rule.op) {
    case 'has_tag':
      return s.tags.includes(expected)
    case 'not_has_tag':
      return !s.tags.includes(expected)
    case 'equals':
      return normalize(value) === normalize(expected)
    case 'not_equals':
      return normalize(value) !== normalize(expected)
    case 'contains':
      return normalize(value).includes(normalize(expected))
    case 'is_set':
      return value.trim() !== ''
    case 'is_empty':
      return value.trim() === ''
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // Number('') is 0, so treat blank values as non-numeric rather than as zero.
      if (value.trim() === '' || expected.trim() === '') return false
      const a = Number(value)
      const b = Number(expected)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      return rule.op === 'gt' ? a > b : rule.op === 'gte' ? a >= b : rule.op === 'lt' ? a < b : a <= b
    }
  }
}

/** `mode` "any" needs one passing rule; "all" (default) needs every rule. */
export function matchRules(rules: ConditionRule[], mode: 'all' | 'any' | undefined, s: RuleSubject): boolean {
  return mode === 'any' ? rules.some((r) => evalRule(r, s)) : rules.every((r) => evalRule(r, s))
}
