import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, HStack, ListItem, Modal, ModalBody, ModalContent, ModalHeader, Text, TextField, VStack, useToast } from '@channel.io/bezier-react'
import { ChannelsListIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FunnelIcon, PeopleIcon, SearchIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { ConditionRule } from '@shared/flows/types'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
import {
  Card,
  ChannelBadge,
  ContactAvatar,
  ContactName,
  DataTable,
  ModalCloseButton,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  RelativeTime,
  SelectInput,
  TextInputField,
  contactDisplayName,
  formatNumber,
  type Column,
} from '../components'
import { ConfirmAction } from '../components/ConfirmAction'
import { AddButton } from './flow-editor/fields'
import { RulesEditor } from './flow-editor/RulesEditor'
import './flow-editor.css'
import './contacts.css'

type Contact = {
  id: number
  channel: string
  channelUserId?: string | null
  displayName: string | null
  username: string | null
  avatarUrl?: string | null
  fields: Record<string, string>
  tags: string[]
  lastInboundAt: string | null
  createdAt: string
  botPaused: number | boolean
  status?: 'open' | 'closed'
}

type ContactsResponse = { contacts: Contact[]; total: number; page: number; size: number }
type TagCount = { tag: string; n: number }
type Segment = { id: number; name: string; rules: ConditionRule[]; mode: 'all' | 'any' }
type SegmentForm = Omit<Segment, 'id'> & { id: number | null }

const blankSegment = (): SegmentForm => ({ id: null, name: '', rules: [{ field: 'tag', op: 'has_tag', value: '' }], mode: 'all' })

const SUMMARY_FIELDS = ['phone', 'email', 'name', 'first_name']
/** Tags shown per row before "+N". */
const VISIBLE_TAGS = 2
/** Max options in the tag filter dropdown; a search box appears above it when there are more. */
const TAG_OPTION_CAP = 200

function fieldsSummary(fields: Record<string, string>): { text: string; full: string } {
  const keys = Object.keys(fields)
  const preferred = SUMMARY_FIELDS.filter((k) => fields[k])
  const shown = preferred.length > 0 ? preferred : keys.slice(0, 2)
  const text = shown.map((k) => `${k}: ${fields[k]}`).join(' · ')
  const rest = keys.length - shown.length
  return { text: rest > 0 ? `${text} (+${rest})` : text, full: keys.map((k) => `${k}: ${fields[k]}`).join('\n') }
}

/** List + edit form for saved segments. `onChanged(deletedId?)` runs after a save or delete. */
function SegmentManager({ show, onHide, segments, onChanged }: { show: boolean; onHide: () => void; segments: Segment[]; onChanged: (deletedId?: number) => void }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const toast = useToast()
  const [form, setForm] = useState<SegmentForm>(blankSegment)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const saved = segments.find((s) => s.id === form.id)

  const edit = (f: SegmentForm) => {
    setForm(f)
    setError(null)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !form.name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const body = { name: form.name, rules: form.rules, mode: form.mode }
      const r = form.id ? await api.put<{ segment: Segment }>(`/api/segments/${form.id}`, body) : await api.post<{ segment: Segment }>('/api/segments', body)
      setForm(r.segment)
      toast.addToast(t('segments_saved'), { preset: 'success' })
      onChanged()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (s: Segment) => {
    try {
      await api.delete(`/api/segments/${s.id}`)
      toast.addToast(t('segments_deleted'), { preset: 'success' })
      edit(blankSegment())
      onChanged(s.id)
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  return (
    <>
      <Modal show={show} onHide={onHide}>
        <ModalContent width="min(760px, 100vw)">
          <ModalHeader className="modal-head" title={t('contacts_manage_segments')} />
          <ModalBody>
            <div className="ct-seg">
              <div className="ct-seg__list">
                <div>
                  <AddButton text={t('segments_new')} onClick={() => edit(blankSegment())} />
                </div>
                {segments.length === 0 ? (
                  <EmptyState compact icon={FunnelIcon} title={t('segments_empty')} />
                ) : (
                  <div className="list">
                    {segments.map((s) => (
                      <ListItem
                        key={s.id}
                        size="m"
                        active={s.id === form.id}
                        content={<span className="list-text">{s.name}</span>}
                        description={t('segments_rules_count').replace('{n}', fmt(s.rules.length))}
                        onClick={() => edit(s)}
                      />
                    ))}
                  </div>
                )}
              </div>
              <VStack as="form" spacing={16} onSubmit={save} className="ct-seg__form">
                <TextInputField label={t('segments_name')} value={form.name} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <RulesEditor value={form} t={t} onChange={(patch) => setForm({ ...form, ...patch })} />
                {error !== null && <ErrorBanner error={error} />}
                <HStack spacing={8} justify="end" wrap>
                  {saved && <Button styleVariant="secondary" colorVariant="red" leftContent={TrashIcon} text={t('delete')} onClick={() => setConfirming(true)} />}
                  <Button type="submit" text={t('save')} loading={busy} disabled={!form.name.trim()} />
                </HStack>
              </VStack>
            </div>
          </ModalBody>
          <ModalCloseButton />
        </ModalContent>
      </Modal>
      <ConfirmAction
        show={confirming && saved !== undefined}
        onHide={() => setConfirming(false)}
        onConfirm={() => {
          if (saved) void remove(saved)
        }}
        title={t('segments_delete_title')}
        description={saved ? t('segments_delete_desc').replace('{name}', saved.name) : undefined}
        confirmText={t('delete')}
      />
    </>
  )
}

export default function Contacts() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const navigate = useNavigate()
  const toast = useToast()
  // Filters and page live in the URL, so Back from a conversation returns to the same list.
  const [params, setParams] = useSearchParams()
  const debouncedQ = params.get('q') ?? ''
  const tag = params.get('tag') ?? ''
  const channel = params.get('channel') ?? ''
  const segment = params.get('segment') ?? ''
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1)
  const [q, setQ] = useState(debouncedQ)
  const [tagQuery, setTagQuery] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [managing, setManaging] = useState(false)
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null)

  /** Sets one query param (empty = removed); any filter change goes back to page 1. */
  const setParam = useCallback(
    (key: 'q' | 'tag' | 'channel' | 'segment' | 'page', value: string) =>
      setParams(
        (prev) => {
          if ((prev.get(key) ?? '') === value) return prev
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          if (key !== 'page') next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const setTag = (v: string) => setParam('tag', v)
  const setChannel = (v: string) => setParam('channel', v)
  const setSegment = (v: string) => setParam('segment', v)
  const setPage = (n: number) => setParam('page', n > 1 ? String(n) : '')

  useEffect(() => {
    const timer = setTimeout(() => setParam('q', q.trim()), 300)
    return () => clearTimeout(timer)
  }, [q, setParam])

  const loadSegments = useCallback(() => {
    api
      .get<{ segments: Segment[] }>('/api/segments')
      .then((r) => setSegments(r.segments))
      .catch(() => setSegments([]))
  }, [])

  useEffect(loadSegments, [loadSegments])

  useEffect(() => {
    api
      .get<{ tags: TagCount[] }>('/api/tags')
      .then((r) => setTags(r.tags))
      .catch((err) => setError(err))
  }, [])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (debouncedQ) params.set('q', debouncedQ)
    if (tag) params.set('tag', tag)
    if (channel) params.set('channel', channel)
    if (segment) params.set('segment', segment)
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
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debouncedQ, tag, channel, segment, page, reload])

  const remove = async (c: Contact) => {
    try {
      await api.delete(`/api/contacts/${c.id}`)
      toast.addToast(t('contacts_deleted'), { preset: 'success' })
      setReload((n) => n + 1)
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  const clearFilters = () => {
    setQ('')
    setTagQuery('')
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['q', 'tag', 'channel', 'segment', 'page']) next.delete(k)
        return next
      },
      { replace: true },
    )
  }

  const tagOptions = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase()
    const matching = needle ? tags.filter((x) => x.tag.toLowerCase().includes(needle)) : tags
    const capped = matching.slice(0, TAG_OPTION_CAP)
    // Keep the current selection visible even when the search hides it.
    if (tag && !capped.some((x) => x.tag === tag)) {
      const selected = tags.find((x) => x.tag === tag)
      if (selected) capped.unshift(selected)
    }
    return [{ value: '', label: t('contacts_all_tags') }, ...capped.map((x) => ({ value: x.tag, label: `${x.tag} (${fmt(x.n)})` }))]
  }, [tags, tagQuery, tag, t, fmt])

  const segmentOptions = [{ value: '', label: t('contacts_all_segments') }, ...segments.map((s) => ({ value: String(s.id), label: s.name }))]

  const channelOptions = [
    { value: '', label: t('contacts_all_channels') },
    { value: 'line', label: t('channel_line') },
    { value: 'messenger', label: t('channel_messenger') },
    { value: 'instagram', label: t('channel_instagram') },
  ]

  /** "タグ: vip": the chip shows only the value, so the accessible name adds what it filters. */
  const filterLabel = (what: string, options: { value: string; label: string }[], value: string) => `${what}: ${options.find((o) => o.value === value)?.label ?? value}`

  const dash = (
    <Text typo="13" color="txt-black-dark">
      —
    </Text>
  )

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: t('contacts_name'),
      render: (c) => (
        <div className="ct-name" title={c.username && c.displayName ? `${c.displayName} (@${c.username})` : undefined}>
          <ContactAvatar contact={c} size={24} />
          <ContactName contact={c} />
        </div>
      ),
    },
    {
      key: 'channel',
      header: t('editor_channel'),
      nowrap: true,
      render: (c) => (
        <span className="ct-inline">
          <ChannelBadge channel={c.channel} size="xs" />
        </span>
      ),
    },
    {
      key: 'tags',
      header: t('contacts_tags'),
      render: (c) =>
        c.tags.length === 0 ? (
          dash
        ) : (
          <div className="ct-tags">
            {c.tags.slice(0, VISIBLE_TAGS).map((x) => (
              <Badge key={x} size="s" variant="default" className="ct-tag" title={x}>
                {x}
              </Badge>
            ))}
            {c.tags.length > VISIBLE_TAGS && (
              <Badge size="s" variant="monochrome-light" className="ct-tag ct-tag--more" title={c.tags.slice(VISIBLE_TAGS).join('\n')}>
                +{fmt(c.tags.length - VISIBLE_TAGS)}
              </Badge>
            )}
          </div>
        ),
    },
    {
      key: 'fields',
      header: t('contacts_fields'),
      hideOnMobile: true,
      render: (c) => {
        const s = fieldsSummary(c.fields)
        return s.text ? (
          <span className="ct-fields" title={s.full}>
            {s.text}
          </span>
        ) : (
          dash
        )
      },
    },
    {
      key: 'last',
      header: t('contacts_last'),
      nowrap: true,
      render: (c) =>
        c.lastInboundAt ? (
          <Text typo="13" color="txt-black-darker">
            <RelativeTime value={c.lastInboundAt} />
          </Text>
        ) : (
          dash
        ),
    },
    {
      key: 'status',
      header: t('flows_status'),
      nowrap: true,
      render: (c) => (
        <span className="ct-status">
          {c.status === 'closed' ? (
            <Badge size="xs" variant="monochrome-light" icon={CheckIcon}>
              {t('inbox_closed')}
            </Badge>
          ) : (
            <Badge size="xs" variant="green">
              {t('inbox_open')}
            </Badge>
          )}
          {Boolean(c.botPaused) && (
            <Badge size="xs" variant="orange">
              {t('inbox_filter_paused')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('delete')}</span>,
      width: 48,
      render: (c) => (
        <Button
          size="s"
          styleVariant="tertiary"
          colorVariant="monochrome-light"
          leftContent={TrashIcon}
          aria-label={`${t('delete')}: ${contactDisplayName(c)}`}
          onClick={(e) => {
            e.stopPropagation()
            setPendingDelete(c)
          }}
        />
      ),
    },
  ]

  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1
  const filtered = !!(debouncedQ || tag || channel || segment)
  const empty = filtered ? (
    <EmptyState
      compact
      icon={SearchIcon}
      title={t('contacts_no_match')}
      action={<Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('contacts_clear_filters')} onClick={clearFilters} />}
    />
  ) : (
    <EmptyState
      icon={PeopleIcon}
      title={t('contacts_empty')}
      description={t('contacts_empty_desc')}
      action={<Button leftContent={ChannelsListIcon} text={t('nav_channels')} onClick={() => navigate('/channels')} />}
    />
  )

  return (
    <div className="stack">
      <PageHeader
        title={t('contacts_title')}
        description={
          data && (
            <Text typo="13" color="txt-black-dark" className="tabular">
              {t('contacts_total').replace('{n}', fmt(data.total))}
            </Text>
          )
        }
      />

      <div className="ct-toolbar">
        <div className="ct-toolbar__search">
          <TextField
            type="search"
            size="m"
            leftContent={{ icon: SearchIcon }}
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('contacts_search')}
            aria-label={t('contacts_search')}
            name="q"
            autoComplete="off"
          />
        </div>
        <div className="ct-toolbar__filters" role="group" aria-label={t('contacts_filters')}>
          <SelectInput className={channel ? 'filter-select is-set' : 'filter-select'} value={channel} options={channelOptions} onChange={setChannel} aria-label={filterLabel(t('editor_channel'), channelOptions, channel)} />
          <SelectInput className={tag ? 'filter-select is-set' : 'filter-select'} value={tag} options={tagOptions} onChange={setTag} aria-label={filterLabel(t('contacts_tags'), tagOptions, tag)} />
          {tags.length > TAG_OPTION_CAP && (
            <div className="ct-toolbar__tag-search">
              <TextField size="m" name="tag-search" autoComplete="off" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder={t('contacts_tag_filter')} aria-label={t('contacts_tag_filter')} allowClear />
              <Text typo="11" color="txt-black-dark">
                {t('contacts_tags_capped').replace('{n}', fmt(TAG_OPTION_CAP))}
              </Text>
            </div>
          )}
          <SelectInput className={segment ? 'filter-select is-set' : 'filter-select'} value={segment} options={segmentOptions} onChange={setSegment} aria-label={filterLabel(t('contacts_segments'), segmentOptions, segment)} />
        </div>
        <div className="ct-toolbar__actions">
          <Button styleVariant="secondary" colorVariant="monochrome-dark" leftContent={FunnelIcon} text={t('contacts_manage_segments')} onClick={() => setManaging(true)} />
          <Button
            as="a"
            {...{ href: '/api/contacts/export.csv', download: 'contacts.csv' }}
            className="ct-csv"
            styleVariant="secondary"
            colorVariant="monochrome-dark"
            leftContent={DownloadIcon}
            text="CSV"
            aria-label={t('contacts_export')}
            title={t('contacts_export')}
          />
        </div>
      </div>

      {error !== null && <ErrorBanner error={error} onRetry={() => setReload((n) => n + 1)} />}

      <Card flush className={loading && data ? 'ct-card is-loading' : 'ct-card'}>
        {!data ? (
          loading ? <LoadingState compact /> : empty
        ) : (
          <>
            <DataTable columns={columns} rows={data.contacts} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/inbox/${c.id}`)} caption={t('contacts_title')} empty={empty} />
            {data.total > data.size && (
              <nav className="ct-pager" aria-label={t('contacts_pages')}>
                <Button
                  size="s"
                  styleVariant="secondary"
                  colorVariant="monochrome-dark"
                  leftContent={ChevronLeftIcon}
                  aria-label={t('contacts_prev')}
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                />
                <Text typo="13" color="txt-black-darker" className="tabular" aria-live="polite">
                  {t('contacts_page').replace('{page}', fmt(page)).replace('{pages}', fmt(pages))}
                </Text>
                <Button
                  size="s"
                  styleVariant="secondary"
                  colorVariant="monochrome-dark"
                  leftContent={ChevronRightIcon}
                  aria-label={t('contacts_next')}
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                />
              </nav>
            )}
          </>
        )}
      </Card>

      <ConfirmAction
        show={pendingDelete !== null}
        onHide={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete)
        }}
        title={t('contacts_delete_title')}
        description={pendingDelete ? t('contacts_delete_desc').replace('{name}', contactDisplayName(pendingDelete)) : undefined}
        confirmText={t('delete')}
      />

      <SegmentManager
        show={managing}
        onHide={() => setManaging(false)}
        segments={segments}
        onChanged={(deletedId) => {
          loadSegments()
          if (deletedId !== undefined && String(deletedId) === segment) setSegment('')
          else setReload((n) => n + 1)
        }}
      />
    </div>
  )
}
