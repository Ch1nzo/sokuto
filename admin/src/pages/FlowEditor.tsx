import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  ConfirmModal,
  ConfirmModalClose,
  ConfirmModalContent,
  ConfirmModalFooter,
  ConfirmModalHeader,
  Text,
  TextField,
  VStack,
  useToast,
} from '@channel.io/bezier-react'
import { ErrorTriangleIcon, FlowIcon, InfoIcon, PlayIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { FlowDefinition, FlowRecord, Step, Trigger } from '@shared/flows/types'
import { api } from '../lib/api'
import { useT, type Key } from '../lib/i18n'
import { Card, EmptyState, ErrorBanner, LoadingState, PageHeader, SelectInput } from '../components'
import { formatFlowError } from './flow-editor/errors'
import { AddButton, StepPicker } from './flow-editor/fields'
import { clearRefs, defaultStep, FLOW_CHANNELS, newStepId, SEQUENCE_STEP_TYPES, STEP_TYPES, type FlowChannel, type StepType } from './flow-editor/model'
import { StepCard } from './flow-editor/StepCard'
import { TestPanel } from './flow-editor/TestPanel'
import { TriggerList } from './flow-editor/TriggerCard'
import './flow-editor.css'

const MOBILE_QUERY = '(max-width: 860px)'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export default function FlowEditor() {
  const t = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const { id = '' } = useParams<{ id: string }>()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [flow, setFlow] = useState<FlowRecord | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<FlowChannel>('any')
  const [def, setDef] = useState<FlowDefinition>({ triggers: [], entry: null, steps: [] })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [allFlows, setAllFlows] = useState<FlowRecord[]>([])
  const [newStepType, setNewStepType] = useState<StepType>('message')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testOpen, setTestOpen] = useState(false)

  useEffect(() => {
    setFlow(null)
    setLoadError(null)
    api
      .get<{ flow: FlowRecord }>(`/api/flows/${id}`)
      .then((r) => {
        setFlow(r.flow)
        setName(r.flow.name)
        setChannel(r.flow.channel)
        setDef(r.flow.definition)
        setDirty(false)
      })
      .catch((err: unknown) => setLoadError(err))
    api
      .get<{ flows: FlowRecord[] }>('/api/flows')
      .then((r) => setAllFlows(r.flows))
      .catch(() => setAllFlows([]))
  }, [id, reloadKey])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Mobile bottom sheet: close it when leaving mobile; lock page scroll and close on Escape while open.
  const sheetOpen = isMobile && testOpen
  useEffect(() => {
    if (!sheetOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTestOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [sheetOpen])

  const touch = () => setDirty(true)
  const updateDef = (fn: (d: FlowDefinition) => FlowDefinition) => {
    setDef(fn)
    touch()
  }

  /* triggers */
  const updateTriggers = (fn: (ts: Trigger[]) => Trigger[]) => updateDef((d) => ({ ...d, triggers: fn(d.triggers) }))

  /* steps */
  const setStep = (i: number, s: Step) => updateDef((d) => ({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) }))
  const addStep = () =>
    updateDef((d) => {
      const step = defaultStep(newStepType, newStepId(d.steps, newStepType))
      return { ...d, steps: [...d.steps, step], entry: d.entry ?? step.id }
    })
  const removeStep = (i: number) =>
    updateDef((d) => {
      const removed = d.steps[i]
      if (!removed) return d
      return {
        ...d,
        entry: d.entry === removed.id ? null : d.entry,
        steps: d.steps.filter((_, j) => j !== i).map((s) => clearRefs(s, removed.id)),
      }
    })
  const moveStep = (i: number, delta: -1 | 1) =>
    updateDef((d) => {
      const j = i + delta
      if (j < 0 || j >= d.steps.length) return d
      const steps = [...d.steps]
      const a = steps[i]
      const b = steps[j]
      if (!a || !b) return d
      steps[i] = b
      steps[j] = a
      return { ...d, steps }
    })

  /* server actions */
  const save = async (): Promise<boolean> => {
    setError('')
    setWarnings([])
    setBusy(true)
    try {
      const r = await api.put<{ flow: FlowRecord; warnings: string[] }>(`/api/flows/${id}`, { name, channel, definition: def })
      setFlow(r.flow)
      setDef(r.flow.definition)
      setName(r.flow.name)
      setDirty(false)
      setWarnings(r.warnings ?? [])
      toast.addToast(t('saved'), { preset: 'success' })
      return true
    } catch (err) {
      setError(formatFlowError(err, t))
      return false
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (dirty && !(await save())) return
    setError('')
    setBusy(true)
    try {
      const r = await api.post<{ ok: boolean; warnings?: string[] }>(`/api/flows/${id}/publish`)
      setFlow((f) => (f ? { ...f, status: 'live' } : f))
      setWarnings(r.warnings ?? [])
      toast.addToast(t('status_live'), { preset: 'success' })
    } catch (err) {
      setError(formatFlowError(err, t))
    } finally {
      setBusy(false)
    }
  }

  const unpublish = async () => {
    setError('')
    setBusy(true)
    try {
      await api.post(`/api/flows/${id}/unpublish`)
      setFlow((f) => (f ? { ...f, status: 'draft' } : f))
      toast.addToast(t('status_draft'), { preset: 'default' })
    } catch (err) {
      setError(formatFlowError(err, t))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirmDelete(false)
    setError('')
    setBusy(true)
    try {
      await api.delete(`/api/flows/${id}`)
      setDirty(false)
      navigate('/flows')
    } catch (err) {
      setError(formatFlowError(err, t))
      setBusy(false)
    }
  }

  if (!flow) {
    return loadError ? (
      <div className="stack">
        <PageHeader title={t('nav_flows')} />
        <ErrorBanner error={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    ) : (
      <LoadingState />
    )
  }

  const live = flow.status === 'live'
  const isSequence = flow.kind === 'sequence'
  const stepTypes = isSequence ? SEQUENCE_STEP_TYPES : STEP_TYPES

  return (
    <div className="stack fe-page">
      <PageHeader
        title={
          <TextField
            className="fe-name"
            size="l"
            value={name}
            aria-label={t('editor_name')}
            placeholder={flow.name}
            onChange={(e) => {
              setName(e.target.value)
              touch()
            }}
          />
        }
        description={
          <div className="fe-header-meta">
            <Badge size="m" variant={live ? 'green' : 'monochrome-light'}>
              {live ? t('status_live') : t('status_draft')}
            </Badge>
            {isSequence && (
              <Badge size="m" variant="purple">
                {t('flows_kind_sequence')}
              </Badge>
            )}
            <div className="fe-channel">
              <Text typo="13" color="txt-black-darker">
                {t('editor_channel')}
              </Text>
              <div className="fe-channel__select">
                <SelectInput
                  aria-label={t('editor_channel')}
                  value={channel}
                  options={FLOW_CHANNELS.map((c) => ({ value: c, label: t(`channel_${c}` as Key) }))}
                  onChange={(c) => {
                    setChannel(c)
                    touch()
                  }}
                />
              </div>
            </div>
            {dirty && (
              <Badge size="m" variant="orange" role="status">
                {t('editor_unsaved')}
              </Badge>
            )}
          </div>
        }
        actions={
          <ButtonGroup className="fe-actions">
            <Button text={t('save')} loading={busy && dirty} disabled={busy || !dirty} onClick={() => void save()} />
            <Button
              className="fe-test-toggle"
              styleVariant="secondary"
              colorVariant="monochrome-dark"
              leftContent={PlayIcon}
              text={t('editor_test')}
              aria-expanded={sheetOpen}
              aria-controls="fe-test-sheet"
              onClick={() => setTestOpen((o) => !o)}
            />
            {live ? (
              <Button styleVariant="secondary" colorVariant="monochrome-dark" text={t('editor_unpublish')} disabled={busy} onClick={() => void unpublish()} />
            ) : (
              <Button styleVariant="secondary" colorVariant="green" text={t('editor_publish')} disabled={busy} onClick={() => void publish()} />
            )}
            <Button styleVariant="secondary" colorVariant="red" leftContent={TrashIcon} text={t('delete')} disabled={busy} onClick={() => setConfirmDelete(true)} />
          </ButtonGroup>
        }
      />

      {error && <ErrorBanner error={error} />}
      {warnings.length > 0 && <Banner className="fe-warnings" variant="orange" icon={ErrorTriangleIcon} content={`${t('editor_warnings')}\n${warnings.map((w) => `• ${w}`).join('\n')}`} />}

      <div className="fe-layout">
        <div className="fe-main stack">
          {isSequence ? (
            <Banner variant="default" icon={InfoIcon} content={t('editor_sequence_note')} />
          ) : (
            <Card title={t('editor_triggers')}>
              <TriggerList triggers={def.triggers} t={t} onChange={updateTriggers} />
            </Card>
          )}

          <Card title={t('editor_steps')}>
            <VStack spacing={16}>
              <Banner variant="default" icon={InfoIcon} content={t('editor_placeholders')} />
              <StepPicker label={t('editor_entry')} value={def.entry} steps={def.steps} t={t} allowEnd={false} onChange={(entry) => updateDef((d) => ({ ...d, entry }))} />
              {def.steps.length === 0 ? (
                <EmptyState compact icon={FlowIcon} title={t('editor_no_steps')} />
              ) : (
                def.steps.map((s, i) => (
                  <StepCard
                    key={s.id + ':' + i}
                    step={s}
                    index={i}
                    count={def.steps.length}
                    isEntry={def.entry === s.id}
                    steps={def.steps}
                    stepTypes={stepTypes}
                    flows={allFlows}
                    currentId={flow.id}
                    t={t}
                    onChange={(ns) => setStep(i, ns)}
                    onMove={(delta) => moveStep(i, delta)}
                    onRemove={() => removeStep(i)}
                  />
                ))
              )}
              <div className="fe-add-step">
                <div className="fe-add-step__select">
                  <SelectInput
                    aria-label={t('editor_step_type')}
                    value={newStepType}
                    options={stepTypes.map((type) => ({ value: type, label: t(`step_${type}` as Key) }))}
                    onChange={setNewStepType}
                  />
                </div>
                <AddButton text={t('editor_add_step')} onClick={addStep} />
              </div>
            </VStack>
          </Card>
        </div>

        <aside
          id="fe-test-sheet"
          className={['fe-side', testOpen ? 'is-open' : ''].filter(Boolean).join(' ')}
          {...(isMobile ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'fe-test-title', hidden: !testOpen } : {})}
        >
          {isMobile && <div className="fe-side__scrim" onClick={() => setTestOpen(false)} aria-hidden="true" />}
          <div className="fe-side__panel">
            <TestPanel
              flowId={id}
              definition={def}
              kind={flow.kind}
              defaultChannel={channel === 'any' ? 'line' : channel}
              t={t}
              onClose={isMobile ? () => setTestOpen(false) : undefined}
            />
          </div>
        </aside>
      </div>

      <ConfirmModal show={confirmDelete} onHide={() => setConfirmDelete(false)}>
        <ConfirmModalContent>
          <ConfirmModalHeader title={t('confirmDelete')} description={name || flow.name} />
          <ConfirmModalFooter
            rightContent={
              <ButtonGroup>
                <ConfirmModalClose>
                  <Button styleVariant="secondary" colorVariant="monochrome-dark" text={t('cancel')} />
                </ConfirmModalClose>
                <Button colorVariant="red" text={t('delete')} onClick={() => void remove()} />
              </ButtonGroup>
            }
          />
        </ConfirmModalContent>
      </ConfirmModal>
    </div>
  )
}
