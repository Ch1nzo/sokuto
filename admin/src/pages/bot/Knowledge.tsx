import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, SegmentedControl, SegmentedControlItem, Spinner, Text, TextField, Tooltip, VStack, useToast } from '@channel.io/bezier-react'
import {
  BookIcon,
  CancelIcon,
  ChatBubbleIcon,
  CheckIcon,
  CheckCircleFilledIcon,
  ErrorTriangleFilledIcon,
  ListSparkleIcon,
  PageIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import { ApiError, api, errorMessage } from '../../lib/api'
import { useLang, useT, type Key } from '../../lib/i18n'
import { Card, DataTable, Drawer, EmptyState, ErrorBanner, LoadingState, RelativeTime, RowMenu, TextAreaField, TextInputField, formatNumber, middleTruncate, type Column } from '../../components'
import { ConfirmAction } from '../../components/ConfirmAction'
import { AddButton, IconBtn } from '../flow-editor/fields'
import { BotFrame, useBot } from './shared'
import type { BotDocument, Faq } from './types'

type Tab = 'faqs' | 'documents'
type StatusFilter = 'approved' | 'suggested' | 'all'
const FILTERS: [StatusFilter, Key][] = [
  ['approved', 'bot_faq_approved'],
  ['suggested', 'bot_faq_suggested'],
  ['all', 'inbox_all'],
]
const SOURCES: Record<Faq['source'], [Key, BezierIcon]> = {
  manual: ['bot_source_manual', PencilIcon],
  conversation: ['bot_source_conversation', ChatBubbleIcon],
  document: ['bot_source_document', PageIcon],
}
const MAX_DOC_CHARS = 200_000
const MAX_VARIANTS = 10

/** Case- and width-insensitive search ("ＦＡＱ" finds "faq"). */
const normalize = (s: string) => s.normalize('NFKC').toLowerCase()

export default function Knowledge() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const toast = useToast()
  const { reload: reloadBot } = useBot()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'documents' ? 'documents' : 'faqs'
  const status: StatusFilter = (['suggested', 'all'] as const).find((s) => s === params.get('status')) ?? 'approved'
  const [faqs, setFaqs] = useState<Faq[] | null>(null)
  const [docs, setDocs] = useState<BotDocument[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  // FAQ drawer: an existing FAQ, 'new', or closed.
  const [editing, setEditing] = useState<Faq | 'new' | null>(null)
  const [faqForm, setFaqForm] = useState({ question: '', variants: [] as string[], answer: '' })
  const questionLabel = useId()
  const [faqBusy, setFaqBusy] = useState(false)
  const [faqError, setFaqError] = useState<unknown>(null)
  const [deleting, setDeleting] = useState<Faq | null>(null)
  // Document drawer + row actions.
  const [adding, setAdding] = useState(false)
  const [docForm, setDocForm] = useState({ name: '', mode: 'url' as 'url' | 'text', url: '', text: '' })
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState<unknown>(null)
  const [busyDoc, setBusyDoc] = useState<number | null>(null)
  const [deletingDoc, setDeletingDoc] = useState<BotDocument | null>(null)

  const load = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([api.get<{ faqs: Faq[] }>('/api/bot/faqs?status=all'), api.get<{ documents: BotDocument[] }>('/api/bot/documents')])
      setFaqs(f.faqs)
      setDocs(d.documents)
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setParam = (key: 'tab' | 'status', value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  /** After any change: refresh the lists and the counts the other Soku screens show. */
  const refresh = () => Promise.all([load(), reloadBot()])

  const failMessage = (err: unknown) => (err instanceof ApiError && err.code === 'ai_not_configured' ? t('bot_ov_no_ai') : errorMessage(err))

  /* ---------- FAQ actions ---------- */

  const openFaq = (f: Faq | 'new') => {
    setEditing(f)
    setFaqForm(f === 'new' ? { question: '', variants: [], answer: '' } : { question: f.question, variants: f.variants, answer: f.answer })
    setFaqError(null)
  }

  const saveFaq = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing || faqBusy) return
    setFaqBusy(true)
    setFaqError(null)
    try {
      const question = faqForm.question.trim()
      // Blank rows and repeated phrasings are dropped here rather than rejected by the API.
      const seen = new Set([question.toLowerCase()])
      const variants = faqForm.variants.map((v) => v.trim()).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
      const body = { question, variants, answer: faqForm.answer.trim() }
      if (editing === 'new') await api.post('/api/bot/faqs', body)
      else await api.put(`/api/bot/faqs/${editing.id}`, { ...body, status: 'approved' })
      toast.addToast(editing === 'new' ? t('bot_faq_added') : editing.status === 'suggested' ? t('bot_faq_approved_toast') : t('saved'), { preset: 'success' })
      setEditing(null)
      void refresh()
    } catch (err) {
      setFaqError(err)
    } finally {
      setFaqBusy(false)
    }
  }

  const approve = async (f: Faq) => {
    try {
      await api.put(`/api/bot/faqs/${f.id}`, { status: 'approved' })
      toast.addToast(t('bot_faq_approved_toast'), { preset: 'success' })
      void refresh()
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  /** Reject (a suggestion) and delete are the same call. */
  const removeFaq = async (f: Faq) => {
    try {
      await api.delete(`/api/bot/faqs/${f.id}`)
      toast.addToast(f.status === 'suggested' ? t('bot_faq_rejected') : t('bot_faq_deleted'), { preset: 'success' })
      setEditing(null)
      void refresh()
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  /* ---------- document actions ---------- */

  const docUrlInvalid = docForm.mode === 'url' && docForm.url.trim() !== '' && !/^https:\/\/\S+$/i.test(docForm.url.trim())
  const docReady = docForm.mode === 'url' ? docForm.url.trim() !== '' && !docUrlInvalid : docForm.text.trim() !== ''

  const addDoc = async (e: FormEvent) => {
    e.preventDefault()
    if (!docReady || docBusy) return
    setDocBusy(true)
    setDocError(null)
    try {
      const body = { name: docForm.name.trim() || undefined, ...(docForm.mode === 'url' ? { url: docForm.url.trim() } : { text: docForm.text }) }
      const r = await api.post<{ document: BotDocument }>('/api/bot/documents', body)
      if (r.document.status === 'failed') toast.addToast(`${t('bot_doc_fetch_failed')}: ${r.document.error ?? ''}`, { preset: 'error' })
      else toast.addToast(t('bot_doc_added'), { preset: 'success' })
      setAdding(false)
      setDocForm({ name: '', mode: docForm.mode, url: '', text: '' })
      void refresh()
    } catch (err) {
      setDocError(err)
    } finally {
      setDocBusy(false)
    }
  }

  const docAction = async (d: BotDocument, run: () => Promise<string>) => {
    setBusyDoc(d.id)
    try {
      toast.addToast(await run(), { preset: 'success' })
      void refresh()
    } catch (err) {
      toast.addToast(failMessage(err), { preset: 'error' })
    } finally {
      setBusyDoc(null)
    }
  }

  const refetchDoc = (d: BotDocument) =>
    docAction(d, async () => {
      const r = await api.post<{ document: BotDocument }>(`/api/bot/documents/${d.id}/refresh`)
      if (r.document.status === 'failed') throw new Error(`${t('bot_doc_fetch_failed')}: ${r.document.error ?? ''}`)
      return t('bot_doc_refreshed')
    })

  const generateFaqs = (d: BotDocument) =>
    docAction(d, async () => {
      const r = await api.post<{ created: number }>(`/api/bot/documents/${d.id}/faqs`)
      return t('bot_doc_faqs_created').replace('{n}', fmt(r.created))
    })

  const removeDoc = (d: BotDocument) =>
    docAction(d, async () => {
      await api.delete(`/api/bot/documents/${d.id}`)
      return t('bot_doc_deleted')
    })

  /* ---------- render ---------- */

  const counts = {
    approved: faqs?.filter((f) => f.status === 'approved').length ?? 0,
    suggested: faqs?.filter((f) => f.status === 'suggested').length ?? 0,
    all: faqs?.length ?? 0,
  }
  const needle = normalize(query.trim())
  const shownFaqs = (faqs ?? []).filter((f) => (status === 'all' || f.status === status) && (!needle || normalize([f.question, ...f.variants, f.answer].join('\n')).includes(needle)))

  const faqColumns: Column<Faq>[] = [
    {
      key: 'qa',
      header: `${t('bot_col_question')} / ${t('bot_col_answer')}`,
      render: (f) => (
        <span className="bot-faq">
          <span className="bot-clamp2 bot-faq__q" title={f.question}>
            {f.question}
          </span>
          {f.variants.length > 0 && (
            <Text typo="12" color="txt-black-dark">
              {t('bot_faq_variants_count').replace('{n}', fmt(f.variants.length))}
            </Text>
          )}
          <span className="bot-trunc bot-faq__a" title={f.answer}>
            {f.answer}
          </span>
        </span>
      ),
    },
    {
      key: 'source',
      header: t('bot_col_source'),
      nowrap: true,
      hideOnMobile: true,
      render: (f) => {
        const [label, icon] = SOURCES[f.source] ?? SOURCES.manual
        return (
          <Badge className="bot-badge" size="s" variant="monochrome-light" icon={icon}>
            {t(label)}
          </Badge>
        )
      },
    },
    { key: 'uses', header: t('bot_col_uses'), numeric: true, nowrap: true, render: (f) => fmt(f.uses) },
    { key: 'updated', header: t('bot_col_updated'), nowrap: true, hideOnMobile: true, render: (f) => <RelativeTime value={f.updatedAt} /> },
  ]
  if (status !== 'approved') {
    faqColumns.push({
      key: 'review',
      header: <span className="visually-hidden">{t('bot_review')}</span>,
      nowrap: true,
      render: (f) =>
        f.status === 'suggested' && (
          <span className="bot-review" onClick={(e) => e.stopPropagation()}>
            <Button size="xs" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={CheckIcon} text={t('bot_approve')} aria-label={`${t('bot_approve')}: ${f.question.slice(0, 80)}`} onClick={() => void approve(f)} />
            <Button size="xs" styleVariant="tertiary" colorVariant="monochrome-dark" leftContent={CancelIcon} text={t('bot_reject')} aria-label={`${t('bot_reject')}: ${f.question.slice(0, 80)}`} onClick={() => void removeFaq(f)} />
          </span>
        ),
    })
  }

  const docColumns: Column<BotDocument>[] = [
    {
      key: 'name',
      header: `${t('bot_col_name')} / URL`,
      render: (d) => (
        <span className="bot-doc">
          <span className="bot-clamp2 bot-doc__name" title={d.name}>
            {d.name}
          </span>
          {d.url ? (
            <a className="bot-url" href={d.url} target="_blank" rel="noreferrer" title={d.url} onClick={(e) => e.stopPropagation()}>
              {middleTruncate(d.url, 24, 12)}
            </a>
          ) : (
            <Text typo="12" color="txt-black-dark">
              {t('bot_doc_pasted')}
            </Text>
          )}
          {d.status === 'failed' && d.error && (
            <span className="bot-clamp2 bot-doc__error" title={d.error}>
              {d.error}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('flows_status'),
      nowrap: true,
      render: (d) =>
        d.status === 'ready' ? (
          <Badge className="bot-badge" size="s" variant="green" icon={CheckCircleFilledIcon}>
            {t('bot_doc_ready')}
          </Badge>
        ) : (
          <Tooltip content={d.error ?? ''} placement="top-center" allowHover>
            <Badge className="bot-badge" size="s" variant="red" icon={ErrorTriangleFilledIcon}>
              {t('bot_doc_failed')}
            </Badge>
          </Tooltip>
        ),
    },
    { key: 'chars', header: t('bot_col_chars'), numeric: true, nowrap: true, hideOnMobile: true, render: (d) => fmt(d.chars) },
    { key: 'fetched', header: t('bot_col_fetched'), nowrap: true, hideOnMobile: true, render: (d) => <RelativeTime value={d.fetchedAt ?? d.createdAt} /> },
    {
      key: 'menu',
      header: <span className="visually-hidden">{t('flows_menu')}</span>,
      width: 56,
      render: (d) => (
        <span className="bot-menu">
          {busyDoc === d.id && <Spinner size="xs" />}
          <RowMenu
            label={`${t('flows_menu')}: ${d.name}`}
            disabled={busyDoc !== null}
            items={[
              ...(d.url ? [{ label: t('bot_doc_refetch'), icon: RefreshIcon, onSelect: () => void refetchDoc(d) }] : []),
              { label: t('bot_doc_generate'), icon: ListSparkleIcon, onSelect: () => void generateFaqs(d) },
              { label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setDeletingDoc(d) },
            ]}
          />
        </span>
      ),
    },
  ]

  const tabs = (
    <SegmentedControl type="radiogroup" size="m" width={280} value={tab} onValueChange={(v: Tab) => setParam('tab', v === 'documents' ? 'documents' : '')} aria-label={t('bot_nav_knowledge')}>
      <SegmentedControlItem value="faqs">FAQ</SegmentedControlItem>
      <SegmentedControlItem value="documents">{t('bot_documents')}</SegmentedControlItem>
    </SegmentedControl>
  )

  const faqEmpty =
    counts.all === 0 ? (
      <EmptyState icon={BookIcon} title={t('bot_faq_empty')} description={t('bot_faq_empty_desc')} action={<Button leftContent={PlusIcon} text={t('bot_faq_add')} onClick={() => openFaq('new')} />} />
    ) : needle ? (
      <EmptyState compact icon={SearchIcon} title={t('bot_faq_no_match')} action={<Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('inbox_search_clear')} onClick={() => setQuery('')} />} />
    ) : (
      <EmptyState compact icon={BookIcon} title={status === 'suggested' ? t('bot_faq_no_suggested') : t('bot_faq_no_approved')} />
    )

  const editingFaq = editing !== null && editing !== 'new' ? editing : null

  return (
    <BotFrame
      section="knowledge"
      actions={
        tab === 'faqs' ? (
          <Button leftContent={PlusIcon} text={t('bot_faq_add')} onClick={() => openFaq('new')} />
        ) : (
          <Button leftContent={PlusIcon} text={t('bot_doc_add')} onClick={() => setAdding(true)} />
        )
      }
    >
      <div className="stack">
        <div className="bot-tabs">{tabs}</div>
        {error !== null && <ErrorBanner error={error} onRetry={() => void load()} />}

        {tab === 'faqs' ? (
          <>
            <div className="bot-toolbar">
              <div className="filter-chips" role="group" aria-label={t('bot_faq_filter')}>
                {FILTERS.map(([value, label]) => (
                  <button key={value} type="button" className="filter-chip" aria-pressed={value === status} onClick={() => setParam('status', value === 'approved' ? '' : value)}>
                    {t(label)}
                    {faqs && counts[value] > 0 && <span className="filter-chip__count">{fmt(counts[value])}</span>}
                  </button>
                ))}
              </div>
              <div className="bot-toolbar__search">
                <TextField
                  type="search"
                  size="m"
                  leftContent={{ icon: SearchIcon }}
                  allowClear
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('bot_faq_search')}
                  aria-label={t('bot_faq_search')}
                  name="q"
                  autoComplete="off"
                />
              </div>
            </div>
            <Card flush className="bot-table">
              {faqs === null ? (
                error === null && <LoadingState compact />
              ) : (
                <DataTable columns={faqColumns} rows={shownFaqs} rowKey={(f) => f.id} onRowClick={openFaq} caption="FAQ" empty={faqEmpty} />
              )}
            </Card>
          </>
        ) : (
          <>
            <Text as="p" typo="13" color="txt-black-dark">
              {t('bot_doc_lead')}
            </Text>
            <Card flush className="bot-table">
              {docs === null ? (
                error === null && <LoadingState compact />
              ) : (
                <DataTable
                  columns={docColumns}
                  rows={docs}
                  rowKey={(d) => d.id}
                  caption={t('bot_documents')}
                  empty={<EmptyState icon={PageIcon} title={t('bot_doc_empty')} description={t('bot_doc_empty_desc')} action={<Button leftContent={PlusIcon} text={t('bot_doc_add')} onClick={() => setAdding(true)} />} />}
                />
              )}
            </Card>
          </>
        )}
      </div>

      <Drawer
        show={editing !== null}
        onHide={() => setEditing(null)}
        title={editing === 'new' ? t('bot_faq_add') : editingFaq?.status === 'suggested' ? t('bot_faq_review_title') : t('bot_faq_edit')}
        width={520}
        footer={
          <>
            {editingFaq ? <Button styleVariant="secondary" colorVariant="red" leftContent={TrashIcon} text={editingFaq.status === 'suggested' ? t('bot_reject') : t('delete')} onClick={() => (editingFaq.status === 'suggested' ? void removeFaq(editingFaq) : setDeleting(editingFaq))} /> : <span />}
            <Button
              type="submit"
              form="bot-faq-form"
              text={editingFaq?.status === 'suggested' ? t('bot_faq_approve_save') : t('save')}
              loading={faqBusy}
              disabled={!faqForm.question.trim() || !faqForm.answer.trim()}
            />
          </>
        }
      >
        <VStack as="form" id="bot-faq-form" spacing={16} onSubmit={saveFaq}>
          <div className="bot-field" role="group" aria-labelledby={questionLabel}>
            <Text as="div" id={questionLabel} typo="13" bold color="txt-black-darker">
              {t('bot_col_question')}
            </Text>
            <Text as="p" typo="12" color="txt-black-dark">
              {t('bot_faq_variants_help')}
            </Text>
            <TextField size="m" value={faqForm.question} maxLength={500} required aria-label={t('bot_col_question')} onChange={(e) => setFaqForm({ ...faqForm, question: e.target.value })} />
            {faqForm.variants.map((v, i) => (
              <div key={i} className="bot-line">
                <TextField
                  size="m"
                  value={v}
                  maxLength={500}
                  aria-label={`${t('bot_faq_variant')} ${i + 1}`}
                  onChange={(e) => setFaqForm({ ...faqForm, variants: faqForm.variants.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                <IconBtn
                  icon={TrashIcon}
                  danger
                  label={`${t('delete')}: ${t('bot_faq_variant')} ${i + 1}`}
                  onClick={() => setFaqForm({ ...faqForm, variants: faqForm.variants.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            <div className="bot-line__foot">
              <AddButton text={t('bot_faq_add_variant')} disabled={faqForm.variants.length >= MAX_VARIANTS} onClick={() => setFaqForm({ ...faqForm, variants: [...faqForm.variants, ''] })} />
              <Text typo="12" color="txt-black-dark" className="tabular">
                {`${fmt(faqForm.variants.length)} / ${fmt(MAX_VARIANTS)}`}
              </Text>
            </div>
          </div>
          <TextAreaField
            label={t('bot_col_answer')}
            value={faqForm.answer}
            maxLength={4000}
            minRows={6}
            maxRows={16}
            required
            helperText={`${fmt(faqForm.answer.length)} / ${fmt(4000)}`}
            onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })}
          />
          {editingFaq && (
            <Text as="p" typo="12" color="txt-black-dark">
              {t(SOURCES[editingFaq.source]?.[0] ?? 'bot_source_manual')} · {t('bot_col_uses')} {fmt(editingFaq.uses)}
            </Text>
          )}
          {faqError !== null && <ErrorBanner error={faqError} />}
        </VStack>
      </Drawer>

      <Drawer
        show={adding}
        onHide={() => setAdding(false)}
        title={t('bot_doc_add')}
        width={520}
        footer={
          <>
            <span />
            <Button type="submit" form="bot-doc-form" leftContent={PlusIcon} text={t('bot_doc_add_submit')} loading={docBusy} disabled={!docReady} />
          </>
        }
      >
        <VStack as="form" id="bot-doc-form" spacing={16} onSubmit={addDoc}>
          <TextInputField label={t('bot_doc_name')} helperText={t('bot_doc_name_help')} value={docForm.name} maxLength={120} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })} />
          <SegmentedControl type="radiogroup" size="m" width="100%" value={docForm.mode} onValueChange={(v: 'url' | 'text') => setDocForm({ ...docForm, mode: v })} aria-label={t('bot_doc_source')}>
            <SegmentedControlItem value="url">URL</SegmentedControlItem>
            <SegmentedControlItem value="text">{t('bot_doc_paste')}</SegmentedControlItem>
          </SegmentedControl>
          {docForm.mode === 'url' ? (
            <TextInputField
              label="URL"
              type="url"
              inputMode="url"
              placeholder="https://"
              autoComplete="off"
              required
              value={docForm.url}
              error={docUrlInvalid ? t('bot_doc_https_only') : undefined}
              helperText={t('bot_doc_url_help')}
              onChange={(e) => setDocForm({ ...docForm, url: e.target.value })}
            />
          ) : (
            <TextAreaField
              label={t('bot_doc_text')}
              value={docForm.text}
              maxLength={MAX_DOC_CHARS}
              minRows={10}
              maxRows={24}
              required
              helperText={t('bot_chars_of').replace('{n}', fmt(docForm.text.length)).replace('{max}', fmt(MAX_DOC_CHARS))}
              onChange={(e) => setDocForm({ ...docForm, text: e.target.value })}
            />
          )}
          {docError !== null && <ErrorBanner error={docError} />}
        </VStack>
      </Drawer>

      <ConfirmAction
        show={deleting !== null}
        onHide={() => setDeleting(null)}
        onConfirm={() => deleting && void removeFaq(deleting)}
        title={t('bot_faq_delete_title')}
        description={deleting?.question}
        confirmText={t('delete')}
      />
      <ConfirmAction
        show={deletingDoc !== null}
        onHide={() => setDeletingDoc(null)}
        onConfirm={() => deletingDoc && void removeDoc(deletingDoc)}
        title={t('bot_doc_delete_title')}
        description={deletingDoc ? t('bot_doc_delete_desc').replace('{name}', deletingDoc.name) : undefined}
        confirmText={t('delete')}
      />
    </BotFrame>
  )
}
