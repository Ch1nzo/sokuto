import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Text } from '@channel.io/bezier-react'
import { CancelIcon, FlowIcon, PlusIcon, TemplateIcon } from '@channel.io/bezier-icons'
import { api } from '../lib/api'
import { useLang, useT, type Key } from '../lib/i18n'
import {
  Card,
  ChannelBadge,
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatNumber,
  type Column,
} from '../components'
import type { FlowRecord } from '@shared/flows/types'
import type { FlowTemplate } from '@shared/flows/templates'
import './flows.css'

type FlowListItem = FlowRecord & { runs30d: number }

export default function Flows() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const fmt = formatNumber(lang)
  const [flows, setFlows] = useState<FlowListItem[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [templates, setTemplates] = useState<FlowTemplate[] | null>(null)
  const [templatesError, setTemplatesError] = useState<unknown>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  /** 'blank' or a template slug while its POST is in flight. */
  const [creating, setCreating] = useState<string | null>(null)

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
    }
  }

  const triggerLabel = (type: string) => t(`trigger_${type}` as Key)

  const columns: Column<FlowListItem>[] = [
    {
      key: 'name',
      header: t('editor_name'),
      render: (f) => (
        <Text typo="14" bold color="txt-black-darkest" className="fl-name">
          {f.name}
        </Text>
      ),
    },
    { key: 'channel', header: t('editor_channel'), nowrap: true, render: (f) => (
        <span className="fl-inline">
          <ChannelBadge channel={f.channel} />
        </span>
      ),
    },
    {
      key: 'triggers',
      header: t('editor_triggers'),
      hideOnMobile: true,
      render: (f) => (
        <Text typo="13" color="txt-black-darker">
          {f.definition.triggers.map((tr) => triggerLabel(tr.type)).join(', ') || '—'}
        </Text>
      ),
    },
    { key: 'runs', header: t('flows_runs'), numeric: true, nowrap: true, hideOnMobile: true, render: (f) => fmt(f.runs30d) },
    {
      key: 'status',
      header: t('flows_status'),
      nowrap: true,
      render: (f) => (
        <span className="fl-inline">{f.status === 'live' ? (
          <Badge size="s" variant="green">
            {t('status_live')}
          </Badge>
        ) : (
          <Badge size="s" variant="monochrome-light">
            {t('status_draft')}
          </Badge>
        )}</span>
      ),
    },
  ]

  const header = (
    <PageHeader
      title={t('flows_title')}
      actions={
        <>
          <Button
            styleVariant="secondary"
            colorVariant="monochrome-dark"
            leftContent={TemplateIcon}
            text={t('flows_from_template')}
            aria-expanded={showTemplates}
            onClick={() => setShowTemplates((s) => !s)}
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

  const picker = showTemplates && (
    <Card
      title={t('flows_templates')}
      actions={
        <Button
          size="s"
          styleVariant="tertiary"
          colorVariant="monochrome-dark"
          leftContent={CancelIcon}
          aria-label={t('close')}
          onClick={() => setShowTemplates(false)}
        />
      }
    >
      {templates ? (
        <div className="fl-templates">
          {templates.map((tp) => (
            <div className="fl-template" key={tp.slug}>
              <div className="fl-template__head">
                <Text as="h3" typo="14" bold color="txt-black-darkest" className="fl-template__name">
                  {tp.name[lang]}
                </Text>
                <span className="fl-inline">
                  <ChannelBadge channel={tp.channel} />
                </span>
              </div>
              <Text as="p" typo="13" color="txt-black-darker" className="fl-template__desc">
                {tp.description[lang]}
              </Text>
              <div>
                <Button
                  size="s"
                  text={t('create')}
                  loading={creating === tp.slug}
                  disabled={creating !== null && creating !== tp.slug}
                  onClick={() => void create(tp.slug, { template: tp.slug })}
                />
              </div>
            </div>
          ))}
        </div>
      ) : templatesError !== null ? (
        <ErrorBanner error={templatesError} onRetry={() => void loadTemplates()} />
      ) : (
        <LoadingState compact />
      )}
    </Card>
  )

  if (!flows) {
    return (
      <div className="stack">
        {header}
        {createError !== null && <ErrorBanner error={createError} />}
        {picker}
        {loadError !== null ? <ErrorBanner error={loadError} onRetry={() => void loadFlows()} /> : <LoadingState />}
      </div>
    )
  }

  return (
    <div className="stack">
      {header}
      {createError !== null && <ErrorBanner error={createError} />}
      {loadError !== null && <ErrorBanner error={loadError} onRetry={() => void loadFlows()} />}
      {picker}
      <Card flush>
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
              action={
                !showTemplates && (
                  <Button leftContent={TemplateIcon} text={t('flows_from_template')} onClick={() => setShowTemplates(true)} />
                )
              }
            />
          }
        />
      </Card>
    </div>
  )
}
