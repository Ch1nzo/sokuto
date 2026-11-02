import { useLang } from '../lib/i18n'
import { formatDateTime, formatRelative } from './format'

/** "4 分前" / "3 days ago", absolute date after `maxDays`; full date-time in the tooltip. */
export function RelativeTime({ value, maxDays = 7, className }: { value: string | number | Date; maxDays?: number; className?: string }) {
  const { lang } = useLang()
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return (
    <time dateTime={d.toISOString()} title={formatDateTime(lang, d)} className={['tabular', className].filter(Boolean).join(' ')}>
      {formatRelative(lang, d, maxDays)}
    </time>
  )
}
