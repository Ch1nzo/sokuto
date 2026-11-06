import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, ListItem, Modal, ModalBody, ModalContent, ModalHeader, Overlay, Switch, Text, useToast } from '@channel.io/bezier-react'
import { CalendarIcon, FlowIcon, MoreIcon, PlusIcon, TemplateIcon, TrashIcon } from '@channel.io/bezier-icons'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
import {
  Card,
  ChannelBadge,
  DataTable,
  ModalCloseButton,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  RelativeTime,
  formatNumber,
  type Column,
} from '../components'
import { ConfirmAction } from '../components/ConfirmAction'
import { triggerSummary } from './flow-editor/model'
import type { FlowRecord } from '@shared/flows/types'
import type { FlowTemplate } from '@shared/flows/templates'
import './flows.css'

type FlowListItem = FlowRecord & { runs30d: number }

/** "…" button with a small menu (role="menu"); clicks inside never reach the table row. */
function RowMenu({ label, onDelete }: { label: string; onDelete: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <span className="fl-menu" onClick={(e) => e.stopPropagation()}>
      <Button
        ref={buttonRef}
        size="s"
        styleVariant="tertiary"
        colorVariant="monochrome-light"
        leftContent={MoreIcon}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Overlay show={open} target={buttonRef.current} position="bottom-right" marginY={4} onHide={close}>
        {/* The Overlay mounts this after `show`: focus the first item once it exists. */}
        <div ref={(el) => { if (open) el?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }} role="menu" aria-label={label} className="fl-menu__list">
          <ListItem
            role="menuitem"
            size="m"
            variant="red"
            leftContent={TrashIcon}
            content={t('delete')}
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          />
        </div>
      </Overlay>
    </span>
  )
}

export default function Flows() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const toast = useToast()
  const fmt = formatNumber(lang)
  const [flows, setFlows] = useState<FlowListItem[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [templates, setTemplates] = useState<FlowTemplate[] | null>(null)
  const [templatesError, setTemplatesError] = useState<unknown>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  /** 'blank', 'sequence' or a template slug while its POST is in flight. */
  const [creating, setCreating] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FlowListItem | null>(null)

  const loadFlows = useCallback(async () => {
    try {
      const r = await api.get<{ flows: FlowListItem[] }>('/api/flows')
      setFlows(r.flows)
      setLoadError(null)
    } catch (err) {
      setLoadError(err)
    }
  }, [])

  const loadTemplates = useCallback(async () => {
    try {
      const r = await api.get<{ templates: FlowTemplate[] }>('/api/templates')
      setTemplates(r.templates)
      setTemplatesError(null)
    } catch (err) {
      setTemplatesError(err)
    }
  }, [])

  useEffect(() => {
    void loadFlows()
    void loadTemplates()
  }, [loadFlows, loadTemplates])

  const create = async (id: string, body: Record<string, unknown>) => {
    setCreateError(null)
    setCreating(id)
    try {
      const r = await api.post<{ flow: FlowRecord }>('/api/flows', body)
      navigate(`/flows/${r.flow.id}`)
    } catch (err) {
      setCreateError(err)
      setCreating(null)
      setShowTemplates(false)
    }
  }

  /** Optimistic publish / unpublish: the switch moves at once and moves back if the server refuses. */
  const setLive = async (f: FlowListItem, live: boolean) => {
    const status = live ? 'live' : 'draft'
    setFlows((fs) => fs?.map((x) => (x.id === f.id ? { ...x, status } : x)) ?? fs)
    try {
      await api.post(`/api/flows/${f.id}/${live ? 'publish' : 'unpublish'}`)
      toast.addToast(live ? t('flows_published') : t('flows_unpublished'), { preset: live ? 'success' : 'default' })
    } catch (err) {
      setFlows((fs) => fs?.map((x) => (x.id === f.id ? { ...x, status: f.status } : x)) ?? fs)
      toast.addToast(`${live ? t('flows_publish_failed') : t('flows_unpublish_failed')}\n${errorMessage(err)}`, { preset: 'error' })
    }
  }

  const remove = async (f: FlowListItem) => {
    try {
      await api.delete(`/api/flows/${f.id}`)
      setFlows((fs) => fs?.filter((x) => x.id !== f.id) ?? fs)
      toast.addToast(t('flows_deleted'), { preset: 'success' })
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  const triggers = (f: FlowListItem) =>
    f.kind === 'sequence' ? t('flows_trigger_sequence') : f.definition.triggers.map((tr) => triggerSummary(tr, t)).join(' / ') || '—'

  const columns: Column<FlowListItem>[] = [
    {
      key: 'name',
      header: t('editor_name'),
      render: (f) => (
        <div className="fl-name">
          <Text typo="14" bold color="txt-black-darkest" truncated title={f.name} className="fl-name__text">
            {f.name}
          </Text>
          {f.kind === 'sequence' && (
            <Badge size="xs" variant="purple" icon={CalendarIcon} className="fl-name__kind">
              {t('flows_kind_sequence')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('flows_status'),
      nowrap: true,
      render: (f) => (
        // The switch toggles publishing; clicking it must not open the editor.
        <label className="fl-live" onClick={(e) => e.stopPropagation()}>
          <Switch size="s" checked={f.status === 'live'} onCheckedChange={(v) => void setLive(f, v)} aria-label={`${t('editor_publish')}: ${f.name}`} />
          <Text typo="13" color={f.status === 'live' ? 'bgtxt-green-dark' : 'txt-black-dark'}>
            {f.status === 'live' ? t('status_live') : t('status_draft')}
          </Text>
        </label>
      ),
    },
    {
      key: 'triggers',
      header: t('flows_triggers'),
      hideOnMobile: true,
      render: (f) => (
        <Text typo="13" color="txt-black-darker" truncated title={triggers(f)} className="fl-triggers">
          {triggers(f)}
        </Text>
      ),
    },
    {
      key: 'channel',
      header: t('editor_channel'),
      nowrap: true,
      render: (f) => (
        <span className="fl-inline">
          <ChannelBadge channel={f.channel} size="xs" />
        </span>
      ),
    },
    { key: 'runs', header: t('flows_runs'), numeric: true, nowrap: true, hideOnMobile: true, render: (f) => fmt(f.runs30d) },
    {
      key: 'updated',
      header: t('flows_updated'),
      nowrap: true,
      hideOnMobile: true,
      render: (f) => (
        <Text typo="13" color="txt-black-darker">
          <RelativeTime value={f.updatedAt} />
        </Text>
      ),
    },
    {
      key: 'menu',
      header: <span className="visually-hidden">{t('flows_menu')}</span>,
      width: 48,
      render: (f) => <RowMenu label={`${t('flows_menu')}: ${f.name}`} onDelete={() => setPendingDelete(f)} />,
    },
  ]

  const header = (
    <PageHeader
      title={t('flows_title')}
      description={
        flows &&
        flows.length > 0 && (
          <Text typo="13" color="txt-black-dark" className="tabular">
            {t('contacts_total').replace('{n}', fmt(flows.length))}
          </Text>
        )
      }
      actions={
        <>
          <Button
            styleVariant="secondary"
            colorVariant="monochrome-dark"
            leftContent={TemplateIcon}
            text={t('flows_from_template')}
            aria-haspopup="dialog"
            onClick={() => setShowTemplates(true)}
          />
          <Button
            styleVariant="secondary"
            colorVariant="monochrome-dark"
            leftContent={CalendarIcon}
            text={t('flows_new_sequence')}
            loading={creating === 'sequence'}
            disabled={creating !== null && creating !== 'sequence'}
            onClick={() => void create('sequence', { name: t('flows_blank_sequence'), kind: 'sequence' })}
          />
          <Button
            leftContent={PlusIcon}
            text={t('flows_new')}
            loading={creating === 'blank'}
            disabled={creating !== null && creating !== 'blank'}
            onClick={() => void create('blank', { name: t('flows_blank') })}
          />
        </>
      }
    />
  )

  const templatesModal = (
    <Modal show={showTemplates} onHide={() => setShowTemplates(false)}>
      <ModalContent width="min(880px, 100vw)">
        <ModalHeader className="modal-head" title={t('flows_templates')} description={t('flows_templates_desc')} />
        <ModalBody>
          {templates ? (
            <ul className="fl-templates">
              {templates.map((tp) => (
                <li className="fl-template" key={tp.slug}>
                  <div className="fl-template__head">
                    <Text as="h3" typo="14" bold color="txt-black-darkest" className="fl-template__name">
                      {tp.name[lang]}
                    </Text>
                    <span className="fl-inline">
                      <ChannelBadge channel={tp.channel} size="xs" />
                    </span>
                  </div>
                  <Text as="p" typo="13" color="txt-black-darker" className="fl-template__desc">
                    {tp.description[lang]}
                  </Text>
                  <div className="fl-template__foot">
                    <Button
                      size="s"
                      styleVariant="secondary"
                      colorVariant="blue"
                      text={t('flows_use_template')}
                      aria-label={`${t('flows_use_template')}: ${tp.name[lang]}`}
                      loading={creating === tp.slug}
                      disabled={creating !== null && creating !== tp.slug}
                      onClick={() => void create(tp.slug, { template: tp.slug })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : templatesError !== null ? (
            <ErrorBanner error={templatesError} onRetry={() => void loadTemplates()} />
          ) : (
            <LoadingState compact />
          )}
        </ModalBody>
        <ModalCloseButton />
      </ModalContent>
    </Modal>
  )

  return (
    <div className="stack">
      {header}
      {createError !== null && <ErrorBanner error={createError} />}
      {loadError !== null && <ErrorBanner error={loadError} onRetry={() => void loadFlows()} />}
      {flows ? (
        <Card flush className="fl-card">
          <DataTable
            columns={columns}
            rows={flows}
            rowKey={(f) => f.id}
            onRowClick={(f) => navigate(`/flows/${f.id}`)}
            caption={t('flows_title')}
            empty={
              <EmptyState
                icon={FlowIcon}
                title={t('flows_empty')}
                action={<Button styleVariant="secondary" colorVariant="blue" leftContent={TemplateIcon} text={t('flows_from_template')} onClick={() => setShowTemplates(true)} />}
              />
            }
          />
        </Card>
      ) : (
        loadError === null && <LoadingState />
      )}
      {templatesModal}
      <ConfirmAction
        show={pendingDelete !== null}
        onHide={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete)
        }}
        title={t('flows_delete_title')}
        description={pendingDelete ? t('flows_delete_desc').replace('{name}', pendingDelete.name) : undefined}
        confirmText={t('delete')}
      />
    </div>
  )
}
