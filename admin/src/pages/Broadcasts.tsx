import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useT, type Key } from '../lib/i18n'

type BroadcastStatus = 'scheduled' | 'running' | 'done' | 'canceled'

type Broadcast = {
  id: number
  name: string
  channel: string
  tag: string | null
  text: string
  status: BroadcastStatus
  total: number
  sent: number
  failed: number
  scheduledAt: string
  createdAt: string
}

type Reach = { total: number; reachable: number }
type TagCount = { tag: string; n: number }

const emptyForm = { name: '', channel: 'any', tag: '', text: '', imageUrl: '', scheduledAt: '' }

const statusBadge: Record<BroadcastStatus, string> = { scheduled: 'tag', running: 'live', done: 'draft', canceled: 'draft' }

export default function Broadcasts() {
  const t = useT()
  const [form, setForm] = useState(emptyForm)
  const [broadcasts, setBroadcasts] = useState<Broadcast[] | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [reach, setReach] = useState<Reach | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ broadcasts: Broadcast[] }>('/api/broadcasts')
      setBroadcasts(r.broadcasts)
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) })
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    api
      .get<{ tags: TagCount[] }>('/api/tags')
      .then((r) => setTags(r.tags))
      .catch(() => setTags([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ channel: form.channel })
      if (form.tag.trim()) params.set('tag', form.tag.trim())
      api
        .get<Reach>(`/api/broadcasts/reach?${params.toString()}`)
        .then((r) => !cancelled && setReach(r))
        .catch(() => !cancelled && setReach(null))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.channel, form.tag])

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      let scheduledAt: string | undefined
      if (form.scheduledAt) {
        const d = new Date(form.scheduledAt)
        if (Number.isNaN(d.getTime())) throw new Error('invalid_date')
        scheduledAt = d.toISOString()
      }
      await api.post('/api/broadcasts', {
        name: form.name.trim(),
        channel: form.channel,
        tag: form.tag.trim(),
        text: form.text,
        imageUrl: form.imageUrl.trim(),
        scheduledAt,
      })
      setForm(emptyForm)
      setMsg({ kind: 'ok', text: t('saved') })
      await load()
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (b: Broadcast) => {
    if (!confirm(`${t('bc_cancel')}: ${b.name}?`)) return
    try {
      await api.post(`/api/broadcasts/${b.id}/cancel`)
      await load()
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) })
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>{t('bc_title')}</h1>
      </div>
      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      <div className="card">
        <h2>{t('bc_new')}</h2>
        <div className="alert info small">{t('bc_note')}</div>
        <div className="inline-fields">
          <div>
            <label>{t('bc_name')}</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>{t('editor_channel')}</label>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="any">{t('channel_any')}</option>
              <option value="line">{t('channel_line')}</option>
              <option value="messenger">{t('channel_messenger')}</option>
              <option value="instagram">{t('channel_instagram')}</option>
            </select>
          </div>
        </div>
        <label>{t('bc_tag')}</label>
        <input list="bc-tags" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} autoComplete="off" />
        <datalist id="bc-tags">
          {tags.map((x) => (
            <option key={x.tag} value={x.tag}>
              {x.tag} ({x.n})
            </option>
          ))}
        </datalist>
        <label>{t('bc_text')}</label>
        <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <div className="inline-fields">
          <div>
            <label>{t('bc_image')}</label>
            <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://" />
          </div>
          <div>
            <label>{t('bc_schedule')}</label>
            <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span className="small muted">
            {t('bc_reach')}: {reach ? `${reach.total} / ${reach.reachable} ${t('bc_reachable')}` : '…'}
          </span>
          <button className="btn primary" disabled={busy || !form.text.trim()} onClick={() => void submit()}>
            {t('create')}
          </button>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        {broadcasts === null ? (
          <div className="muted">{t('loading')}</div>
        ) : broadcasts.length === 0 ? (
          <div className="muted small">—</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('bc_name')}</th>
                <th>{t('editor_channel')}</th>
                <th>{t('contacts_tags')}</th>
                <th>{t('bc_schedule')}</th>
                <th>{t('bc_reach')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div>{b.name}</div>
                    <div className="muted small" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.text}</div>
                    <span className={`badge ${statusBadge[b.status] ?? ''}`}>{t(`bc_status_${b.status}` as Key)}</span>
                  </td>
                  <td>
                    <span className="badge">{t(`channel_${b.channel}` as Key)}</span>
                  </td>
                  <td>{b.tag ? <span className="badge tag">{b.tag}</span> : <span className="muted">—</span>}</td>
                  <td className="small">{new Date(b.scheduledAt).toLocaleString()}</td>
                  <td className="small">
                    <div>{b.sent} {t('bc_sent')} / {b.total}</div>
                    <div className="muted">{b.failed} {t('bc_failed')}</div>
                  </td>
                  <td>
                    {(b.status === 'scheduled' || b.status === 'running') && (
                      <button className="btn small danger" onClick={() => void cancel(b)}>
                        {t('bc_cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
