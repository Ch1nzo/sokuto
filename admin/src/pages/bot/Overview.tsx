import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Banner, Button, Text } from '@channel.io/bezier-react'
import { AiOffIcon, BookIcon, ChatBubbleIcon, HeadsetIcon, InfoFilledIcon, PausedFilledIcon, PlayIcon, ShoppingIcon } from '@channel.io/bezier-icons'
import { api } from '../../lib/api'
import { useLang, useT } from '../../lib/i18n'
import { DataTable, EmptyState, ErrorBanner, LoadingState, StatCard, formatNumber, type Column } from '../../components'
import { ChartCard, Columns, Key, SeriesTable } from '../dashboard/ChartCards'
import { pctLabel, percentages } from '../dashboard/charts'
import { BotFrame, useReasonLabel } from './shared'
import type { BotOverview } from './types'
import '../dashboard.css'

/** Same periods and `?days=` param as the dashboard. */
const PERIODS = [7, 30, 90] as const
const parseDays = (v: string | null) => PERIODS.find((d) => String(d) === v) ?? 30

type TopFaq = BotOverview['topFaqs'][number]
type TopProduct = BotOverview['topProducts'][number]

export default function Overview() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const navigate = useNavigate()
  const reasonLabel = useReasonLabel()
  const [params, setParams] = useSearchParams()
  const days = parseDays(params.get('days'))
  const [data, setData] = useState<BotOverview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<BotOverview>(`/api/bot/overview?days=${days}`)
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
  }, [days, reload])

  const setDays = (d: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('days', String(d))
        return next
      },
      { replace: true },
    )

  const toolbar = (
    <div className="dash-toolbar">
      <div className="dash-period" role="group" aria-label={t('dash_period')}>
        {PERIODS.map((d) => (
          <Button
            key={d}
            size="s"
            styleVariant={d === days ? 'secondary' : 'tertiary'}
            colorVariant={d === days ? 'blue' : 'monochrome-dark'}
            text={t('reports_period_days').replace('{n}', String(d))}
            aria-pressed={d === days}
            onClick={() => setDays(d)}
          />
        ))}
      </div>
      <Text typo="12" color="txt-black-dark">
        {t('bot_ov_utc')}
      </Text>
    </div>
  )

  if (!data) {
    return (
      <BotFrame section="overview">
        <div className="stack">
          {toolbar}
          {error !== null ? <ErrorBanner error={error} onRetry={() => setReload((n) => n + 1)} /> : <LoadingState compact />}
        </div>
      </BotFrame>
    )
  }

  const k = data.knowledge
  const noKnowledge = k.faqs + k.suggested + k.documents + k.products === 0
  const banner = !data.aiConfigured
    ? { variant: 'orange' as const, icon: AiOffIcon, text: t('bot_ov_no_ai'), link: t('bot_open_ai_settings'), to: '/settings#ai' }
    : !data.enabled
      ? { variant: 'orange' as const, icon: PausedFilledIcon, text: t('bot_ov_disabled').replace('{name}', data.name), link: t('bot_open_rules'), to: '/bot/rules' }
      : noKnowledge
        ? { variant: 'blue' as const, icon: InfoFilledIcon, text: t('bot_ov_no_knowledge'), link: t('bot_add_knowledge'), to: '/bot/knowledge' }
        : null

  const pct = (n: number) => (data.handled > 0 ? `${n}%` : '—')
  const avg = data.handled > 0 ? new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(data.avgTurns) : '—'
  const sum = (key: 'replies' | 'handoffs' | 'resolved') => data.series.reduce((s, p) => s + p[key], 0)
  const totals = { replies: sum('replies'), handoffs: sum('handoffs'), resolved: sum('resolved') }
  const layers = [
    { key: 'replies' as const, label: t('bot_ov_replies'), color: 'var(--dash-bot)' },
    { key: 'handoffs' as const, label: t('bot_ov_handoffs'), color: 'var(--dash-human)' },
    { key: 'resolved' as const, label: t('bot_ov_resolved'), color: 'var(--dash-out)' },
  ]
  const quiet = data.replies + data.handoffs + data.resolved === 0
  const reasonTotal = data.handoffReasons.reduce((s, r) => s + r.count, 0)
  const reasonPcts = percentages(data.handoffReasons.map((r) => r.count))
  const reasonMax = Math.max(1, ...data.handoffReasons.map((r) => r.count))

  const faqColumns: Column<TopFaq>[] = [
    { key: 'q', header: t('bot_col_question'), render: (f) => <span className="bot-clamp2" title={f.question}>{f.question}</span> },
    { key: 'uses', header: t('bot_col_uses'), numeric: true, nowrap: true, render: (f) => fmt(f.uses) },
  ]
  const productColumns: Column<TopProduct>[] = [
    { key: 'name', header: t('bot_col_product'), render: (p) => <span className="bot-clamp2" title={p.name}>{p.name}</span> },
    { key: 'count', header: t('bot_col_sent'), numeric: true, nowrap: true, render: (p) => fmt(p.count) },
  ]

  const knowledge = (
    <ChartCard title={t('bot_ov_knowledge')} description={t('bot_ov_knowledge_desc')}>
      <dl className="bot-kn">
        <div className="bot-kn__row">
          <dt>
            <Link to="/bot/knowledge">{t('bot_ov_kn_faqs')}</Link>
          </dt>
          <dd>{fmt(k.faqs)}</dd>
        </div>
        <div className="bot-kn__row">
          <dt>
            <Link to="/bot/knowledge?status=suggested">{t('bot_ov_kn_suggested')}</Link>
          </dt>
          <dd>
            {fmt(k.suggested)}
            {k.suggested > 0 && <Button size="xs" styleVariant="secondary" colorVariant="monochrome-dark" text={t('bot_review')} onClick={() => navigate('/bot/knowledge?status=suggested')} />}
          </dd>
        </div>
        <div className="bot-kn__row">
          <dt>
            <Link to="/bot/knowledge?tab=documents">{t('bot_documents')}</Link>
          </dt>
          <dd>{fmt(k.documents)}</dd>
        </div>
        <div className="bot-kn__row">
          <dt>
            <Link to="/bot/products">{t('bot_nav_products')}</Link>
          </dt>
          <dd>{fmt(k.products)}</dd>
        </div>
      </dl>
    </ChartCard>
  )

  return (
    <BotFrame section="overview">
      <div className="stack dash">
        {banner && (
          <Banner
            variant={banner.variant}
            icon={banner.icon}
            content={`${banner.text} `}
            hasLink
            linkText={banner.link}
            renderLink={({ content }) => (
              <Link to={banner.to} className="banner-link">
                {content}
              </Link>
            )}
          />
        )}
        {toolbar}
        {error !== null && <ErrorBanner error={error} onRetry={() => setReload((n) => n + 1)} />}

        <div className={loading ? 'stack dash-body is-loading' : 'stack dash-body'} aria-busy={loading}>
          {quiet ? (
            <div className="card">
              <EmptyState
                icon={ChatBubbleIcon}
                title={t('bot_ov_empty').replace('{name}', data.name)}
                description={t('bot_ov_empty_desc')}
                action={<Button leftContent={PlayIcon} text={t('bot_nav_playground')} onClick={() => navigate('/bot/playground')} />}
              />
            </div>
          ) : (
            <>
              <div className="stat-grid bot-stats">
                <StatCard label={t('bot_ov_handled')} value={data.handled} />
                <StatCard label={t('bot_ov_resolution')} value={pct(data.resolutionRate)} hint={t('bot_ov_resolution_hint')} />
                <StatCard label={t('bot_ov_handoff_rate')} value={pct(data.handoffRate)} />
                <StatCard label={t('bot_ov_replies')} value={data.replies} />
                <StatCard label={t('bot_ov_avg_turns')} value={avg} />
              </div>
              <div className="dash-grid">
                <ChartCard
                  wide
                  title={t('bot_ov_daily')}
                  description={t('bot_ov_daily_desc')}
                  aside={layers.map((l) => (
                    <Key key={l.key} color={l.color} label={l.label} value={fmt(totals[l.key])} />
                  ))}
                >
                  <Columns
                    series={data.series}
                    layers={layers}
                    height={180}
                    label={t('bot_ov_daily_aria')
                      .replace('{n}', fmt(data.series.length))
                      .replace('{replies}', fmt(totals.replies))
                      .replace('{handoffs}', fmt(totals.handoffs))
                      .replace('{resolved}', fmt(totals.resolved))}
                  />
                  <SeriesTable series={data.series} layers={layers} />
                </ChartCard>

                <ChartCard title={t('bot_ov_reasons')} description={t('bot_ov_reasons_desc').replace('{n}', fmt(reasonTotal))}>
                  {data.handoffReasons.length === 0 ? (
                    <EmptyState compact icon={HeadsetIcon} title={t('bot_ov_reasons_empty')} />
                  ) : (
                    <table className="bot-reasons">
                      <caption className="visually-hidden">{t('bot_ov_reasons')}</caption>
                      <tbody>
                        {data.handoffReasons.map((r, i) => (
                          <tr key={r.reason}>
                            <th scope="row">{reasonLabel(r.reason)}</th>
                            <td className="bot-reasons__bar" aria-hidden="true">
                              <span className="dash-meter__track">
                                <span className="dash-meter__fill" style={{ width: `${(r.count / reasonMax) * 100}%` }} />
                              </span>
                            </td>
                            <td className="dash-num">{fmt(r.count)}</td>
                            <td className="dash-num bot-reasons__pct">{pctLabel(reasonPcts[i]!, r.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </ChartCard>

                {knowledge}

                <ChartCard title={t('bot_ov_top_faqs')} description={t('bot_ov_top_faqs_desc')}>
                  <div className="dash-flows">
                    <DataTable columns={faqColumns} rows={data.topFaqs} rowKey={(f) => f.id} caption={t('bot_ov_top_faqs')} empty={<EmptyState compact icon={BookIcon} title={t('bot_ov_top_empty')} />} />
                  </div>
                </ChartCard>

                <ChartCard title={t('bot_ov_top_products')} description={t('bot_ov_top_products_desc')}>
                  <div className="dash-flows">
                    <DataTable
                      columns={productColumns}
                      rows={data.topProducts}
                      rowKey={(p) => p.id}
                      caption={t('bot_ov_top_products')}
                      empty={<EmptyState compact icon={ShoppingIcon} title={t('bot_ov_top_empty')} />}
                    />
                  </div>
                </ChartCard>
              </div>
            </>
          )}
          {quiet && <div className="dash-grid">{knowledge}</div>}
        </div>
      </div>
    </BotFrame>
  )
}
