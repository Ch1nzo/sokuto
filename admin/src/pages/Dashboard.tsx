import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Banner, Button, Icon, ListItem, Text, useToast } from '@channel.io/bezier-react'
import { ChannelsListIcon, ChevronSmallRightIcon, LightningIcon, NotificationIcon, PausedFilledIcon } from '@channel.io/bezier-icons'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
import { useWorkspaces } from '../lib/workspace'
import {
  Card,
  ChannelBadge,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  RelativeTime,
  StatCard,
  formatNumber,
} from '../components'
import type { DashboardData } from './dashboard/charts'
import { BroadcastsCard, ChannelsCard, ConversationsCard, DailyMessagesCard, FlowsCard, NewContactsCard, RepliesCard } from './dashboard/ChartCards'
import './dashboard.css'

type Overview = {
  general: { botName: string; paused: boolean }
  channels: string[]
  stats: { flowsLive: number }
  notifications: { id: number; contactId: number | null; text: string; createdAt: string }[]
}

/** src/routes/api.ts returns at most this many (newest, unread) notifications. */
const NOTIFICATION_LIMIT = 10

/** Chart periods; the choice lives in `?days=` (default 30). */
const PERIODS = [7, 30, 90] as const
const parseDays = (v: string | null) => PERIODS.find((d) => String(d) === v) ?? 30

export default function Dashboard() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const toast = useToast()
  const { current } = useWorkspaces()
  const title = current?.name ?? t('nav_home')
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [marking, setMarking] = useState(false)
  const [params, setParams] = useSearchParams()
  const days = parseDays(params.get('days'))
  const [dash, setDash] = useState<DashboardData | null>(null)
  const [dashError, setDashError] = useState<unknown>(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [dashReload, setDashReload] = useState(0)

  const load = useCallback(async () => {
    try {
      setData(await api.get<Overview>('/api/overview'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    setDashLoading(true)
    api
      .get<DashboardData>(`/api/dashboard?days=${days}`)
      .then((r) => {
        if (!cancelled) {
          setDash(r)
          setDashError(null)
        }
      })
      .catch((err) => !cancelled && setDashError(err))
      .finally(() => !cancelled && setDashLoading(false))
    return () => {
      cancelled = true
    }
  }, [days, dashReload])

  const setDays = (d: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('days', String(d))
        return next
      },
      { replace: true },
    )

  const markAllRead = async () => {
    setMarking(true)
    try {
      await api.post('/api/notifications/read')
      await load()
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    } finally {
      setMarking(false)
    }
  }

  if (!data) {
    return error ? (
      <>
        <PageHeader title={title} />
        <ErrorBanner error={error} onRetry={() => void load()} />
      </>
    ) : (
      <LoadingState />
    )
  }

  const s = data.stats
  const num = formatNumber(lang)
  const series = dash?.series ?? []
  const sumIn = series.reduce((n, p) => n + p.in, 0)
  const sumOut = series.reduce((n, p) => n + p.out, 0)
  const sumNew = series.reduce((n, p) => n + p.newContacts, 0)
  const first = series[0]?.day
  const last = series[series.length - 1]?.day
  const range =
    first && last
      ? `${new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' }).formatRange(new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`))} (UTC)`
      : null
  // Only what still needs doing, in setup order.
  const nextSteps = [
    data.channels.length === 0 && { icon: ChannelsListIcon, label: t('dash_step_channel'), to: '/channels' },
    s.flowsLive === 0 && { icon: LightningIcon, label: t('dash_step_flow'), to: '/flows' },
  ].filter((step) => step !== false)

  return (
    <div className="stack dash">
      <PageHeader
        title={title}
        description={
          data.channels.length > 0 && (
            <div className="inline-list">
              {data.channels.map((c) => (
                <ChannelBadge key={c} channel={c} />
              ))}
            </div>
          )
        }
      />

      {error !== null && <ErrorBanner error={error} onRetry={() => void load()} />}

      {data.general.paused && (
        <Banner
          variant="orange"
          icon={PausedFilledIcon}
          content={`${t('dash_paused')} `}
          hasLink
          linkText={t('dash_open_settings')}
          renderLink={({ content }) => (
            <Link to="/settings" className="banner-link">
              {content}
            </Link>
          )}
        />
      )}

      {nextSteps.length > 0 && (
        <Card title={t('dash_next')} flush>
          <div className="list">
            {nextSteps.map((step) => (
              <ListItem
                key={step.to}
                size="m"
                leftContent={step.icon}
                content={<span className="list-text">{step.label}</span>}
                rightContent={<Icon source={ChevronSmallRightIcon} size="s" color="txt-black-dark" />}
                onClick={() => navigate(step.to)}
              />
            ))}
          </div>
        </Card>
      )}

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
        {range && (
          <Text typo="12" color="txt-black-dark" className="tabular">
            {range}
          </Text>
        )}
      </div>

      {dashError !== null && <ErrorBanner error={dashError} onRetry={() => setDashReload((n) => n + 1)} />}

      {dash ? (
        <div className={dashLoading ? 'stack dash-body is-loading' : 'stack dash-body'} aria-busy={dashLoading}>
          <div className="stat-grid">
            <StatCard label={t('dash_unread')} value={dash.conversations.unread} hint={t('dash_now')} />
            <StatCard label={t('dash_new')} value={sumNew} />
            <StatCard label={t('dash_messages')} value={sumIn + sumOut} hint={t('dash_messages_hint').replace('{in}', num(sumIn)).replace('{out}', num(sumOut))} />
            <StatCard label={t('dash_flows')} value={s.flowsLive} hint={t('dash_now')} />
          </div>
          <div className="dash-grid">
            <DailyMessagesCard series={dash.series} />
            <NewContactsCard series={dash.series} />
            <ChannelsCard channels={dash.channels} />
            <RepliesCard replies={dash.replies} handoffs={dash.handoffs} />
            <ConversationsCard conversations={dash.conversations} />
            <FlowsCard flows={dash.flows} />
            {dash.broadcasts.count > 0 && <BroadcastsCard broadcasts={dash.broadcasts} />}
          </div>
        </div>
      ) : (
        dashError === null && <LoadingState compact />
      )}

      <Card
        title={t('dash_notifications')}
        flush
        actions={
          data.notifications.length > 0 && (
            <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('dash_markRead')} loading={marking} onClick={markAllRead} />
          )
        }
      >
        {data.notifications.length === 0 ? (
          <EmptyState compact icon={NotificationIcon} title={t('dash_no_notifications')} />
        ) : (
          <>
            <div className="list">
              {data.notifications.map((n) => (
                <ListItem
                  key={n.id}
                  size="m"
                  content={<span className="list-text">{n.text}</span>}
                  description={<RelativeTime value={n.createdAt} />}
                  rightContent={n.contactId ? <Icon source={ChevronSmallRightIcon} size="s" color="txt-black-dark" /> : undefined}
                  {...(n.contactId ? { onClick: () => navigate(`/inbox/${n.contactId}`) } : {})}
                />
              ))}
            </div>
            {data.notifications.length >= NOTIFICATION_LIMIT && (
              <p className="card__footnote">{t('dash_notifications_latest').replace('{n}', num(NOTIFICATION_LIMIT))}</p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
