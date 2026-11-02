import { useCallback, useEffect, useState } from 'react'
import { Badge, SegmentedControl, SegmentedControlItem, Text } from '@channel.io/bezier-react'
import { ComboChartIcon, GraphIcon } from '@channel.io/bezier-icons'
import { useLang, useT, type Key, type Lang } from '../lib/i18n'
import { api } from '../lib/api'
import {
  Card,
  ChannelBadge,
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatCard,
  formatNumber,
  type Column,
} from '../components'
import './reports.css'

type FlowReport = {
  id: string | number
  name: string
  status: string
  channel: string
  started: number
  messagesSent: number
  buttonClicks: number
  inputs: number
  completed: number
  errors: number
}

type DayPoint = { day: string; in: number; out: number; newContacts: number }

type ReportsResponse = { days: number; flows: FlowReport[]; series: DayPoint[] }

type Metric = 'started' | 'messagesSent' | 'buttonClicks' | 'inputs' | 'completed' | 'errors'

type Period = '7' | '30' | '90'

const METRICS: [Metric, Key][] = [
  ['started', 'reports_started'],
  ['messagesSent', 'reports_messages'],
  ['buttonClicks', 'reports_clicks'],
  ['inputs', 'reports_inputs'],
  ['completed', 'reports_completed'],
  ['errors', 'reports_errors'],
]

const TOTAL_ROW_ID = '__total__'

/** Fill missing days so the chart has one bar per calendar day. */
function fillDays(series: DayPoint[], days: number): DayPoint[] {
  const map = new Map(series.map((p) => [p.day, p]))
  const out: DayPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push(map.get(key) ?? { day: key, in: 0, out: 0, newContacts: 0 })
  }
  return out
}

/** "2026-11-03" (UTC day) → "11月3日" / "Nov 3". */
function formatDay(lang: Lang, day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
}

export default function Reports() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const [period, setPeriod] = useState<Period>('30')
  const [data, setData] = useState<ReportsResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<ReportsResponse>(`/api/reports?days=${period}`)
      .then((r) => {
        if (!cancelled) {
          setData(r)
          setError(null)
        }
      })
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [period, reload])

  const retry = useCallback(() => setReload((n) => n + 1), [])

  const periodControl = (
    <SegmentedControl type="radiogroup" size="s" width={240} value={period} onValueChange={(v: Period) => setPeriod(v)} aria-label={t('reports_days')}>
      {(['7', '30', '90'] as const).map((d) => (
        <SegmentedControlItem key={d} value={d}>
          {t('reports_period_days').replace('{n}', d)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )

  const header = <PageHeader title={t('reports_title')} actions={periodControl} />

  if (!data) {
    return (
      <div className="stack">
        {header}
        {error !== null ? <ErrorBanner error={error} onRetry={retry} /> : loading && <LoadingState />}
      </div>
    )
  }

  const series = fillDays(data.series, data.days)
  const max = Math.max(1, ...series.map((p) => p.in + p.out))
  const sumIn = series.reduce((s, p) => s + p.in, 0)
  const sumOut = series.reduce((s, p) => s + p.out, 0)
  const sumNew = series.reduce((s, p) => s + p.newContacts, 0)
  const totalRow: FlowReport = {
    id: TOTAL_ROW_ID,
    name: t('reports_total'),
    status: '',
    channel: '',
    ...(Object.fromEntries(METRICS.map(([m]) => [m, data.flows.reduce((sum, f) => sum + f[m], 0)])) as Record<Metric, number>),
  }
  const hasActivity = sumIn + sumOut + sumNew > 0 || METRICS.some(([m]) => totalRow[m] > 0)

  const columns: Column<FlowReport>[] = [
    {
      key: 'name',
      header: t('editor_name'),
      render: (f) =>
        f.id === TOTAL_ROW_ID ? (
          <Text typo="14" bold color="txt-black-darkest">
            {f.name}
          </Text>
        ) : (
          <div className="rp-flow">
            <Text typo="14" color="txt-black-darkest" truncated={2} title={f.name} className="rp-flow__name">
              {f.name}
            </Text>
            <div className="rp-flow__badges">
              <Badge size="xs" variant={f.status === 'live' ? 'green' : 'monochrome-light'}>
                {f.status === 'live' ? t('status_live') : t('status_draft')}
              </Badge>
              <ChannelBadge channel={f.channel} size="xs" />
            </div>
          </div>
        ),
    },
    ...METRICS.map(
      ([m, key]): Column<FlowReport> => ({
        key: m,
        header: t(key),
        numeric: true,
        nowrap: true,
        render: (f) => (
          <span className={[f.id === TOTAL_ROW_ID && 'rp-total', m === 'errors' && f[m] > 0 && 'rp-error'].filter(Boolean).join(' ') || undefined}>
            {fmt(f[m])}
          </span>
        ),
      }),
    ),
  ]

  const firstDay = series[0]?.day
  const lastDay = series[series.length - 1]?.day

  return (
    <div className="stack">
      {header}
      {error !== null && <ErrorBanner error={error} onRetry={retry} />}

      {!hasActivity ? (
        <Card>
          <EmptyState icon={GraphIcon} title={t('reports_empty')} description={t('reports_empty_desc')} />
        </Card>
      ) : (
        <div className={loading ? 'stack rp-body is-loading' : 'stack rp-body'}>
          <div className="stat-grid">
            <StatCard label={t('reports_in')} value={sumIn} />
            <StatCard label={t('reports_out')} value={sumOut} />
            <StatCard label={t('reports_new')} value={sumNew} />
            <StatCard label={t('reports_completed')} value={totalRow.completed} />
          </div>

          <Card
            title={t('reports_daily')}
            actions={
              <div className="rp-legend">
                <span className="rp-legend__item">
                  <span className="rp-swatch rp-swatch--in" aria-hidden="true" />
                  {t('reports_in')}
                </span>
                <span className="rp-legend__item">
                  <span className="rp-swatch rp-swatch--out" aria-hidden="true" />
                  {t('reports_out')}
                </span>
              </div>
            }
          >
            {sumIn + sumOut === 0 ? (
              <EmptyState compact icon={ComboChartIcon} title={t('reports_empty')} />
            ) : (
              <figure className="rp-chart" aria-label={t('reports_chart_label')}>
                <div className="rp-chart__plot">
                  <span className="rp-chart__max tabular">{t('reports_max').replace('{n}', fmt(max))}</span>
                  <div className={`rp-bars${series.length > 45 ? ' is-dense' : ''}`}>
                    {series.map((p) => {
                      const title = `${formatDay(lang, p.day)}\n${t('reports_in')}: ${fmt(p.in)}\n${t('reports_out')}: ${fmt(p.out)}\n${t('reports_new')}: ${fmt(p.newContacts)}`
                      return (
                        <div key={p.day} className="rp-bar" title={title} role="img" aria-label={title.replace(/\n/g, ', ')}>
                          <div className="rp-bar__seg rp-bar__seg--out" style={{ height: `${(p.out / max) * 100}%` }} />
                          <div className="rp-bar__seg rp-bar__seg--in" style={{ height: `${(p.in / max) * 100}%` }} />
                        </div>
                      )
                    })}
                  </div>
                </div>
                <figcaption className="rp-chart__axis tabular">
                  <span>{firstDay && formatDay(lang, firstDay)}</span>
                  <span>{lastDay && formatDay(lang, lastDay)}</span>
                </figcaption>
              </figure>
            )}
          </Card>

          <Card title={t('nav_flows')} flush>
            <DataTable
              columns={columns}
              rows={data.flows.length > 0 ? [...data.flows, totalRow] : []}
              rowKey={(f) => f.id}
              caption={t('nav_flows')}
              empty={<EmptyState compact icon={GraphIcon} title={t('reports_flows_empty')} />}
            />
          </Card>
        </div>
      )}
    </div>
  )
}
