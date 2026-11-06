import { useId, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Icon, Text } from '@channel.io/bezier-react'
import {
  ChatBubbleIcon,
  ComboChartIcon,
  ErrorTriangleFilledIcon,
  GraphIcon,
  HeadsetIcon,
  LineChartIcon,
  PieChartIcon,
  SendIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import { useLang, useT, type Lang } from '../../lib/i18n'
import { DataTable, EmptyState, formatNumber, useChannelLabel, type Column } from '../../components'
import { donutArcs, labelIndices, niceMax, pctLabel, percentages, type DashboardData } from './charts'

type Series = DashboardData['series']
type Flow = DashboardData['flows'][number]
/** One colored part of a whole (donut slice, bar segment) and its legend row. */
type Part = { key: string; label: string; value: number; color: string; extra?: number }

/* Chart colors are CSS custom properties defined per entity in dashboard.css (light and dark steps). */
const C = {
  in: 'var(--dash-in)',
  out: 'var(--dash-out)',
  bot: 'var(--dash-bot)',
  human: 'var(--dash-human)',
  rest: 'var(--dash-rest)',
  fail: 'var(--dash-fail)',
  sent: 'var(--dash-sent)',
  new: 'var(--dash-new)',
}
/** Same hues as ChannelBadge (LINE green, Messenger blue, Instagram pink); fixed order, never by rank. */
const CHANNELS: Record<string, string> = { line: 'var(--dash-line)', messenger: 'var(--dash-messenger)', instagram: 'var(--dash-instagram)' }
const CHANNEL_ORDER = Object.keys(CHANNELS)

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const utc = (day: string) => new Date(`${day}T00:00:00Z`)
const longDay = (lang: Lang) => new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' })

/* ---------- building blocks ---------- */

/** Chart section: 14 bold title, one-line description, optional figures on the right. */
export function ChartCard({ title, description, aside, wide, children }: { title: string; description: string; aside?: ReactNode; wide?: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <section className={wide ? 'card dash-card dash-card--wide' : 'card dash-card'} aria-labelledby={id}>
      <div className="dash-card__head">
        <div className="dash-card__titles">
          <Text as="h2" id={id} typo="14" bold color="txt-black-darkest">
            {title}
          </Text>
          <Text as="p" typo="12" color="txt-black-dark">
            {description}
          </Text>
        </div>
        {aside && <div className="dash-card__aside">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

/** Header legend item: swatch (identity) + label + value; text stays in text colors. */
export function Key({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <span className="dash-key">
      {color && <span className="dash-swatch" style={{ background: color }} aria-hidden="true" />}
      {label}
      <strong>{value}</strong>
    </span>
  )
}

function Empty({ icon, title }: { icon: BezierIcon; title?: string }) {
  const t = useT()
  return <EmptyState compact icon={icon} title={title ?? t('reports_empty')} />
}

/** A number next to a chart (unread, hand-overs, taps). */
function Fact({ icon, label, value, hint }: { icon: BezierIcon; label: string; value: string; hint?: string }) {
  return (
    <p className="dash-fact">
      <Icon source={icon} size="s" color="txt-black-dark" />
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <span className="dash-fact__hint">{hint}</span>}
    </p>
  )
}

/** One stacked layer of a daily series: `key` names a numeric field of every point. */
export type Layer<K extends string> = { key: K; label: string; color: string }
/** A UTC day plus the layer values (`NoInfer`: the layers decide which keys are read). */
type DayPoints<K extends string> = ({ day: string } & Record<NoInfer<K>, number>)[]

/**
 * Columns per day (stacked when several layers), y gridlines at clean values, every n-th day labeled.
 * Each column's hit area is the full plot height; its native tooltip lists the day's values.
 */
export function Columns<K extends string>({ series, layers, height, label }: { series: DayPoints<K>; layers: Layer<K>[]; height: number; label: string }) {
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const totals = series.map((p) => sum(layers.map((l) => p[l.key])))
  const top = niceMax(Math.max(0, ...totals))
  const ticks = Number.isInteger(top / 2) ? [0, top / 2, top] : [0, top]
  // Full numbers under 10,000, compact on an axis that reaches it (one style per axis).
  const tick = top >= 10_000 ? new Intl.NumberFormat(lang, { notation: 'compact' }).format : fmt
  const short = new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  const long = longDay(lang)
  const pos = (v: number) => `${(v / top) * 100}%`
  return (
    <figure className="dash-cols" style={{ '--dash-plot-h': `${height}px` } as CSSProperties}>
      <div className="dash-cols__y" aria-hidden="true">
        {ticks.map((v) => (
          <span key={v} style={{ bottom: pos(v) }}>
            {tick(v)}
          </span>
        ))}
      </div>
      <div className="dash-cols__plot" role="img" aria-label={label}>
        {ticks.map((v) => (
          <div key={v} className={v === 0 ? 'dash-cols__rule is-base' : 'dash-cols__rule'} style={{ bottom: pos(v) }} />
        ))}
        <div className="dash-cols__bars">
          {series.map((p, i) => (
            <div key={p.day} className="dash-col" title={[long.format(utc(p.day)), ...layers.map((l) => `${l.label}: ${fmt(p[l.key])}`)].join('\n')}>
              {totals[i]! > 0 && (
                <div className="dash-col__stack" style={{ height: pos(totals[i]!) }}>
                  {layers.map((l) => p[l.key] > 0 && <div key={l.key} className="dash-col__seg" style={{ flexGrow: p[l.key], background: l.color }} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="dash-cols__x" aria-hidden="true">
        {labelIndices(series.length).map((i) => (
          <span key={i} style={{ left: `${((i + 0.5) / series.length) * 100}%` }}>
            {short.format(utc(series[i]!.day))}
          </span>
        ))}
      </div>
    </figure>
  )
}

/** The chart's table view (newest day first), collapsed by default. */
export function SeriesTable<K extends string>({ series, layers }: { series: DayPoints<K>; layers: Omit<Layer<K>, 'color'>[] }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const long = longDay(lang)
  return (
    <details className="dash-table">
      <summary>{t('dash_show_table')}</summary>
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('dash_col_day')}</th>
              {layers.map((l) => (
                <th key={l.key} scope="col" className="is-numeric">
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...series].reverse().map((p) => (
              <tr key={p.day}>
                <th scope="row">{long.format(utc(p.day))}</th>
                {layers.map((l) => (
                  <td key={l.key} className="is-numeric">
                    {fmt(p[l.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Legend and text alternative in one: name (with swatch), value, share (largest remainder, adds to 100), optional extra column. */
function LegendTable({ parts, caption, valueHeader, extraHeader }: { parts: Part[]; caption: string; valueHeader: string; extraHeader?: string }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const pcts = percentages(parts.map((p) => p.value))
  return (
    <table className="dash-legend">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">{caption}</span>
          </th>
          <th scope="col" className="dash-num">
            {valueHeader}
          </th>
          <th scope="col" className="dash-num">
            {t('dash_col_share')}
          </th>
          {extraHeader && (
            <th scope="col" className="dash-num">
              {extraHeader}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {parts.map((p, i) => (
          <tr key={p.key}>
            <th scope="row">
              <span className="dash-legend__name">
                <span className="dash-swatch" style={{ background: p.color }} aria-hidden="true" />
                {p.label}
              </span>
            </th>
            <td className="dash-num dash-legend__value">{fmt(p.value)}</td>
            <td className="dash-num">{pctLabel(pcts[i]!, p.value)}</td>
            {extraHeader && <td className="dash-num">{fmt(p.extra ?? 0)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Thin segmented bar: one whole split into parts, read with the legend table under it (which carries the numbers). */
function SplitBar({ parts }: { parts: Part[] }) {
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const pcts = percentages(parts.map((p) => p.value))
  return (
    <div className="dash-split" aria-hidden="true">
      {parts.map(
        (p, i) =>
          p.value > 0 && <span key={p.key} className="dash-split__seg" style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${fmt(p.value)} (${pctLabel(pcts[i]!, p.value)})`} />,
      )}
    </div>
  )
}

/* ---------- cards ---------- */

export function DailyMessagesCard({ series }: { series: Series }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const sumIn = sum(series.map((p) => p.in))
  const sumOut = sum(series.map((p) => p.out))
  const layers = [
    { key: 'in' as const, label: t('reports_in'), color: C.in },
    { key: 'out' as const, label: t('reports_out'), color: C.out },
  ]
  const busiest = Math.max(0, ...series.map((p) => p.in + p.out))
  return (
    <ChartCard
      wide
      title={t('dash_daily_title')}
      description={t('dash_daily_desc')}
      aside={
        <>
          <Key color={C.in} label={t('reports_in')} value={fmt(sumIn)} />
          <Key color={C.out} label={t('reports_out')} value={fmt(sumOut)} />
        </>
      }
    >
      {sumIn + sumOut === 0 ? (
        <Empty icon={ComboChartIcon} />
      ) : (
        <>
          <Columns
            series={series}
            layers={layers}
            height={200}
            label={t('dash_daily_aria').replace('{n}', fmt(series.length)).replace('{in}', fmt(sumIn)).replace('{out}', fmt(sumOut)).replace('{max}', fmt(busiest))}
          />
          <SeriesTable series={series} layers={layers} />
        </>
      )}
    </ChartCard>
  )
}

export function NewContactsCard({ series }: { series: Series }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const total = sum(series.map((p) => p.newContacts))
  const layers = [{ key: 'newContacts' as const, label: t('reports_new'), color: C.new }]
  return (
    <ChartCard title={t('dash_new_title')} description={t('dash_new_desc')} aside={<Key label={t('reports_total')} value={fmt(total)} />}>
      {total === 0 ? (
        <Empty icon={LineChartIcon} />
      ) : (
        <>
          <Columns series={series} layers={layers} height={120} label={t('dash_new_aria').replace('{n}', fmt(series.length)).replace('{total}', fmt(total))} />
          <SeriesTable series={series} layers={layers} />
        </>
      )}
    </ChartCard>
  )
}

const RING = { r: 42, stroke: 14, gap: 1.5 } // viewBox units (100 = the ring's rendered width); gap ≈ 2px at 136px

export function ChannelsCard({ channels }: { channels: DashboardData['channels'] }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const channelLabel = useChannelLabel()
  const rank = (c: string) => (CHANNEL_ORDER.includes(c) ? CHANNEL_ORDER.indexOf(c) : CHANNEL_ORDER.length)
  const parts: Part[] = [...channels]
    .sort((a, b) => rank(a.channel) - rank(b.channel) || a.channel.localeCompare(b.channel))
    .map((c) => ({ key: c.channel, label: channelLabel(c.channel), value: c.contacts, color: CHANNELS[c.channel] ?? C.rest, extra: c.messagesIn }))
  const total = sum(parts.map((p) => p.value))
  const pcts = percentages(parts.map((p) => p.value))
  const arcs = donutArcs(
    parts.map((p) => p.value),
    RING.r,
    RING.gap,
  )
  return (
    <ChartCard title={t('dash_channels_title')} description={t('dash_channels_desc')}>
      {total === 0 ? (
        <Empty icon={PieChartIcon} title={t('dash_channels_empty')} />
      ) : (
        <div className="dash-donut">
          <div className="dash-donut__ring">
            <svg viewBox="-50 -50 100 100" role="img" aria-label={`${t('reports_total')} ${fmt(total)} ${t('dash_channels_total')}`}>
              {arcs.map(
                (a, i) =>
                  a.d && (
                    <path key={parts[i]!.key} className="dash-donut__arc" d={a.d} fill="none" stroke={parts[i]!.color} strokeWidth={RING.stroke}>
                      <title>{`${parts[i]!.label}: ${fmt(parts[i]!.value)} (${pctLabel(pcts[i]!, parts[i]!.value)})`}</title>
                    </path>
                  ),
              )}
            </svg>
            <div className="dash-donut__center" aria-hidden="true">
              <strong>{fmt(total)}</strong>
              <span>{t('dash_channels_total')}</span>
            </div>
          </div>
          <LegendTable parts={parts} caption={t('dash_channels_title')} valueHeader={t('dash_col_contacts')} extraHeader={t('reports_in')} />
        </div>
      )}
    </ChartCard>
  )
}

export function RepliesCard({ replies, handoffs }: { replies: DashboardData['replies']; handoffs: number }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const parts: Part[] = [
    { key: 'bot', label: t('dash_bot'), value: replies.bot, color: C.bot },
    { key: 'human', label: t('dash_human'), value: replies.human, color: C.human },
  ]
  return (
    <ChartCard title={t('dash_replies_title')} description={t('dash_replies_desc')}>
      {replies.bot + replies.human === 0 ? (
        <Empty icon={SendIcon} />
      ) : (
        <div className="dash-whole">
          <SplitBar parts={parts} />
          <LegendTable parts={parts} caption={t('dash_replies_title')} valueHeader={t('dash_col_count')} />
        </div>
      )}
      <Fact icon={HeadsetIcon} label={t('dash_handoffs')} value={fmt(handoffs)} />
    </ChartCard>
  )
}

export function ConversationsCard({ conversations: c }: { conversations: DashboardData['conversations'] }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const parts: Part[] = [
    { key: 'open', label: t('inbox_open'), value: c.open, color: C.bot },
    { key: 'paused', label: t('inbox_paused'), value: c.paused, color: C.human },
    { key: 'closed', label: t('inbox_closed'), value: c.closed, color: C.rest },
  ]
  return (
    <ChartCard title={t('dash_status_title')} description={t('dash_status_desc')}>
      {c.open + c.paused + c.closed === 0 ? (
        <Empty icon={ChatBubbleIcon} title={t('dash_status_empty')} />
      ) : (
        <div className="dash-whole">
          <SplitBar parts={parts} />
          <LegendTable parts={parts} caption={t('dash_status_title')} valueHeader={t('dash_col_count')} />
        </div>
      )}
      <Fact icon={ChatBubbleIcon} label={t('inbox_unread')} value={fmt(c.unread)} />
    </ChartCard>
  )
}

export function FlowsCard({ flows }: { flows: Flow[] }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const columns: Column<Flow>[] = [
    {
      key: 'name',
      header: t('dash_col_flow'),
      render: (f) => (
        <div className="dash-flow">
          <Link to={`/flows/${f.id}`} className="dash-flow__name" title={f.name}>
            {f.name}
          </Link>
          {(f.status !== 'live' || f.kind === 'sequence') && (
            <span className="dash-flow__badges">
              {f.status !== 'live' && (
                <Badge size="xs" variant="monochrome-light">
                  {t('status_draft')}
                </Badge>
              )}
              {f.kind === 'sequence' && (
                <Badge size="xs" variant="monochrome-light">
                  {t('flows_kind_sequence')}
                </Badge>
              )}
            </span>
          )}
        </div>
      ),
    },
    { key: 'started', header: t('reports_started'), numeric: true, nowrap: true, render: (f) => fmt(f.started) },
    {
      key: 'rate',
      header: t('dash_col_rate'),
      render: (f) => {
        // completed can exceed started (runs that began before the period): cap the bar and the label at 100 %.
        const rate = f.started > 0 ? Math.min(1, f.completed / f.started) : null
        return (
          <div className="dash-meter" title={`${t('reports_completed')} ${fmt(f.completed)} / ${t('reports_started')} ${fmt(f.started)}`}>
            <span className="dash-meter__track" aria-hidden="true">
              {rate !== null && <span className="dash-meter__fill" style={{ width: `${rate * 100}%` }} />}
            </span>
            <span className="dash-meter__value">{rate === null ? '—' : `${Math.floor(rate * 100)}%`}</span>
          </div>
        )
      },
    },
    {
      key: 'errors',
      header: t('reports_errors'),
      numeric: true,
      nowrap: true,
      render: (f) =>
        f.errors > 0 ? (
          <span className="dash-error">
            <Icon source={ErrorTriangleFilledIcon} size="xs" color="bgtxt-red-normal" />
            {fmt(f.errors)}
          </span>
        ) : (
          fmt(0)
        ),
    },
  ]
  return (
    <ChartCard wide title={t('dash_flows_title')} description={t('dash_flows_desc')}>
      <div className="dash-flows">
        <DataTable columns={columns} rows={flows} rowKey={(f) => f.id} caption={t('dash_flows_title')} empty={<Empty icon={GraphIcon} />} />
      </div>
    </ChartCard>
  )
}

export function BroadcastsCard({ broadcasts: b }: { broadcasts: DashboardData['broadcasts'] }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const parts: Part[] = [
    { key: 'sent', label: t('dash_bc_sent'), value: b.sent, color: C.sent },
    { key: 'failed', label: t('dash_bc_failed'), value: b.failed, color: C.fail },
    { key: 'pending', label: t('dash_bc_pending'), value: Math.max(0, b.total - b.sent - b.failed), color: C.rest },
  ]
  const rate = b.sent > 0 ? new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(b.clicked / b.sent) : null
  return (
    <ChartCard wide title={t('nav_broadcasts')} description={t('dash_bc_desc').replace('{n}', fmt(b.count))}>
      {sum(parts.map((p) => p.value)) === 0 ? (
        <Empty icon={SendIcon} />
      ) : (
        <div className="dash-whole">
          <SplitBar parts={parts} />
          <LegendTable parts={parts} caption={t('nav_broadcasts')} valueHeader={t('dash_col_count')} />
        </div>
      )}
      <Fact icon={GraphIcon} label={t('dash_bc_clicked')} value={fmt(b.clicked)} hint={rate === null ? undefined : t('dash_bc_click_rate').replace('{p}', rate)} />
    </ChartCard>
  )
}
