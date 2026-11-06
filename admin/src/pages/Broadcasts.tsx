import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Badge,
  Banner,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Text,
  VStack,
  useToast,
  type BadgeVariant,
} from '@channel.io/bezier-react'
import { ErrorTriangleFilledIcon, FunnelIcon, InfoFilledIcon, MegaphoneIcon, PlusIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { BroadcastButton } from '@shared/broadcasts'
import { MESSAGE_TAGS } from '@shared/channels/types'
import type { FlowRecord } from '@shared/flows/types'
import { api, errorMessage } from '../lib/api'
import { useLang, useT, type Key } from '../lib/i18n'
import {
  Card,
  ChannelBadge,
  DataTable,
  ModalCloseButton,
  Drawer,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  SelectField,
  TextAreaField,
  TextInputField,
  formatDateTime,
  formatNumber,
  type Column,
} from '../components'
import { ConfirmAction } from '../components/ConfirmAction'
import { AddButton, IconBtn } from './flow-editor/fields'
import './broadcasts.css'

type BroadcastStatus = 'scheduled' | 'running' | 'done' | 'canceled'

type Broadcast = {
  id: number
  name: string
  channel: string
  tag: string | null
  segmentId?: number | null
  text: string
  imageUrl?: string | null
  buttons?: BroadcastButton[]
  messageTag?: string | null
  clicked?: number
  status: BroadcastStatus
  total: number
  sent: number
  failed: number
  scheduledAt: string
  createdAt: string
}

type Reach = { total: number; reachable: number }
type TagCount = { tag: string; n: number }
type SegmentRef = { id: number; name: string }
type FlowRef = Pick<FlowRecord, 'id' | 'name' | 'status' | 'kind'>
type Channel = 'any' | 'line' | 'messenger' | 'instagram'
/** One button row in the form; `flowId` is the SelectField value ('' = none). */
type FormButton = { label: string; url: string; flowId: string }

const emptyForm = { name: '', channel: 'any' as Channel, tag: '', segmentId: '', text: '', imageUrl: '', scheduledAt: '', buttons: [] as FormButton[], messageTag: '' }

/** validate.ts broadcastButtonsSchema */
const MAX_BUTTONS = 3
const MAX_BUTTON_LABEL = 40

/** Soft limit: warn (do not block) above this many characters. */
const TEXT_SOFT_LIMIT = 1000

const STATUS: Record<BroadcastStatus, { key: Key; variant: BadgeVariant }> = {
  scheduled: { key: 'bc_status_scheduled', variant: 'blue' },
  running: { key: 'bc_status_running', variant: 'green' },
  done: { key: 'bc_status_done', variant: 'monochrome-light' },
  canceled: { key: 'bc_status_canceled', variant: 'monochrome-dark' },
}

/** Character count in user-perceived characters (emoji = 1). */
function charCount(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) n++
    return n
  }
  return Array.from(s).length
}

export default function Broadcasts() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const toast = useToast()
  const [form, setForm] = useState(emptyForm)
  const [broadcasts, setBroadcasts] = useState<Broadcast[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [formError, setFormError] = useState<unknown>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [segments, setSegments] = useState<SegmentRef[]>([])
  const [flows, setFlows] = useState<FlowRef[]>([])
  const [reach, setReach] = useState<Reach | null | 'error'>(null)
  const [busy, setBusy] = useState(false)
  const [pendingCancel, setPendingCancel] = useState<Broadcast | null>(null)
  const [reading, setReading] = useState<Broadcast | null>(null)
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ broadcasts: Broadcast[] }>('/api/broadcasts')
      setBroadcasts(r.broadcasts)
      setLoadError(null)
    } catch (err) {
      setLoadError(err)
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
    api
      .get<{ segments: SegmentRef[] }>('/api/segments')
      .then((r) => setSegments(r.segments))
      .catch(() => setSegments([]))
    api
      .get<{ flows: FlowRef[] }>('/api/flows')
      .then((r) => setFlows(r.flows.filter((f) => f.status === 'live' && f.kind === 'flow')))
      .catch(() => setFlows([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    setReach(null)
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ channel: form.channel })
      if (form.segmentId) params.set('segmentId', form.segmentId)
      else if (form.tag.trim()) params.set('tag', form.tag.trim())
      if (form.messageTag) params.set('messageTag', form.messageTag)
      api
        .get<Reach>(`/api/broadcasts/reach?${params.toString()}`)
        .then((r) => !cancelled && setReach(r))
        .catch(() => !cancelled && setReach('error'))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.channel, form.tag, form.segmentId, form.messageTag])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.text.trim() || busy) return
    setBusy(true)
    setFormError(null)
    try {
      let scheduledAt: string | undefined
      if (form.scheduledAt) {
        const d = new Date(form.scheduledAt)
        if (Number.isNaN(d.getTime())) throw new Error(t('bc_invalid_date'))
        scheduledAt = d.toISOString()
      }
      await api.post('/api/broadcasts', {
        name: form.name.trim(),
        channel: form.channel,
        tag: form.segmentId ? '' : form.tag.trim(),
        segmentId: form.segmentId ? Number(form.segmentId) : null,
        text: form.text,
        imageUrl: form.imageUrl.trim(),
        buttons: form.buttons.map((b) => (b.url.trim() ? { label: b.label, url: b.url.trim() } : { label: b.label, flowId: b.flowId ? Number(b.flowId) : undefined })),
        messageTag: form.messageTag || null,
        scheduledAt,
      })
      setForm(emptyForm)
      setComposing(false)
      toast.addToast(t('bc_created'), { preset: 'success' })
      await load()
    } catch (err) {
      setFormError(err)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (b: Broadcast) => {
    try {
      await api.post(`/api/broadcasts/${b.id}/cancel`)
      toast.addToast(t('bc_canceled'), { preset: 'success' })
      await load()
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  const chars = charCount(form.text)
  const tooLong = chars > TEXT_SOFT_LIMIT
  const reachText =
    reach === null ? '…' : reach === 'error' ? t('bc_reach_unknown') : `${fmt(reach.total)} / ${fmt(reach.reachable)} ${t('bc_reachable')}`

  const segmentName = (id: number) => segments.find((s) => s.id === id)?.name ?? `#${id}`
  const segmentOptions = [{ value: '', label: t('bc_segment_none') }, ...segments.map((s) => ({ value: String(s.id), label: s.name }))]
  const flowName = (id: number) => flows.find((f) => f.id === id)?.name ?? `#${id}`
  const flowOptions = [{ value: '', label: t('bc_button_none') }, ...flows.map((f) => ({ value: String(f.id), label: f.name }))]
  const messageTagOptions = [{ value: '', label: t('bc_message_tag_none') }, ...MESSAGE_TAGS.map((x) => ({ value: x, label: x }))]
  const setButton = (i: number, b: FormButton) => setForm({ ...form, buttons: form.buttons.map((x, j) => (j === i ? b : x)) })

  const channelOptions: { value: Channel; label: string }[] = [
    { value: 'any', label: t('channel_any') },
    { value: 'line', label: t('channel_line') },
    { value: 'messenger', label: t('channel_messenger') },
    { value: 'instagram', label: t('channel_instagram') },
  ]

  const columns: Column<Broadcast>[] = [
    {
      key: 'name',
      header: t('bc_name'),
      render: (b) => (
        <div className="bc-name">
          <Text typo="14" bold color="txt-black-darkest" truncated title={b.name}>
            {b.name}
          </Text>
          <button type="button" className="bc-preview" title={t('bc_show_text')} onClick={() => setReading(b)}>
            {b.text}
          </button>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('bc_status'),
      nowrap: true,
      render: (b) => {
        const s = STATUS[b.status]
        return (
          <span className="bc-inline">
            <Badge size="s" variant={s?.variant ?? 'default'}>
              {s ? t(s.key) : b.status}
            </Badge>
          </span>
        )
      },
    },
    {
      key: 'audience',
      header: t('bc_reach'),
      hideOnMobile: true,
      render: (b) => (
        <div className="bc-audience">
          <ChannelBadge channel={b.channel} />
          {b.tag && (
            <Badge size="s" variant="default" className="bc-tag" title={b.tag}>
              {b.tag}
            </Badge>
          )}
          {b.segmentId != null && (
            <Badge size="s" variant="purple" icon={FunnelIcon} className="bc-tag" title={segmentName(b.segmentId)}>
              {segmentName(b.segmentId)}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'schedule',
      header: t('bc_scheduled_at'),
      nowrap: true,
      hideOnMobile: true,
      render: (b) => (
        <Text typo="13" color="txt-black-darker" className="tabular">
          {formatDateTime(lang, b.scheduledAt)}
        </Text>
      ),
    },
    {
      key: 'sent',
      header: t('bc_col_sent'),
      numeric: true,
      nowrap: true,
      render: (b) => `${fmt(b.sent)} / ${fmt(b.total)}`,
    },
    {
      key: 'failed',
      header: t('bc_col_failed'),
      numeric: true,
      nowrap: true,
      render: (b) => <span className={b.failed > 0 ? 'bc-failed' : undefined}>{fmt(b.failed)}</span>,
    },
    {
      key: 'clicked',
      header: t('bc_col_clicked'),
      numeric: true,
      nowrap: true,
      render: (b) => (b.buttons?.length ? fmt(b.clicked ?? 0) : <span className="bc-muted">—</span>),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('bc_cancel')}</span>,
      nowrap: true,
      render: (b) =>
        b.status === 'scheduled' || b.status === 'running' ? (
          <Button size="s" styleVariant="secondary" colorVariant="red" text={t('bc_cancel')} onClick={() => setPendingCancel(b)} />
        ) : null,
    },
  ]

  const formFields = (
    <VStack as="form" id="bc-form" spacing={16} onSubmit={submit}>
      <Banner variant="blue" icon={InfoFilledIcon} content={t('bc_note')} />
      <TextInputField label={t('bc_name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoComplete="off" />
      <SelectField label={t('editor_channel')} value={form.channel} options={channelOptions} onChange={(v) => setForm({ ...form, channel: v })} />
      <SelectField label={t('bc_segment')} helperText={t('bc_segment_hint')} value={form.segmentId} options={segmentOptions} onChange={(v) => setForm({ ...form, segmentId: v })} />
      <TextInputField
        label={t('bc_tag')}
        value={form.tag}
        onChange={(e) => setForm({ ...form, tag: e.target.value })}
        disabled={!!form.segmentId}
        list="bc-tags"
        autoComplete="off"
      />
      <datalist id="bc-tags">
        {tags.slice(0, 500).map((x) => (
          <option key={x.tag} value={x.tag}>
            {x.tag} ({fmt(x.n)})
          </option>
        ))}
      </datalist>
      <TextAreaField
        label={t('bc_text')}
        value={form.text}
        onChange={(e) => setForm({ ...form, text: e.target.value })}
        minRows={6}
        maxRows={16}
        required
        helperText={
          <span className={tooLong ? 'bc-counter is-over' : 'bc-counter'}>
            <span className="tabular">{t('bc_chars').replace('{n}', `${fmt(chars)} / ${fmt(TEXT_SOFT_LIMIT)}`)}</span>
            {tooLong && <span>{t('bc_too_long')}</span>}
          </span>
        }
      />
      <VStack spacing={8}>
        <Text typo="13" bold color="txt-black-darker">
          {t('bc_buttons')} <span className="tabular">({form.buttons.length}/{MAX_BUTTONS})</span>
        </Text>
        {form.buttons.map((b, i) => (
          <div className="bc-button" key={i}>
            <TextInputField label={t('editor_button_label')} value={b.label} maxLength={MAX_BUTTON_LABEL} onChange={(e) => setButton(i, { ...b, label: e.target.value })} />
            <TextInputField label={t('editor_button_url')} type="url" value={b.url} placeholder="https://" disabled={!!b.flowId} onChange={(e) => setButton(i, { ...b, url: e.target.value })} />
            <SelectField label={t('bc_button_flow')} value={b.flowId} options={flowOptions} disabled={!!b.url.trim()} onChange={(v) => setButton(i, { ...b, flowId: v })} />
            <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${b.label || t('editor_button_label')}`} onClick={() => setForm({ ...form, buttons: form.buttons.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Text typo="12" color="txt-black-dark">
          {t('bc_buttons_hint')}
        </Text>
        <div>
          <AddButton text={t('bc_add_button')} disabled={form.buttons.length >= MAX_BUTTONS} onClick={() => setForm({ ...form, buttons: [...form.buttons, { label: '', url: '', flowId: '' }] })} />
        </div>
      </VStack>
      <TextInputField label={t('bc_image')} type="url" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://" />
      <TextInputField
        label={t('bc_schedule')}
        // Bezier TextField's type union has no datetime-local; the native input accepts it.
        {...{ type: 'datetime-local' as 'text' }}
        value={form.scheduledAt}
        onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
      />
      <SelectField label={t('bc_message_tag')} value={form.messageTag} options={messageTagOptions} onChange={(v) => setForm({ ...form, messageTag: v })} />
      {form.messageTag && <Banner variant="orange" icon={ErrorTriangleFilledIcon} content={t('bc_message_tag_warning')} />}
      {formError !== null && <ErrorBanner error={formError} />}
    </VStack>
  )

  return (
    <div className="stack">
      <PageHeader
        title={t('bc_title')}
        actions={<Button leftContent={PlusIcon} text={t('bc_new')} aria-haspopup="dialog" onClick={() => setComposing(true)} />}
      />

      <Card flush className="bc-card">
        {broadcasts === null ? (
          loadError !== null ? (
            <div className="bc-pad">
              <ErrorBanner error={loadError} onRetry={() => void load()} />
            </div>
          ) : (
            <LoadingState compact />
          )
        ) : (
          <>
            {loadError !== null && (
              <div className="bc-pad">
                <ErrorBanner error={loadError} onRetry={() => void load()} />
              </div>
            )}
            <DataTable
              columns={columns}
              rows={broadcasts}
              rowKey={(b) => b.id}
              caption={t('bc_list')}
              empty={
                <EmptyState
                  icon={MegaphoneIcon}
                  title={t('bc_empty')}
                  description={t('bc_empty_desc')}
                  action={<Button styleVariant="secondary" colorVariant="blue" leftContent={PlusIcon} text={t('bc_new')} onClick={() => setComposing(true)} />}
                />
              }
            />
          </>
        )}
      </Card>

      <Drawer
        show={composing}
        onHide={() => setComposing(false)}
        title={t('bc_new')}
        footer={
          <>
            <Text typo="13" color="txt-black-darker" className="bc-reach" aria-live="polite">
              {t('bc_reach')}: <span className="tabular">{reachText}</span>
            </Text>
            <Button type="submit" form="bc-form" text={form.scheduledAt ? t('bc_submit_schedule') : t('bc_submit_now')} loading={busy} disabled={!form.text.trim()} />
          </>
        }
      >
        {formFields}
      </Drawer>

      <ConfirmAction
        show={pendingCancel !== null}
        onHide={() => setPendingCancel(null)}
        onConfirm={() => {
          if (pendingCancel) void cancel(pendingCancel)
        }}
        title={t('bc_cancel_title')}
        description={pendingCancel ? t('bc_cancel_desc').replace('{name}', pendingCancel.name) : undefined}
        confirmText={t('bc_cancel')}
      />

      <Modal show={reading !== null} onHide={() => setReading(null)}>
        <ModalContent width="min(560px, 100vw)">
          <ModalHeader className="modal-head" title={reading?.name ?? ''} description={reading ? formatDateTime(lang, reading.scheduledAt) : undefined} />
          <ModalBody>
            {reading && (
              <div className="bc-fulltext">
                {reading.imageUrl && (
                  <a href={reading.imageUrl} target="_blank" rel="noreferrer" className="bc-fulltext__image">
                    {reading.imageUrl}
                  </a>
                )}
                <p>{reading.text}</p>
                {!!reading.buttons?.length && (
                  <div className="chips">
                    {reading.buttons.map((x, i) => (
                      <button key={i} type="button" className="chip" disabled title={x.url ?? (x.flowId != null ? flowName(x.flowId) : undefined)}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                )}
                <Text typo="12" color="txt-black-dark" className="tabular">
                  {t('bc_chars').replace('{n}', fmt(charCount(reading.text)))}
                </Text>
              </div>
            )}
          </ModalBody>
          <ModalCloseButton />
        </ModalContent>
      </Modal>
    </div>
  )
}
