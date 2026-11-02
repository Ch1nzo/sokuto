import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banner, Button, Icon, ListItem, useToast } from '@channel.io/bezier-react'
import {
  CheckCircleFilledIcon,
  ChevronSmallRightIcon,
  CheckCircleIcon,
  NotificationIcon,
  PausedFilledIcon,
} from '@channel.io/bezier-icons'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
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

type Overview = {
  general: { botName: string; paused: boolean }
  channels: string[]
  stats: { contacts: number; newContacts7d: number; messagesIn7d: number; messagesOut7d: number; flowsLive: number }
  notifications: { id: number; contactId: number | null; text: string; createdAt: string }[]
}

/** src/routes/api.ts returns at most this many (newest, unread) notifications. */
const NOTIFICATION_LIMIT = 10

export default function Dashboard() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [marking, setMarking] = useState(false)

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
        <PageHeader title={t('nav_dashboard')} />
        <ErrorBanner error={error} onRetry={() => void load()} />
      </>
    ) : (
      <LoadingState />
    )
  }

  const s = data.stats
  const steps = [
    { done: data.channels.length > 0, label: t('dash_step_channel'), to: '/channels' },
    { done: s.flowsLive > 0, label: t('dash_step_flow'), to: '/flows' },
    { done: false, label: t('dash_step_mcp'), to: '/settings' },
  ]

  return (
    <div className="stack">
      <PageHeader
        title={data.general.botName}
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

      <div className="stat-grid">
        <StatCard label={t('dash_contacts')} value={s.contacts} />
        <StatCard label={t('dash_new7')} value={s.newContacts7d} />
        <StatCard label={t('dash_in7')} value={s.messagesIn7d} />
        <StatCard label={t('dash_out7')} value={s.messagesOut7d} />
        <StatCard label={t('dash_flows')} value={s.flowsLive} />
      </div>

      {(data.channels.length === 0 || s.flowsLive === 0) && (
        <Card title={t('dash_getting_started')} flush>
          <div className="list">
            {steps.map((step) => (
              <ListItem
                key={step.to}
                size="m"
                leftContent={
                  <Icon
                    source={step.done ? CheckCircleFilledIcon : CheckCircleIcon}
                    size="s"
                    color={step.done ? 'bgtxt-green-normal' : 'txt-black-dark'}
                  />
                }
                content={<span className={step.done ? 'list-text is-done' : 'list-text'}>{step.label}</span>}
                rightContent={<Icon source={ChevronSmallRightIcon} size="s" color="txt-black-dark" />}
                onClick={() => navigate(step.to)}
              />
            ))}
          </div>
        </Card>
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
              <p className="card__footnote">{t('dash_notifications_latest').replace('{n}', formatNumber(lang)(NOTIFICATION_LIMIT))}</p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
