import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Text, TextField, useToast } from '@channel.io/bezier-react'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, PeopleIcon, SearchIcon, TrashIcon } from '@channel.io/bezier-icons'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
import {
  Card,
  ChannelBadge,
  ContactName,
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  RelativeTime,
  SelectInput,
  contactDisplayName,
  formatNumber,
  type Column,
} from '../components'
import { ConfirmAction } from '../components/ConfirmAction'
import './contacts.css'

type Contact = {
  id: number
  channel: string
  channelUserId?: string | null
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
/** Tags shown per row before "+N". */
const VISIBLE_TAGS = 3
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

export default function Contacts() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const navigate = useNavigate()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tag, setTag] = useState('')
  const [tagQuery, setTagQuery] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null)

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
      .catch((err) => setError(err))
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
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debouncedQ, tag, channel, page, reload])

  const remove = async (c: Contact) => {
    try {
      await api.delete(`/api/contacts/${c.id}`)
      toast.addToast(t('contacts_deleted'), { preset: 'success' })
      setReload((n) => n + 1)
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
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

  const channelOptions = [
    { value: '', label: t('channel_any') },
    { value: 'line', label: t('channel_line') },
    { value: 'messenger', label: t('channel_messenger') },
    { value: 'instagram', label: t('channel_instagram') },
  ]

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: t('contacts_name'),
      render: (c) => (
        <div className="ct-name">
          <ContactName contact={c} />
          {c.username && c.displayName && (
            <Text typo="12" color="txt-black-dark" truncated title={`@${c.username}`}>
              @{c.username}
            </Text>
          )}
        </div>
      ),
    },
    { key: 'channel', header: t('editor_channel'), nowrap: true, render: (c) => (
        <span className="ct-inline">
          <ChannelBadge channel={c.channel} />
        </span>
      ) },
    {
      key: 'tags',
      header: t('contacts_tags'),
      render: (c) =>
        c.tags.length === 0 ? (
          <Text typo="13" color="txt-black-dark">
            —
          </Text>
        ) : (
          <div className="ct-tags">
            {c.tags.slice(0, VISIBLE_TAGS).map((x) => (
              <Badge key={x} size="s" variant="blue" className="ct-tag" title={x}>
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
          <Text typo="13" color="txt-black-dark">
            —
          </Text>
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
          <Text typo="13" color="txt-black-dark">
            —
          </Text>
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
          colorVariant="red"
          leftContent={TrashIcon}
          aria-label={`${t('delete')}: ${contactDisplayName(c)}`}
          onClick={(e) => {
            e.stopPropagation()
            setPendingDelete(c)
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ),
    },
  ]

  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1

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
        actions={
          <Button
            as="a"
            {...{ href: '/api/contacts/export.csv', download: 'contacts.csv' }}
            styleVariant="secondary"
            colorVariant="monochrome-dark"
            leftContent={DownloadIcon}
            text={t('contacts_export')}
          />
        }
      />

      <div className="ct-filters">
        <div className="ct-filters__search">
          <TextField
            type="search"
            size="m"
            leftContent={{ icon: SearchIcon }}
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('contacts_search')}
            aria-label={t('contacts_search')}
          />
        </div>
        <div className="ct-filters__tag">
          {tags.length > TAG_OPTION_CAP && (
            <TextField
              size="m"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder={t('contacts_tag_filter')}
              aria-label={t('contacts_tag_filter')}
              allowClear
            />
          )}
          <SelectInput value={tag} options={tagOptions} onChange={setTag} aria-label={t('contacts_tags')} />
          {tags.length > TAG_OPTION_CAP && (
            <Text typo="11" color="txt-black-dark">
              {t('contacts_tags_capped').replace('{n}', fmt(TAG_OPTION_CAP))}
            </Text>
          )}
        </div>
        <div className="ct-filters__channel">
          <SelectInput value={channel} options={channelOptions} onChange={setChannel} aria-label={t('editor_channel')} />
        </div>
      </div>

      {error !== null && <ErrorBanner error={error} onRetry={() => setReload((n) => n + 1)} />}

      <Card flush className={loading && data ? 'ct-card is-loading' : 'ct-card'}>
        {!data ? (
          loading ? (
            <LoadingState compact />
          ) : (
            <EmptyState compact icon={PeopleIcon} title={t('contacts_empty')} />
          )
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data.contacts}
              rowKey={(c) => c.id}
              onRowClick={(c) => navigate(`/inbox/${c.id}`)}
              caption={t('contacts_title')}
              empty={<EmptyState compact icon={PeopleIcon} title={t('contacts_empty')} />}
            />
            {data.total > data.size && (
              <nav className="ct-pager" aria-label={t('contacts_title')}>
                <Button
                  size="s"
                  styleVariant="secondary"
                  colorVariant="monochrome-dark"
                  leftContent={ChevronLeftIcon}
                  aria-label={t('contacts_prev')}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                />
                <Text typo="13" color="txt-black-darker" className="tabular">
                  {t('contacts_page').replace('{page}', fmt(page)).replace('{pages}', fmt(pages))}
                  {' · '}
                  {t('contacts_total').replace('{n}', fmt(data.total))}
                </Text>
                <Button
                  size="s"
                  styleVariant="secondary"
                  colorVariant="monochrome-dark"
                  leftContent={ChevronRightIcon}
                  aria-label={t('contacts_next')}
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
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
    </div>
  )
}
