import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import { useT, type Key } from '../lib/i18n'

type Filter = 'all' | 'unread' | 'paused'

type ContactSummary = {
  id: number
  channel: string
  displayName: string | null
  username: string | null
  avatarUrl: string | null
  fields: Record<string, string>
  botPaused: number | boolean
  unread: number
  lastInboundAt: string | null
}

type LastMessage = { text: string | null; direction: 'in' | 'out'; source: string; kind: string; createdAt: string }

type Conversation = { contact: ContactSummary; lastMessage: LastMessage | null }

type Button = { label: string; payload?: string; url?: string }

type MessagePayload = {
  imageUrl?: string
  buttons?: Button[]
  quickReplies?: Button[]
  type?: string
  attachments?: { type: string; url?: string }[]
}

type Message = {
  id: number
  direction: 'in' | 'out'
  source: 'user' | 'bot' | 'human' | 'system'
  kind: string
  text: string | null
  payload: MessagePayload | null
  error: string | null
  createdAt: string
}

type ContactDetail = ContactSummary & { tags: string[] }

const POLL_MS = 10_000

function shortTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  return d.toLocaleDateString()
}

function contactName(c: { displayName: string | null; username: string | null; id: number }): string {
  return c.displayName || (c.username ? `@${c.username}` : `#${c.id}`)
}

function useIsMobile(): boolean {
  const query = '(max-width: 860px)'
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function isPaused(c: { botPaused: number | boolean }): boolean {
  return Boolean(c.botPaused)
}

export default function Inbox() {
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [filter, setFilter] = useState<Filter>('all')
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)
  const isMobile = useIsMobile()

  const channelLabel = (ch: string) => t(`channel_${ch}` as Key)

  const loadList = useCallback(async () => {
    try {
      const r = await api.get<{ conversations: Conversation[] }>(`/api/inbox?filter=${filter}`)
      setConversations(r.conversations)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [filter])

  const loadConversation = useCallback(async () => {
    if (!id) return
    try {
      const [m, c] = await Promise.all([
        api.get<{ messages: Message[] }>(`/api/inbox/${id}/messages`),
        api.get<{ contact: ContactDetail }>(`/api/contacts/${id}`),
      ])
      setMessages(m.messages)
      setContact(c.contact)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [id])

  useEffect(() => {
    void loadList()
    const timer = setInterval(() => void loadList(), POLL_MS)
    return () => clearInterval(timer)
  }, [loadList])

  useEffect(() => {
    setMessages(null)
    setContact(null)
    setText('')
    lastCount.current = 0
    if (!id) return
    void loadConversation()
    const timer = setInterval(() => void loadConversation(), POLL_MS)
    return () => clearInterval(timer)
  }, [id, loadConversation])

  useEffect(() => {
    const el = messagesRef.current
    if (el && messages && messages.length !== lastCount.current) {
      el.scrollTop = el.scrollHeight
      lastCount.current = messages.length
    }
  }, [messages])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      await Promise.all([loadConversation(), loadList()])
    }
  }

  const send = () => {
    const body = text.trim()
    if (!body || !id || busy) return
    void run(async () => {
      await api.post(`/api/inbox/${id}/send`, { text: body })
      setText('')
    })
  }

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const toggleBot = () => {
    if (!contact) return
    void run(() => api.post(`/api/inbox/${contact.id}/bot`, { paused: !isPaused(contact) }))
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (!tag || !contact) return
    void run(async () => {
      await api.post(`/api/contacts/${contact.id}/tags`, { tag })
      setTagInput('')
    })
  }

  const removeTag = (tag: string) => {
    if (!contact) return
    void run(() => api.delete(`/api/contacts/${contact.id}/tags/${encodeURIComponent(tag)}`))
  }

  const filters: [Filter, string][] = [
    ['all', t('inbox_all')],
    ['unread', t('inbox_unread')],
    ['paused', t('inbox_paused')],
  ]

  const preview = (m: LastMessage | null) => {
    if (!m) return ''
    const prefix = m.direction === 'out' ? (m.source === 'human' ? `${t('inbox_source_human')}: ` : `${t('inbox_source_bot')}: `) : ''
    return prefix + (m.text || `[${m.kind}]`)
  }

  const renderMessage = (m: Message) => {
    const p = m.payload
    const imageUrl = p?.imageUrl ?? p?.attachments?.find((a) => a.type === 'image' && a.url)?.url
    const otherAttachments = p?.attachments?.filter((a) => a.url !== imageUrl) ?? []
    const buttons = [...(p?.buttons ?? []), ...(p?.quickReplies ?? [])]
    const sourceLabel = m.source === 'bot' ? t('inbox_source_bot') : m.source === 'human' ? t('inbox_source_human') : m.source === 'system' ? 'system' : ''
    return (
      <div key={m.id} className={`bubble ${m.direction}${m.error ? ' error' : ''}`}>
        {imageUrl && (
          <a href={imageUrl} target="_blank" rel="noreferrer">
            <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, display: 'block' }} />
          </a>
        )}
        {m.text ? <div>{m.text}</div> : !imageUrl && <div className="small">[{p?.type ?? m.kind}]</div>}
        {otherAttachments.map((a, i) => (
          <div key={i} className="small">
            [{a.type}]{a.url && <> <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{a.url}</a></>}
          </div>
        ))}
        {buttons.length > 0 && (
          <div className="chips">
            {buttons.map((b, i) => (
              <button key={i} className="chip" disabled style={m.direction === 'out' ? { color: '#fff', borderColor: '#fff' } : undefined}>
                {b.label}
              </button>
            ))}
          </div>
        )}
        {m.error && <div className="small" style={{ color: m.direction === 'out' ? '#fff' : 'var(--danger)', fontWeight: 600 }}>{t('error')}: {m.error}</div>}
        <div className="meta">
          {sourceLabel && <>{sourceLabel} · </>}
          {new Date(m.createdAt).toLocaleString()}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-title">
        <h1>{t('inbox_title')}</h1>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className={`inbox${id ? ' has-selection' : ''}`}>
        <div className="conv-list">
          <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
            {filters.map(([key, label]) => (
              <button key={key} className={`btn small${filter === key ? ' primary' : ''}`} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          {conversations === null ? (
            <div className="muted small" style={{ padding: 12 }}>{t('loading')}</div>
          ) : conversations.length === 0 ? (
            <div className="muted small" style={{ padding: 12 }}>{t('inbox_empty')}</div>
          ) : (
            conversations.map(({ contact: c, lastMessage }) => (
              <div key={c.id} className={`conv${String(c.id) === id ? ' active' : ''}`} onClick={() => navigate(`/inbox/${c.id}`)}>
                <div className="name">
                  <span className="row" style={{ gap: 6, minWidth: 0 }}>
                    {c.unread > 0 && <span className="unread-dot" />}
                    <span>{contactName(c)}</span>
                  </span>
                  <span className="muted small" style={{ fontWeight: 400 }}>{shortTime(lastMessage?.createdAt ?? c.lastInboundAt)}</span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <span className="badge">{channelLabel(c.channel)}</span>
                  {isPaused(c) && <span className="badge draft">{t('inbox_paused')}</span>}
                </div>
                <div className="preview">{preview(lastMessage)}</div>
              </div>
            ))
          )}
        </div>

        {!id ? (
          <div className="chat">
            <div className="messages muted" style={{ alignItems: 'center', justifyContent: 'center' }}>{t('inbox_select')}</div>
          </div>
        ) : (
          <div className="chat">
            <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  {isMobile && (
                    <Link to="/inbox" className="small" onClick={(e) => (e.preventDefault(), navigate('/inbox'))}>
                      ← {t('inbox_title')}
                    </Link>
                  )}
                  {contact && (
                    <>
                      <strong>{contactName(contact)}</strong>
                      <span className="badge">{channelLabel(contact.channel)}</span>
                    </>
                  )}
                </div>
                {contact && (
                  <div className="row">
                    <span className={`badge ${isPaused(contact) ? 'draft' : 'live'}`}>{isPaused(contact) ? t('inbox_bot_off') : t('inbox_bot_on')}</span>
                    <button className="btn small" disabled={busy} onClick={toggleBot}>
                      {isPaused(contact) ? t('inbox_resume_bot') : t('inbox_pause_bot')}
                    </button>
                  </div>
                )}
              </div>
              {contact && (
                <div className="row" style={{ marginTop: 8 }}>
                  {contact.tags.map((tag) => (
                    <span key={tag} className="badge tag">
                      {tag}{' '}
                      <a href="#" onClick={(e) => (e.preventDefault(), removeTag(tag))} aria-label={`${t('delete')} ${tag}`}>
                        ×
                      </a>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        addTag()
                      }
                    }}
                    placeholder={t('contacts_add_tag')}
                    style={{ width: 140, padding: '3px 8px' }}
                  />
                  <button className="btn small" disabled={busy || !tagInput.trim()} onClick={addTag}>
                    +
                  </button>
                </div>
              )}
            </div>
            <div className="messages" ref={messagesRef}>
              {messages === null ? <div className="muted">{t('loading')}</div> : messages.map(renderMessage)}
            </div>
            <div className="composer">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder={t('inbox_placeholder')}
                style={{ minHeight: 44 }}
              />
              <button className="btn primary" disabled={busy || !text.trim()} onClick={send}>
                {t('inbox_send')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
