import type { Lang } from '../lib/i18n'

const numberFormats = new Map<Lang, Intl.NumberFormat>()

/** `formatNumber(lang)(1284)` → "1,284". Cached per language. */
export function formatNumber(lang: Lang): (n: number) => string {
  let f = numberFormats.get(lang)
  if (!f) {
    f = new Intl.NumberFormat(lang)
    numberFormats.set(lang, f)
  }
  const fmt = f
  return (n) => fmt.format(n)
}

/** Full date + time in the UI language, e.g. "2026/11/03 14:05" / "Nov 3, 2026, 2:05 PM". */
export function formatDateTime(lang: Lang, value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]

/**
 * Relative time for recent dates ("4 分前", "yesterday"), absolute date beyond `maxDays`.
 * `now` is injectable for tests.
 */
export function formatRelative(lang: Lang, value: string | number | Date, maxDays = 7, now = Date.now()): string {
  const d = value instanceof Date ? value : new Date(value)
  const t = d.getTime()
  if (Number.isNaN(t)) return ''
  const diff = t - now
  if (Math.abs(diff) >= maxDays * 86_400_000) {
    const sameYear = d.getFullYear() === new Date(now).getFullYear()
    return new Intl.DateTimeFormat(lang, sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }).format(d)
  }
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === 'second') {
      // Round toward zero so "59 s ago" never shows as "1 minute ago".
      const v = Math.trunc(diff / ms)
      return rtf.format(unit === 'second' && Math.abs(v) < 10 ? 0 : v, unit)
    }
  }
  return ''
}

/** "U4af4980629f2a1c3d5e7b9a0c2e4f6a8" → "U4af49…e4f6a8". */
export function middleTruncate(s: string, head = 6, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`
}
