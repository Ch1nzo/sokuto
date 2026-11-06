import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Icon, KeyValueItem, Switch, Text, TextArea, TextField, Tooltip, useToast } from '@channel.io/bezier-react'
import {
  AiIcon,
  ArrowLeftIcon,
  CalendarIcon,
  CancelSmallIcon,
  ChatBubbleIcon,
  CheckIcon,
  ChevronSmallDownIcon,
  ChevronSmallRightIcon,
  ClipIcon,
  ImageFailedIcon,
  ImageIcon,
  InboxIcon,
  LinkCopyIcon,
  PersonIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  ShoppingIcon,
  VideocamIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import { ApiError, api, errorMessage } from '../lib/api'
import { useLang, useT, type Key, type Lang } from '../lib/i18n'
import { countLabel, useWorkspaces } from '../lib/workspace'
import {
  BotStatusBadge,
  ChannelBadge,
  ContactAvatar,
  ContactName,
  Drawer,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  RelativeTime,
  SelectInput,
  contactDisplayName,
  formatDateTime,
  middleTruncate,
  useCopy,
} from '../components'
import { ProductPicker } from './bot/ProductPicker'
import type { BotResponse, Product } from './bot/types'
import './inbox.css'

type Filter = 'all' | 'open' | 'unread' | 'paused' | 'closed'

/** Channel.io order: the working queue first, everything last. */
const FILTERS: [Filter, Key][] = [
  ['open', 'inbox_open'],
  ['unread', 'inbox_unread'],
  ['paused', 'inbox_filter_paused'],
  ['closed', 'inbox_closed'],
  ['all', 'inbox_all'],
]

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
  lastOutboundAt?: string | null
  createdAt?: string
  status: 'open' | 'closed'
  /** Only on GET /api/contacts/:id (the inbox list leaves it out). */
  notes?: string | null
}

type Attachment = { type: string; url?: string }

type OutButton = { label: string; payload?: string; url?: string }

/**
 * Inbound payloads carry `type` / `attachments`; outbound ones are an OutboundMessage (src/channels/types.ts).
 * Soku replies add `bot` (its name); product cards (Soku or a person) add `cards`.
 */
type MessagePayload = {
  imageUrl?: string
  buttons?: OutButton[]
  quickReplies?: OutButton[]
  type?: string
  attachments?: Attachment[]
  bot?: string
  cards?: { title: string; subtitle?: string; imageUrl?: string }[]
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
  /** Optimistic bubble that has not reached the server yet. */
  pending?: boolean
}

/** A reply typed here that is not in GET /messages yet (sending), or that never reached the server (failed). */
type LocalMessage = { key: number; text: string; createdAt: string; error: string | null }

type ContactDetail = ContactSummary & { tags: string[] }

/** GET /api/contacts/:id → sequences (src/flows/engine.ts contactSequences). */
type SequenceEnrollment = { id: number; flowId: number; name: string; stepId: string | null; resumeAt: string }

type Snippet = { id: number; name: string; text: string }

type Section = 'basic' | 'tags' | 'fields' | 'notes' | 'sequences'

const POLL_MS = 10_000
/** Three panes from this width; below it the user info opens as a drawer (≤ 860px: a bottom sheet). */
const WIDE_QUERY = '(min-width: 1240px)'

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

/** Case- and width-insensitive ("ＡＢＣ１２" matches "abc12"). */
const normalize = (s: string) => s.normalize('NFKC').toLowerCase()

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const update = () => setMatches(m.matches)
    update()
    m.addEventListener('change', update)
    return () => m.removeEventListener('change', update)
  }, [query])
  return matches
}

/** Local calendar day + date/time formatters for the chat (date separators, bubble times). */
function useChatDates(lang: Lang) {
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
    const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
    const valid = (iso: string) => !Number.isNaN(new Date(iso).getTime())
    return {
      dayKey: (iso: string) => (valid(iso) ? new Date(iso).toDateString() : ''),
      day: (iso: string) => (valid(iso) ? day.format(new Date(iso)) : ''),
      time: (iso: string) => (valid(iso) ? time.format(new Date(iso)) : ''),
    }
  }, [lang])
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

function ChatImage({ url }: { url: string }) {
  const t = useT()
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <a className="ibx-att" href={url} target="_blank" rel="noreferrer" title={url}>
        <Icon source={ImageFailedIcon} size="xs" aria-hidden />
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

/** Collapsible block of the user info panel; the heading button toggles it. */
function InfoSection({ id, title, count, open, onToggle, children }: { id: Section; title: string; count?: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="ibx-sec">
      <h3 className="ibx-sec__title">
        <button type="button" className="ibx-sec__toggle" aria-expanded={open} aria-controls={`ibx-sec-${id}`} onClick={onToggle}>
          <Icon source={open ? ChevronSmallDownIcon : ChevronSmallRightIcon} size="xs" color="txt-black-dark" aria-hidden />
          <span>{title}</span>
          {count !== undefined && <span className="ibx-sec__count">{count}</span>}
        </button>
      </h3>
      <div id={`ibx-sec-${id}`} className="ibx-sec__body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

export default function Inbox() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const toast = useToast()
  const copy = useCopy()
  const { unread } = useWorkspaces()
  const dates = useChatDates(lang)
  const wide = useMediaQuery(WIDE_QUERY)
  const attachmentLabel = useAttachmentLabel()
  const { id } = useParams<{ id: string }>()
  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [listError, setListError] = useState<unknown>(null)
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [sequences, setSequences] = useState<SequenceEnrollment[]>([])
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [outbox, setOutbox] = useState<LocalMessage[]>([])
  const [chatError, setChatError] = useState<unknown>(null)
  const [text, setText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [notes, setNotes] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [soku, setSoku] = useState<BotResponse | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [collapsed, setCollapsed] = useState<Partial<Record<Section, boolean>>>({})
  // Unsaved note edits must survive the 10 s poll.
  const notesDirty = useRef(false)
  // A response for a conversation the user already left must not land in the open one.
  const idRef = useRef(id)
  idRef.current = id
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
      if (idRef.current !== id) return
      setMessages(m.messages)
      setContact(c.contact)
      if (!notesDirty.current) setNotes(c.contact.notes ?? '')
      setSequences(c.sequences ?? [])
      setChatError(null)
    } catch (err) {
      if (idRef.current === id) setChatError(err)
    }
  }, [id])

  useEffect(() => {
    void loadList()
    const timer = setInterval(() => void loadList(), POLL_MS)
    return () => clearInterval(timer)
  }, [loadList])

  useEffect(() => {
    // Optional: without snippets the composer simply has no picker; without Soku, no draft / product buttons.
    api.get<{ snippets: Snippet[] }>('/api/snippets').then((r) => setSnippets(r.snippets), () => {})
    api.get<BotResponse>('/api/bot').then(setSoku, () => {})
  }, [])

  useEffect(() => {
    setMessages(null)
    setOutbox([])
    setContact(null)
    setSequences([])
    setChatError(null)
    setText('')
    setTagInput('')
    setNotes('')
    setInfoOpen(false)
    notesDirty.current = false
    lastCount.current = 0
    if (!id) return
    void loadConversation()
    const timer = setInterval(() => void loadConversation(), POLL_MS)
    return () => clearInterval(timer)
  }, [id, loadConversation])

  const shownCount = (messages?.length ?? 0) + outbox.length
  useEffect(() => {
    const el = messagesRef.current
    if (el && messages && shownCount !== lastCount.current) {
      el.scrollTop = el.scrollHeight
      lastCount.current = shownCount
    }
  }, [messages, shownCount])

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

  /** Optimistic: the bubble (`text`) shows at once; on error it stays as a failed bubble with the reason. */
  const deliver = (body: string, post: () => Promise<unknown>) => {
    const key = Date.now()
    setOutbox((o) => [...o, { key, text: body, createdAt: new Date().toISOString(), error: null }])
    void (async () => {
      try {
        await post()
        await loadConversation()
        setOutbox((o) => o.filter((x) => x.key !== key))
      } catch (err) {
        if (err instanceof ApiError && err.status === 502) {
          // The channel refused it: the server logged it as a failed message, which the reload brings in.
          await loadConversation()
          setOutbox((o) => o.filter((x) => x.key !== key))
        } else {
          const reason = err instanceof ApiError && err.code === 'channel_not_configured' ? t('inbox_err_channel') : errorMessage(err)
          setOutbox((o) => o.map((x) => (x.key === key ? { ...x, error: reason } : x)))
        }
      }
      void loadList()
    })()
  }

  const send = () => {
    const body = text.trim()
    if (!body || !id) return
    setText('')
    deliver(body, () => api.post(`/api/inbox/${id}/send`, { text: body }))
  }

  /** Product cards: the optimistic bubble lists the names; the reload brings in the logged cards. */
  const sendProducts = (products: Product[]) => {
    if (!id || products.length === 0) return
    const body = [...products.map((p) => p.name), t('inbox_cards_count').replace('{n}', String(products.length))].join('\n')
    deliver(body, () => api.post(`/api/inbox/${id}/products`, { productIds: products.map((p) => p.id) }))
  }

  /** Soku drafts a reply for the person; it lands in the composer (after any text already there). */
  const draft = async () => {
    const forId = id
    if (!forId) return
    setDrafting(true)
    try {
      const r = await api.post<{ draft: string }>(`/api/inbox/${forId}/draft`)
      if (idRef.current === forId) setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${r.draft}` : r.draft))
    } catch (err) {
      toast.addToast(err instanceof ApiError && err.code === 'ai_not_configured' ? t('bot_ov_no_ai') : errorMessage(err), { preset: 'error' })
    } finally {
      setDrafting(false)
    }
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

  const sourceLabel = (source: string) =>
    source === 'human' ? t('inbox_source_human') : source === 'system' ? t('inbox_source_system') : source === 'bot' ? t('inbox_source_bot') : ''

  const preview = (m: LastMessage | null) => {
    if (!m) return ''
    const prefix = m.direction === 'out' ? `${m.payload?.bot || sourceLabel(m.source) || t('inbox_source_bot')}: ` : ''
    return prefix + (m.text || attachmentLabel(m))
  }

  const needle = normalize(query.trim())
  const shown =
    conversations && needle
      ? conversations.filter(({ contact: c }) => [c.displayName, c.username, c.channelUserId, String(c.id)].some((v) => v && normalize(v).includes(needle)))
      : conversations

  const renderMessage = (m: Message) => {
    const time = dates.time(m.createdAt)
    if (m.source === 'system') {
      return (
        <div key={m.id} className="ibx-msg ibx-msg--system">
          {m.text === 'follow' ? t('trigger_follow') : m.text || attachmentLabel(m)}
          {time && <span className="tabular"> · {time}</span>}
        </div>
      )
    }
    const p = m.payload
    const imageUrl = p?.imageUrl ?? p?.attachments?.find((a) => a.type === 'image' && a.url)?.url
    const attachments = (p?.attachments ?? []).filter((a) => !(a.type === 'image' && a.url && a.url === imageUrl))
    const buttons = [...(p?.buttons ?? []), ...(p?.quickReplies ?? [])]
    const cards = p?.cards ?? []
    const failed = m.direction === 'out' && !!m.error
    const who = m.direction === 'in' ? 'in' : m.source === 'human' ? 'human' : 'bot'
    const hasBody = !!m.text || !!imageUrl || attachments.length > 0 || cards.length > 0
    return (
      <div key={m.id} className={`ibx-msg ibx-msg--${who}${m.pending ? ' is-pending' : ''}`}>
        <div className={`bubble ${m.direction}${failed ? ' failed' : ''}${who === 'bot' ? ' ibx-bubble--bot' : ''}`}>
          {imageUrl && <ChatImage url={imageUrl} />}
          {m.text && <div>{m.text}</div>}
          {attachments.map((a, i) =>
            a.url ? (
              <a key={i} className="ibx-att" href={a.url} target="_blank" rel="noreferrer" title={a.url}>
                <Icon source={ATTACHMENT_ICONS[a.type] ?? ClipIcon} size="xs" aria-hidden />
                <span>{attachmentLabel({ kind: a.type, payload: { attachments: [a] } })}</span>
                <span className="ibx-att__url">{decodeURISafe(a.url)}</span>
              </a>
            ) : (
              <span key={i} className="ibx-att">
                <Icon source={ATTACHMENT_ICONS[a.type] ?? ClipIcon} size="xs" aria-hidden />
                <span>{attachmentLabel({ kind: a.type, payload: { attachments: [a] } })}</span>
              </span>
            ),
          )}
          {!hasBody && (
            <span className="ibx-att">
              <Icon source={ATTACHMENT_ICONS[m.kind] ?? ClipIcon} size="xs" aria-hidden />
              <span>{attachmentLabel(m)}</span>
            </span>
          )}
          {cards.length > 0 && (
            <div className="ibx-cards">
              {cards.map((c, i) => (
                <div key={i} className="ibx-card">
                  {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" className="ibx-card__img" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                  <div className="ibx-card__title">{c.title}</div>
                  {c.subtitle && <div className="ibx-card__sub">{c.subtitle}</div>}
                </div>
              ))}
            </div>
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
        </div>
        <div className="ibx-msg__meta">
          {failed && <span className="ibx-msg__failed">{t('inbox_failed')} · </span>}
          {who !== 'in' && <>{p?.bot || sourceLabel(m.source)} · </>}
          {m.pending ? t('inbox_sending') : <time className="tabular" dateTime={m.createdAt} title={formatDateTime(lang, m.createdAt)}>{time}</time>}
        </div>
        {failed && <div className="ibx-msg__error">{m.error}</div>}
      </div>
    )
  }

  const thread: ReactNode[] = []
  if (messages) {
    const local: Message[] = outbox.map((o) => ({ id: -o.key, direction: 'out', source: 'human', kind: 'text', text: o.text, payload: null, error: o.error, createdAt: o.createdAt, pending: !o.error }))
    let lastDay = ''
    for (const m of [...messages, ...local]) {
      const day = dates.dayKey(m.createdAt)
      if (day && day !== lastDay) {
        thread.push(
          <div key={`day-${day}`} className="ibx-day">
            <time dateTime={m.createdAt}>{dates.day(m.createdAt)}</time>
          </div>,
        )
        lastDay = day
      }
      thread.push(renderMessage(m))
    }
  }

  const toggle = (s: Section) => setCollapsed((c) => ({ ...c, [s]: !c[s] }))
  const fields = contact ? Object.entries(contact.fields ?? {}) : []
  const dash = (
    <Text typo="14" color="txt-black-dark">
      —
    </Text>
  )

  const statusBadge =
    contact?.status === 'closed' ? (
      <Badge size="xs" variant="monochrome-light" icon={CheckIcon}>
        {t('inbox_closed')}
      </Badge>
    ) : (
      <Badge size="xs" variant="green">
        {t('inbox_open')}
      </Badge>
    )

  const info = contact && (
    <div className="ibx-info__sections">
      <InfoSection id="basic" title={t('inbox_info_basic')} open={!collapsed.basic} onToggle={() => toggle('basic')}>
        <div className="ibx-kv">
          <KeyValueItem keyContent={t('editor_channel')}>
            <span className="ibx-kv__chip">
              <ChannelBadge channel={contact.channel} size="xs" />
            </span>
          </KeyValueItem>
          <KeyValueItem
            keyContent="ID"
            actions={
              contact.channelUserId ? (
                <Button
                  size="xs"
                  styleVariant="tertiary"
                  colorVariant="monochrome-light"
                  leftContent={LinkCopyIcon}
                  aria-label={`${t('copy')}: ID`}
                  onClick={() => void copy(contact.channelUserId ?? '')}
                />
              ) : undefined
            }
          >
            {contact.channelUserId ? (
              <span className="mono" title={contact.channelUserId} translate="no">
                {middleTruncate(contact.channelUserId)}
              </span>
            ) : (
              '—'
            )}
          </KeyValueItem>
          <KeyValueItem keyContent={t('flows_status')}>
            <span className="ibx-kv__chip">{statusBadge}</span>
          </KeyValueItem>
          <KeyValueItem keyContent={t('inbox_bot')}>
            <span className="ibx-kv__chip">
              <BotStatusBadge on={!isPaused(contact)} size="xs" />
            </span>
          </KeyValueItem>
          <KeyValueItem keyContent={t('contacts_last')}>{contact.lastInboundAt ? <RelativeTime value={contact.lastInboundAt} /> : dash}</KeyValueItem>
          <KeyValueItem keyContent={t('inbox_info_last_out')}>{contact.lastOutboundAt ? <RelativeTime value={contact.lastOutboundAt} /> : dash}</KeyValueItem>
          {contact.createdAt && <KeyValueItem keyContent={t('inbox_info_created')}>{formatDateTime(lang, contact.createdAt)}</KeyValueItem>}
        </div>
      </InfoSection>

      <InfoSection id="tags" title={t('contacts_tags')} count={contact.tags.length} open={!collapsed.tags} onToggle={() => toggle('tags')}>
        {contact.tags.length > 0 && (
          <div className="ibx-tags">
            {contact.tags.map((tag) => (
              <span key={tag} className="ibx-tag" title={tag}>
                <span className="ibx-tag__text">{tag}</span>
                <button type="button" className="ibx-tag__remove" disabled={busy} aria-label={t('inbox_remove_tag').replace('{tag}', tag)} onClick={() => removeTag(tag)}>
                  <Icon source={CancelSmallIcon} size="xs" />
                </button>
              </span>
            ))}
          </div>
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
            name="tag"
            autoComplete="off"
            maxLength={100}
          />
          <Button type="submit" size="xs" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={PlusIcon} aria-label={t('contacts_add_tag')} disabled={busy || !tagInput.trim()} />
        </form>
      </InfoSection>

      {fields.length > 0 && (
        <InfoSection id="fields" title={t('contacts_fields')} count={fields.length} open={!collapsed.fields} onToggle={() => toggle('fields')}>
          <div className="ibx-kv">
            {fields.map(([k, v]) => (
              <KeyValueItem key={k} keyContent={<span title={k}>{k}</span>}>
                <span title={v}>{v}</span>
              </KeyValueItem>
            ))}
          </div>
        </InfoSection>
      )}

      <InfoSection id="notes" title={t('inbox_notes')} open={!collapsed.notes} onToggle={() => toggle('notes')}>
        <TextArea
          minRows={3}
          maxRows={10}
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
      </InfoSection>

      {sequences.length > 0 && (
        <InfoSection id="sequences" title={t('inbox_sequences')} count={sequences.length} open={!collapsed.sequences} onToggle={() => toggle('sequences')}>
          <ul className="ibx-seqs">
            {sequences.map((s) => (
              <li key={s.id} className="ibx-seq">
                <Icon source={CalendarIcon} size="xs" className="ibx-seq__icon" aria-hidden />
                <span className="ibx-seq__text">
                  <span className="ibx-seq__name">{s.name}</span>
                  <span className="ibx-seq__next tabular">{t('inbox_sequence_next').replace('{at}', formatDateTime(lang, s.resumeAt))}</span>
                </span>
                <button type="button" className="ibx-tag__remove" disabled={busy} aria-label={t('inbox_unsubscribe').replace('{name}', s.name)} onClick={() => unsubscribe(s.flowId)}>
                  <Icon source={CancelSmallIcon} size="xs" />
                </button>
              </li>
            ))}
          </ul>
        </InfoSection>
      )}
    </div>
  )

  const showInfoPane = wide && !!id

  return (
    <div className="stack">
      <PageHeader title={t('inbox_title')} />
      <div className={['ibx', id && 'has-selection', showInfoPane && 'has-info'].filter(Boolean).join(' ')}>
        {/* ---------- conversation list ---------- */}
        <section className="ibx-pane ibx-list" aria-label={t('inbox_title')}>
          <div className="ibx-list__head">
            <TextField
              type="search"
              size="m"
              leftContent={{ icon: SearchIcon }}
              allowClear
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('inbox_search')}
              aria-label={t('inbox_search')}
              name="q"
              autoComplete="off"
            />
            <div className="filter-chips filter-chips--scroll" role="group" aria-label={t('inbox_filters')}>
              {FILTERS.map(([value, label]) => {
                const n = value === filter ? (conversations?.length ?? null) : value === 'unread' ? unread : null
                return (
                  <button key={value} type="button" className="filter-chip" aria-pressed={value === filter} onClick={() => setFilter(value)}>
                    {t(label)}
                    {n !== null && n > 0 && <span className="filter-chip__count">{countLabel(n)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="ibx-list__body">
            {listError !== null && (
              <div className="ibx-pad">
                <ErrorBanner error={listError} onRetry={() => void loadList()} />
              </div>
            )}
            {shown === null ? (
              listError === null && <LoadingState compact />
            ) : shown.length === 0 ? (
              needle ? (
                <EmptyState
                  compact
                  icon={SearchIcon}
                  title={t('inbox_search_empty')}
                  action={<Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('inbox_search_clear')} onClick={() => setQuery('')} />}
                />
              ) : (
                <EmptyState compact icon={InboxIcon} title={t('inbox_empty')} />
              )
            ) : (
              <ul className="ibx-rows">
                {shown.map(({ contact: c, lastMessage }) => {
                  const active = String(c.id) === id
                  const time = lastMessage?.createdAt ?? c.lastInboundAt
                  return (
                    <li key={c.id}>
                      <Link to={`/inbox/${c.id}`} className={`ibx-row${active ? ' is-active' : ''}${c.unread > 0 ? ' is-unread' : ''}`} aria-current={active ? 'page' : undefined}>
                        <ContactAvatar contact={c} />
                        <span className="ibx-row__main">
                          <span className="ibx-row__top">
                            <span className="ibx-row__name">
                              <ContactName contact={c} bold={c.unread > 0} />
                            </span>
                            {time && (
                              <span className="ibx-row__time">
                                <RelativeTime value={time} />
                              </span>
                            )}
                          </span>
                          <span className="ibx-row__bottom">
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
                            <span className={`ibx-row__preview${lastMessage?.error ? ' is-failed' : ''}`}>
                              {lastMessage?.error ? `${t('inbox_failed')} · ` : ''}
                              {preview(lastMessage)}
                            </span>
                            {c.unread > 0 && <span className="ibx-dot" role="img" aria-label={t('inbox_unread')} />}
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
                    size="m"
                    leftContent={ArrowLeftIcon}
                    aria-label={t('inbox_back')}
                    onClick={() => navigate('/inbox')}
                  />
                  {contact && (
                    <span className="ibx-chat__name">
                      <Text as="h2" typo="16" bold className="ibx-chat__h">
                        <ContactName contact={contact} typo="16" bold />
                      </Text>
                      <span className="ibx-chat__badges">
                        <ChannelBadge channel={contact.channel} size="xs" />
                        {statusBadge}
                      </span>
                    </span>
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
                    {!wide && (
                      <Tooltip content={t('inbox_info')} placement="bottom-right">
                        <Button
                          size="s"
                          styleVariant="secondary"
                          colorVariant="monochrome-dark"
                          leftContent={PersonIcon}
                          aria-label={t('inbox_info')}
                          aria-haspopup="dialog"
                          aria-expanded={infoOpen}
                          onClick={() => setInfoOpen(true)}
                        />
                      </Tooltip>
                    )}
                  </div>
                )}
              </header>

              <div className="ibx-messages" ref={messagesRef}>
                {chatError !== null && <ErrorBanner error={chatError} onRetry={() => void loadConversation()} />}
                {messages === null ? (
                  chatError === null && <LoadingState compact />
                ) : thread.length === 0 ? (
                  <div className="ibx-placeholder">
                    <EmptyState compact icon={ChatBubbleIcon} title={t('inbox_no_messages')} />
                  </div>
                ) : (
                  thread
                )}
              </div>

              <form
                className="ibx-composer"
                onSubmit={(e) => {
                  e.preventDefault()
                  send()
                }}
              >
                <div className="ibx-composer__bar">
                  {snippets.length > 0 && (
                    <div className="ibx-composer__snippets">
                      <SelectInput value="" options={snippets.map((s) => ({ value: String(s.id), label: s.name }))} onChange={insertSnippet} placeholder={t('inbox_snippet')} aria-label={t('inbox_snippet')} dropdownPosition="top-left" />
                    </div>
                  )}
                  {soku?.aiConfigured && (
                    <Button
                      className="ibx-composer__tool"
                      size="xs"
                      styleVariant="tertiary"
                      colorVariant="monochrome-dark"
                      leftContent={AiIcon}
                      text={t('inbox_bot_draft').replace('{name}', soku.config.name)}
                      title={t('inbox_bot_draft').replace('{name}', soku.config.name)}
                      loading={drafting}
                      disabled={drafting}
                      onClick={() => void draft()}
                    />
                  )}
                  {soku && soku.counts.products > 0 && (
                    <Button
                      className="ibx-composer__tool"
                      size="xs"
                      styleVariant="tertiary"
                      colorVariant="monochrome-dark"
                      leftContent={ShoppingIcon}
                      text={t('inbox_send_products')}
                      aria-haspopup="dialog"
                      onClick={() => setPicking(true)}
                    />
                  )}
                  <Text typo="12" color="txt-black-dark" className="ibx-composer__hint">
                    {contact && !isPaused(contact) && <span className="ibx-composer__pause">{t('inbox_hint_pause')}</span>}
                    <span className="ibx-composer__keys">{t('inbox_hint_keys')}</span>
                  </Text>
                </div>
                <div className="ibx-composer__row">
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
                  <Button type="submit" text={t('inbox_send')} leftContent={SendIcon} disabled={!text.trim()} />
                </div>
              </form>
            </>
          )}
        </section>

        {/* ---------- user info (third pane when wide, drawer / bottom sheet otherwise) ---------- */}
        {showInfoPane && (
          <aside className="ibx-pane ibx-info" aria-labelledby="ibx-info-title">
            <div className="ibx-info__head">
              <Text as="h2" id="ibx-info-title" typo="14" bold color="txt-black-darkest">
                {t('inbox_info')}
              </Text>
            </div>
            <div className="ibx-info__scroll">{info ?? (chatError === null && <LoadingState compact />)}</div>
          </aside>
        )}
      </div>
      <ProductPicker show={picking} onHide={() => setPicking(false)} onSend={sendProducts} />
      {!wide && (
        <Drawer show={infoOpen && !!contact} onHide={() => setInfoOpen(false)} title={t('inbox_info')} width={360} sheetOnMobile>
          {info}
        </Drawer>
      )}
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
