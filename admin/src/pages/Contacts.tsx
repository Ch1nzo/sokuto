import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import { useT, type Key } from '../lib/i18n'

type Contact = {
  id: number
  channel: string
  displayName: string | null
  username: string | null
  fields: Record<string, string>
  tags: string[]
  lastInboundAt: string | null
  createdAt: string
  botPaused: number | boolean
}

type ContactsResponse = { contacts: Contact[]; total: number; page: number; size: number }
type TagCount = { tag: string; n: number }

const SUMMARY_FIELDS = ['phone', 'email', 'name', 'first_name']

function fieldsSummary(fields: Record<string, string>): string {
  const keys = Object.keys(fields)
  const preferred = SUMMARY_FIELDS.filter((k) => fields[k])
  const shown = preferred.length > 0 ? preferred : keys.slice(0, 2)
  const text = shown.map((k) => `${k}: ${fields[k]}`).join(' · ')
  const rest = keys.length - shown.length
  return rest > 0 ? `${text} (+${rest})` : text
}

export default function Contacts() {
  const t = useT()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tag, setTag] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ, tag, channel])

  useEffect(() => {
    api
      .get<{ tags: TagCount[] }>('/api/tags')
      .then((r) => setTags(r.tags))
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (debouncedQ) params.set('q', debouncedQ)
    if (tag) params.set('tag', tag)
    if (channel) params.set('channel', channel)
    params.set('page', String(page))
    setLoading(true)
    api
      .get<ContactsResponse>(`/api/contacts?${params.toString()}`)
      .then((r) => {
        if (!cancelled) {
          setData(r)
          setError(null)
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debouncedQ, tag, channel, page, reload])

  const remove = async (c: Contact) => {
    if (!confirm(t('confirmDelete'))) return
    try {
      await api.delete(`/api/contacts/${c.id}`)
      setReload((n) => n + 1)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1

  return (
    <>
      <div className="page-title">
        <h1>{t('contacts_title')}</h1>
        <a className="btn" href="/api/contacts/export.csv" target="_blank" rel="noreferrer">
          {t('contacts_export')}
        </a>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="row">
          <input style={{ flex: 2, minWidth: 180, width: 'auto' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('contacts_search')} />
          <select style={{ flex: 1, minWidth: 140, width: 'auto' }} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t('contacts_all_tags')}</option>
            {tags.map((x) => (
              <option key={x.tag} value={x.tag}>
                {x.tag} ({x.n})
              </option>
            ))}
          </select>
          <select style={{ flex: 1, minWidth: 120, width: 'auto' }} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">{t('channel_any')}</option>
            <option value="line">{t('channel_line')}</option>
            <option value="messenger">{t('channel_messenger')}</option>
            <option value="instagram">{t('channel_instagram')}</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        {!data && loading ? (
          <div className="muted">{t('loading')}</div>
        ) : !data || data.contacts.length === 0 ? (
          <div className="muted">{t('contacts_empty')}</div>
        ) : (
          <table style={{ opacity: loading ? 0.6 : 1 }}>
            <thead>
              <tr>
                <th>{t('contacts_name')}</th>
                <th>{t('editor_channel')}</th>
                <th>{t('contacts_tags')}</th>
                <th>{t('contacts_fields')}</th>
                <th>{t('contacts_last')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/inbox/${c.id}`)}>
                  <td>
                    <div>{c.displayName || `#${c.id}`}</div>
                    {c.username && <div className="muted small">@{c.username}</div>}
                  </td>
                  <td>
                    <span className="badge">{t(`channel_${c.channel}` as Key)}</span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {c.tags.map((x) => (
                        <span key={x} className="badge tag">{x}</span>
                      ))}
                    </div>
                  </td>
                  <td className="small">{fieldsSummary(c.fields)}</td>
                  <td className="small muted">{c.lastInboundAt ? new Date(c.lastInboundAt).toLocaleString() : '—'}</td>
                  <td>
                    <button
                      className="btn small danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        void remove(c)
                      }}
                    >
                      {t('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.total > data.size && (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <button className="btn small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ←
            </button>
            <span className="small muted">
              {page} / {pages} ({data.total})
            </span>
            <button className="btn small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              →
            </button>
          </div>
        )}
      </div>
    </>
  )
}
