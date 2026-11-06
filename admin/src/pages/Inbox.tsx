import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Avatar,
  Badge,
  Button,
  Icon,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  TextArea,
  TextField,
  useToast,
} from '@channel.io/bezier-react'
import {
  ArrowLeftIcon,
  CalendarIcon,
  CancelSmallIcon,
  ChatBubbleIcon,
  CheckIcon,
  ClipIcon,
  ImageFailedIcon,
  ImageIcon,
  InboxIcon,
  NoteIcon,
  PersonIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  VideocamIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import { api, errorMessage } from '../lib/api'
import { useLang, useT, type Key } from '../lib/i18n'
import {
  BotStatusBadge,
  ChannelBadge,
  ContactName,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  RelativeTime,
  SelectInput,
  contactDisplayName,
  formatDateTime,
} from '../components'
import './inbox.css'

type Filter = 'all' | 'open' | 'unread' | 'paused' | 'closed'

type ContactSummary = {
  id: number
  channel: string
  channelUserId?: string | null
  displayName: string | null
  username: string | null
  avatarUrl: string | null
  fields: Record<string, string>
  botPaused: number | boolean
  unread: number
  lastInboundAt: string | null
  status: 'open' | 'closed'
  /** Only on GET /api/contacts/:id (the inbox list leaves it out). */
  notes?: string | null
}

type Attachment = { type: string; url?: string }

type OutButton = { label: string; payload?: string; url?: string }

/** Inbound payloads carry `type` / `attachments`; outbound ones are an OutboundMessage (src/channels/types.ts). */
type MessagePayload = {
  imageUrl?: string
  buttons?: OutButton[]
  quickReplies?: OutButton[]
  type?: string
  attachments?: Attachment[]
}

type LastMessage = {
  text: string | null
  direction: 'in' | 'out'
  source: string
  kind: string
  payload?: MessagePayload | null
  error?: string | null
  createdAt: string
}

type Conversation = { contact: ContactSummary; lastMessage: LastMessage | null }

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

/** GET /api/contacts/:id → sequences (src/flows/engine.ts contactSequences). */
type SequenceEnrollment = { id: number; flowId: number; name: string; stepId: string | null; resumeAt: string }

type Snippet = { id: number; name: string; text: string }

const POLL_MS = 10_000
/** Tag chips shown in the chat header before "+N". */
const VISIBLE_TAGS = 5

const ATTACHMENT_LABELS: Record<string, Key> = {
  image: 'inbox_att_image',
  video: 'inbox_att_video',
  audio: 'inbox_att_audio',
  file: 'inbox_att_file',
  sticker: 'inbox_att_sticker',
  location: 'inbox_att_location',
}

const ATTACHMENT_ICONS: Record<string, BezierIcon> = { image: ImageIcon, sticker: ImageIcon, video: VideocamIcon }

function isPaused(c: { botPaused: number | boolean }): boolean {
  return Boolean(c.botPaused)
}

/** Localized label for a message without text: attachments[0].type, then kind. Never "[message]". */
function useAttachmentLabel() {
  const t = useT()
  return (m: { kind: string; payload?: MessagePayload | null }) => {
    const type = m.payload?.attachments?.[0]?.type ?? (m.payload?.imageUrl ? 'image' : m.kind)
    const key = ATTACHMENT_LABELS[type]
    return key ? t(key) : t('inbox_att_other')
  }
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

function firstGrapheme(s: string): string {
  if (!s) return ''
  if (segmenter) {
    const first = segmenter.segment(s)[Symbol.iterator]().next()
    return first.done ? '' : first.value.segment
  }
  return Array.from(s)[0] ?? ''
}

/** "Maria Garcia" → "MG", "佐藤 美咲" → "佐", "👩🏽‍💻🌸" → "👩🏽‍💻" (whole grapheme cluster), "@aleks" → "A". */
function initials(name: string): string {
  const words = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const a = firstGrapheme(words[0])
  const b = words.length > 1 ? firstGrapheme(words[1]) : ''
  const latin = /^[A-Za-z]$/
  return (latin.test(a) && latin.test(b) ? a + b : a).toUpperCase()
}

function ContactAvatar({ contact }: { contact: ContactSummary }) {
  const name = contact.displayName || contact.username || ''
  if (contact.avatarUrl) return <Avatar className="ibx-avatar-img" avatarUrl={contact.avatarUrl} name={name || String(contact.id)} size="36" />
  const text = initials(name)
  return (
    <span className={`ibx-avatar ibx-avatar--${contact.id % 6}`} aria-hidden="true">
      {text ? <span className="ibx-avatar__text">{text}</span> : <Icon source={PersonIcon} size="s" />}
    </span>
  )
}

function ChatImage({ url }: { url: string }) {
  const t = useT()
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <a className="ibx-att" href={url} target="_blank" rel="noreferrer" title={url}>
        <Icon source={ImageFailedIcon} size="xs" />
        <span>{t('inbox_image_failed')}</span>
      </a>
    )
  }
  return (
    <a className="ibx-image" href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={t('inbox_att_image')} loading="lazy" onError={() => setFailed(true)} />
    </a>
  )
}

export default function Inbox() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const toast = useToast()
  const attachmentLabel = useAttachmentLabel()
  const { id } = useParams<{ id: string }>()
  const [filter, setFilter] = useState<Filter>('open')
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [listError, setListError] = useState<unknown>(null)
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [sequences, setSequences] = useState<SequenceEnrollment[]>([])
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [chatError, setChatError] = useState<unknown>(null)
  const [text, setText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  // Unsaved note edits must survive the 10 s poll.
  const notesDirty = useRef(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const loadList = useCallback(async () => {
    try {
      const r = await api.get<{ conversations: Conversation[] }>(`/api/inbox?filter=${filter}`)
      setConversations(r.conversations)
      setListError(null)
    } catch (err) {
      setListError(err)
    }
  }, [filter])

  const loadConversation = useCallback(async () => {
    if (!id) return
    try {
      const [m, c] = await Promise.all([
        api.get<{ messages: Message[] }>(`/api/inbox/${id}/messages`),
        api.get<{ contact: ContactDetail; sequences?: SequenceEnrollment[] }>(`/api/contacts/${id}`),
      ])
      setMessages(m.messages)
      setContact(c.contact)
      if (!notesDirty.current) setNotes(c.contact.notes ?? '')
      setSequences(c.sequences ?? [])
      setChatError(null)
    } catch (err) {
      setChatError(err)
    }
  }, [id])

  useEffect(() => {
    void loadList()
    const timer = setInterval(() => void loadList(), POLL_MS)
    return () => clearInterval(timer)
  }, [loadList])

  useEffect(() => {
    // Optional: without snippets the composer simply has no picker.
    api.get<{ snippets: Snippet[] }>('/api/snippets').then((r) => setSnippets(r.snippets), () => {})
  }, [])

  useEffect(() => {
    setMessages(null)
    setContact(null)
    setSequences([])
    setChatError(null)
    setText('')
    setTagsExpanded(false)
    setNotes('')
    setNotesOpen(false)
    notesDirty.current = false
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
    try {
      await fn()
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
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

  const setBot = (on: boolean) => {
    if (!contact) return
    void run(() => api.post(`/api/inbox/${contact.id}/bot`, { paused: !on }))
  }

  const setStatus = (status: 'open' | 'closed') => {
    if (!contact) return
    void run(() => api.patch(`/api/contacts/${contact.id}`, { status }))
  }

  const saveNotes = async () => {
    if (!contact || !notesDirty.current) return
    try {
      await api.patch(`/api/contacts/${contact.id}`, { notes })
      notesDirty.current = false
      toast.addToast(t('inbox_notes_saved'), { preset: 'success' })
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  const insertSnippet = (snippetId: string) => {
    const s = snippets.find((x) => String(x.id) === snippetId)
    if (s) setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${s.text}` : s.text))
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

  const unsubscribe = (flowId: number) => {
    if (!contact) return
    void run(() => api.delete(`/api/contacts/${contact.id}/sequences/${flowId}`))
  }

  const preview = (m: LastMessage | null) => {
    if (!m) return ''
    const prefix = m.direction === 'out' ? `${m.source === 'human' ? t('inbox_source_human') : m.source === 'system' ? t('inbox_source_system') : t('inbox_source_bot')}: ` : ''
    return prefix + (m.text || attachmentLabel(m))
  }

  const renderMessage = (m: Message) => {
    const p = m.payload
    const imageUrl = p?.imageUrl ?? p?.attachments?.find((a) => a.type === 'image' && a.url)?.url
    const attachments = (p?.attachments ?? []).filter((a) => !(a.type === 'image' && a.url && a.url === imageUrl))
    const buttons = [...(p?.buttons ?? []), ...(p?.quickReplies ?? [])]
    const failed = m.direction === 'out' && !!m.error
    const sourceLabel =
      m.source === 'bot' ? t('inbox_source_bot') : m.source === 'human' ? t('inbox_source_human') : m.source === 'system' ? t('inbox_source_system') : ''
    const hasBody = !!m.text || !!imageUrl || attachments.length > 0
    return (
      <div key={m.id} className={`bubble ${m.direction}${failed ? ' failed' : ''}${m.source === 'system' ? ' ibx-system' : ''}`}>
        {imageUrl && <ChatImage url={imageUrl} />}
        {m.text && <div>{m.source === 'system' && m.text === 'follow' ? t('trigger_follow') : m.text}</div>}
        {attachments.map((a, i) =>
          a.url ? (
            <a key={i} className="ibx-att" href={a.url} target="_blank" rel="noreferrer" title={a.url}>
              <Icon source={ATTACHMENT_ICONS[a.type] ?? ClipIcon} size="xs" />
              <span>{attachmentLabel({ kind: a.type, payload: { attachments: [a] } })}</span>
              <span className="ibx-att__url">{decodeURISafe(a.url)}</span>
            </a>
          ) : (
            <span key={i} className="ibx-att">
              <Icon source={ATTACHMENT_ICONS[a.type] ?? ClipIcon} size="xs" />
              <span>{attachmentLabel({ kind: a.type, payload: { attachments: [a] } })}</span>
            </span>
          ),
        )}
        {!hasBody && (
          <span className="ibx-att">
            <Icon source={ATTACHMENT_ICONS[m.kind] ?? ClipIcon} size="xs" />
            <span>{attachmentLabel(m)}</span>
          </span>
        )}
        {buttons.length > 0 && (
          <div className="chips">
            {buttons.map((b, i) => (
              <button key={i} type="button" className="chip" disabled title={b.url ?? b.payload}>
                {b.label}
              </button>
            ))}
          </div>
        )}
        <div className="meta">
          {failed && <>{t('inbox_failed')} · </>}
          {sourceLabel && <>{sourceLabel} · </>}
          <RelativeTime value={m.createdAt} />
        </div>
        {failed && <div className="bubble-error ibx-error-text">{m.error}</div>}
      </div>
    )
  }

  const tags = contact?.tags ?? []
  const shownTags = tagsExpanded ? tags : tags.slice(0, VISIBLE_TAGS)
  const hiddenTags = tags.length - shownTags.length

  return (
    <div className="stack">
      <PageHeader title={t('inbox_title')} />
      <div className={`ibx${id ? ' has-selection' : ''}`}>
        {/* ---------- conversation list ---------- */}
        <section className="ibx-pane ibx-list" aria-label={t('inbox_title')}>
          <div className="ibx-list__filter">
            <SegmentedControl type="radiogroup" size="s" width="100%" value={filter} onValueChange={(v: Filter) => setFilter(v)} aria-label={t('inbox_title')}>
              <SegmentedControlItem value="all">{t('inbox_all')}</SegmentedControlItem>
              <SegmentedControlItem value="open">{t('inbox_open')}</SegmentedControlItem>
              <SegmentedControlItem value="unread">{t('inbox_unread')}</SegmentedControlItem>
              <SegmentedControlItem value="paused">{t('inbox_filter_paused')}</SegmentedControlItem>
              <SegmentedControlItem value="closed">{t('inbox_closed')}</SegmentedControlItem>
            </SegmentedControl>
          </div>
          <div className="ibx-list__body">
            {listError !== null && (
              <div className="ibx-pad">
                <ErrorBanner error={listError} onRetry={() => void loadList()} />
              </div>
            )}
            {conversations === null ? (
              listError === null && <LoadingState compact />
            ) : conversations.length === 0 ? (
              <EmptyState compact icon={InboxIcon} title={t('inbox_empty')} />
            ) : (
              <ul className="ibx-rows">
                {conversations.map(({ contact: c, lastMessage }) => {
                  const active = String(c.id) === id
                  const name = contactDisplayName(c)
                  return (
                    <li key={c.id}>
                      <Link to={`/inbox/${c.id}`} className={`ibx-row${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                        <ContactAvatar contact={c} />
                        <span className="ibx-row__main">
                          <span className="ibx-row__top">
                            <span className="ibx-row__name" title={name}>
                              <ContactName contact={c} bold={c.unread > 0} />
                            </span>
                            <span className="ibx-row__time">
                              {(lastMessage?.createdAt ?? c.lastInboundAt) && <RelativeTime value={(lastMessage?.createdAt ?? c.lastInboundAt)!} />}
                            </span>
                          </span>
                          <span className="ibx-row__badges">
                            <ChannelBadge channel={c.channel} size="xs" />
                            {isPaused(c) && (
                              <Badge size="xs" variant="orange">
                                {t('inbox_paused')}
                              </Badge>
                            )}
                            {c.status === 'closed' && (
                              <Badge size="xs" variant="monochrome-light" icon={CheckIcon}>
                                {t('inbox_closed')}
                              </Badge>
                            )}
                          </span>
                          <span className="ibx-row__bottom">
                            <span className={`ibx-row__preview${lastMessage?.error ? ' is-failed' : ''}`}>
                              {lastMessage?.error ? `${t('inbox_failed')} · ` : ''}
                              {preview(lastMessage)}
                            </span>
                            <span className="ibx-row__dot">{c.unread > 0 && <span className="ibx-dot" role="img" aria-label={t('inbox_unread')} />}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ---------- chat ---------- */}
        <section className="ibx-pane ibx-chat" aria-label={contact ? contactDisplayName(contact) : t('inbox_select')}>
          {!id ? (
            <div className="ibx-placeholder">
              <EmptyState icon={InboxIcon} title={t('inbox_select')} />
            </div>
          ) : (
            <>
              <header className="ibx-chat__header">
                <div className="ibx-chat__title">
                  <Button
                    className="ibx-back"
                    styleVariant="tertiary"
                    colorVariant="monochrome-dark"
                    size="s"
                    leftContent={ArrowLeftIcon}
                    aria-label={t('inbox_back')}
                    onClick={() => navigate('/inbox')}
                  />
                  {contact && (
                    <>
                      <ContactAvatar contact={contact} />
                      <span className="ibx-chat__name">
                        <ContactName contact={contact} typo="16" bold />
                        <span className="ibx-chat__badges">
                          <ChannelBadge channel={contact.channel} size="xs" />
                          <BotStatusBadge on={!isPaused(contact)} />
                          {contact.status === 'closed' && (
                            <Badge size="xs" variant="monochrome-light" icon={CheckIcon}>
                              {t('inbox_closed')}
                            </Badge>
                          )}
                        </span>
                      </span>
                    </>
                  )}
                </div>
                {contact && (
                  <div className="ibx-chat__tools">
                    <Button
                      size="s"
                      styleVariant="secondary"
                      colorVariant="monochrome-dark"
                      leftContent={contact.status === 'closed' ? RefreshIcon : CheckIcon}
                      text={contact.status === 'closed' ? t('inbox_reopen') : t('inbox_close')}
                      disabled={busy}
                      onClick={() => setStatus(contact.status === 'closed' ? 'open' : 'closed')}
                    />
                    <label className="ibx-chat__bot">
                      <Text typo="13" color="txt-black-darker">
                        {t('inbox_bot')}
                      </Text>
                      <Switch size="m" checked={!isPaused(contact)} disabled={busy} onCheckedChange={setBot} aria-label={isPaused(contact) ? t('inbox_resume_bot') : t('inbox_pause_bot')} />
                    </label>
                  </div>
                )}
                {contact && (
                  <div className="ibx-tags">
                    {sequences.map((s) => (
                      <span key={`seq-${s.id}`} className="ibx-tag ibx-tag--seq" title={`${s.name}\n${t('inbox_sequence_next').replace('{at}', formatDateTime(lang, s.resumeAt))}`}>
                        <Icon source={CalendarIcon} size="xs" />
                        <span className="ibx-tag__text">{s.name}</span>
                        <button type="button" className="ibx-tag__remove" disabled={busy} aria-label={t('inbox_unsubscribe').replace('{name}', s.name)} onClick={() => unsubscribe(s.flowId)}>
                          <Icon source={CancelSmallIcon} size="xs" />
                        </button>
                      </span>
                    ))}
                    {shownTags.map((tag) => (
                      <span key={tag} className="ibx-tag" title={tag}>
                        <span className="ibx-tag__text">{tag}</span>
                        <button type="button" className="ibx-tag__remove" disabled={busy} aria-label={t('inbox_remove_tag').replace('{tag}', tag)} onClick={() => removeTag(tag)}>
                          <Icon source={CancelSmallIcon} size="xs" />
                        </button>
                      </span>
                    ))}
                    {hiddenTags > 0 && (
                      <button type="button" className="ibx-tag-more" aria-expanded={false} aria-label={t('inbox_tags_show_all')} title={tags.slice(VISIBLE_TAGS).join(', ')} onClick={() => setTagsExpanded(true)}>
                        +{hiddenTags}
                      </button>
                    )}
                    {tagsExpanded && tags.length > VISIBLE_TAGS && (
                      <button type="button" className="ibx-tag-more" aria-expanded onClick={() => setTagsExpanded(false)}>
                        {t('inbox_tags_less')}
                      </button>
                    )}
                    <form
                      className="ibx-tag-add"
                      onSubmit={(e) => {
                        e.preventDefault()
                        addTag()
                      }}
                    >
                      <TextField
                        size="xs"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
                        }}
                        placeholder={t('contacts_add_tag')}
                        aria-label={t('contacts_add_tag')}
                      />
                      <Button type="submit" size="xs" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={PlusIcon} aria-label={t('contacts_add_tag')} disabled={busy || !tagInput.trim()} />
                    </form>
                    <Button
                      size="xs"
                      styleVariant="secondary"
                      colorVariant={notes.trim() ? 'blue' : 'monochrome-dark'}
                      leftContent={NoteIcon}
                      text={t('inbox_notes')}
                      aria-expanded={notesOpen}
                      onClick={() => setNotesOpen(!notesOpen)}
                    />
                  </div>
                )}
                {contact && notesOpen && (
                  <TextArea
                    className="ibx-notes"
                    minRows={3}
                    maxRows={6}
                    maxLength={5000}
                    value={notes}
                    onChange={(e) => {
                      notesDirty.current = true
                      setNotes(e.target.value)
                    }}
                    onBlur={() => void saveNotes()}
                    placeholder={t('inbox_notes_placeholder')}
                    aria-label={t('inbox_notes')}
                  />
                )}
              </header>

              <div className="ibx-messages" ref={messagesRef}>
                {chatError !== null && <ErrorBanner error={chatError} onRetry={() => void loadConversation()} />}
                {messages === null ? (
                  chatError === null && <LoadingState compact />
                ) : messages.length === 0 ? (
                  <div className="ibx-placeholder">
                    <EmptyState compact icon={ChatBubbleIcon} title={t('inbox_no_messages')} />
                  </div>
                ) : (
                  messages.map(renderMessage)
                )}
              </div>

              <form
                className="ibx-composer"
                onSubmit={(e) => {
                  e.preventDefault()
                  send()
                }}
              >
                {snippets.length > 0 && (
                  <div className="ibx-composer__snippets">
                    <SelectInput value="" options={snippets.map((s) => ({ value: String(s.id), label: s.name }))} onChange={insertSnippet} placeholder={t('inbox_snippet')} aria-label={t('inbox_snippet')} dropdownPosition="top-left" />
                  </div>
                )}
                <TextArea
                  className="ibx-composer__input"
                  minRows={3}
                  maxRows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onComposerKey}
                  placeholder={t('inbox_placeholder')}
                  aria-label={t('inbox_placeholder')}
                />
                <Button type="submit" text={t('inbox_send')} leftContent={SendIcon} loading={busy} disabled={!text.trim()} />
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function decodeURISafe(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}
