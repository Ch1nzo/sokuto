import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

type Overview = {
  general: { botName: string; paused: boolean }
  channels: string[]
  stats: { contacts: number; newContacts7d: number; messagesIn7d: number; messagesOut7d: number; flowsLive: number }
  notifications: { id: number; contactId: number | null; text: string; createdAt: string }[]
}

export default function Dashboard() {
  const t = useT()
  const [data, setData] = useState<Overview | null>(null)
  const load = () => api.get<Overview>('/api/overview').then(setData)
  useEffect(() => {
    void load()
  }, [])
  if (!data) return <div className="muted">{t('loading')}</div>
  const s = data.stats
  return (
    <>
      <div className="page-title">
        <h1>{data.general.botName}</h1>
        <div className="row small muted">{data.channels.map((c) => <span key={c} className="badge">{c}</span>)}</div>
      </div>
      {data.general.paused && <div className="alert warn">{t('dash_paused')}</div>}
      <div className="grid">
        {[
          [t('dash_contacts'), s.contacts],
          [t('dash_new7'), s.newContacts7d],
          [t('dash_in7'), s.messagesIn7d],
          [t('dash_out7'), s.messagesOut7d],
          [t('dash_flows'), s.flowsLive],
        ].map(([label, value]) => (
          <div className="stat" key={String(label)}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      {(data.channels.length === 0 || s.flowsLive === 0) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{t('dash_getting_started')}</h2>
          <ol>
            <li>{data.channels.length > 0 ? '✅ ' : ''}<Link to="/channels">{t('dash_step_channel')}</Link></li>
            <li>{s.flowsLive > 0 ? '✅ ' : ''}<Link to="/flows">{t('dash_step_flow')}</Link></li>
            <li><Link to="/settings">{t('dash_step_mcp')}</Link></li>
          </ol>
        </div>
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('dash_notifications')}</h2>
          {data.notifications.length > 0 && (
            <button className="btn small" onClick={() => api.post('/api/notifications/read').then(load)}>
              {t('dash_markRead')}
            </button>
          )}
        </div>
        {data.notifications.length === 0 ? (
          <div className="muted small">{t('dash_no_notifications')}</div>
        ) : (
          <ul>
            {data.notifications.map((n) => (
              <li key={n.id}>
                {n.contactId ? <Link to={`/inbox/${n.contactId}`}>{n.text}</Link> : n.text} <span className="muted small">{new Date(n.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
