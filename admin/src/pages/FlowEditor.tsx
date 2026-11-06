import { useCallback, useEffect, useRef, useState } from 'react'
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
  HStack,
  Tag,
  Text,
  TextField,
  VStack,
  useToast,
} from '@channel.io/bezier-react'
import { CancelIcon, ErrorTriangleIcon, FlowIcon, InfoIcon, PlayIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { FlowDefinition, FlowRecord, Step, Trigger } from '@shared/flows/types'
import { api } from '../lib/api'
import { useT, type Key } from '../lib/i18n'
import { EmptyState, ErrorBanner, LoadingState, PageHeader, SelectInput } from '../components'
import { formatFlowError } from './flow-editor/errors'
import { AddButton, IconBtn } from './flow-editor/fields'
import { START, autoLayout, errorStepIds, outlets, setPointer, type Point } from './flow-editor/graph'
import { changeStepType, clearRefs, defaultStep, FLOW_CHANNELS, newStepId, SEQUENCE_STEP_TYPES, STEP_TYPES, type FlowChannel, type StepType } from './flow-editor/model'
import { Canvas, type CanvasInstance } from './flow-editor/Canvas'
import { StepBody } from './flow-editor/StepCard'
import { TestPanel } from './flow-editor/TestPanel'
import { TriggerList } from './flow-editor/TriggerCard'
import './flow-editor.css'

/** Flows saved before the canvas (and templates) have no layout: arrange them once on open. */
const withLayout = (d: FlowDefinition): FlowDefinition => (d.layout ? d : { ...d, layout: autoLayout(d) })

export default function FlowEditor() {
  const t = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const { id = '' } = useParams<{ id: string }>()
  const [flow, setFlow] = useState<FlowRecord | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<FlowChannel>('any')
  const [def, setDef] = useState<FlowDefinition>({ triggers: [], entry: null, steps: [] })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorIds, setErrorIds] = useState<Set<string>>(() => new Set())
  const [warnings, setWarnings] = useState<string[]>([])
  const [allFlows, setAllFlows] = useState<FlowRecord[]>([])
  const [newStepType, setNewStepType] = useState<StepType>('message')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const rf = useRef<CanvasInstance | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFlow(null)
    setLoadError(null)
    api
      .get<{ flow: FlowRecord }>(`/api/flows/${id}`)
      .then((r) => {
        setFlow(r.flow)
        setName(r.flow.name)
        setChannel(r.flow.channel)
        setDef(withLayout(r.flow.definition))
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

  // Test drawer: lock page scroll and close on Escape while open.
  useEffect(() => {
    if (!testOpen) return
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
  }, [testOpen])

  const touch = () => setDirty(true)
  const updateDef = useCallback((fn: (d: FlowDefinition) => FlowDefinition) => {
    setDef(fn)
    setDirty(true)
  }, [])

  /* triggers */
  const updateTriggers = (fn: (ts: Trigger[]) => Trigger[]) => updateDef((d) => ({ ...d, triggers: fn(d.triggers) }))

  /* steps */
  const setStep = (s: Step) => updateDef((d) => ({ ...d, steps: d.steps.map((x) => (x.id === s.id ? s : x)) }))
  const removeSteps = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids)
      updateDef((d) => {
        const layout = { ...d.layout }
        for (const sid of ids) delete layout[sid]
        return {
          ...d,
          entry: d.entry && gone.has(d.entry) ? null : d.entry,
          steps: d.steps.filter((s) => !gone.has(s.id)).map((s) => ids.reduce(clearRefs, s)),
          layout,
        }
      })
      setSelectedId((sel) => (sel && gone.has(sel) ? null : sel))
    },
    [updateDef],
  )

  /** New node right of the selected one (or in the middle of the view), linked from the selected step's empty `next`. */
  const addStep = () => {
    const step = defaultStep(newStepType, newStepId(def.steps, newStepType))
    const layout = { ...def.layout }
    const from = selectedId ? layout[selectedId] : undefined
    let pos: Point = { x: 0, y: 0 }
    if (from) pos = { x: from.x + 320, y: from.y }
    else {
      const r = canvasRef.current?.getBoundingClientRect()
      const c = r && rf.current ? rf.current.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : pos
      pos = { x: Math.round(c.x / 16) * 16 - 128, y: Math.round(c.y / 16) * 16 - 48 }
    }
    while (Object.values(layout).some((p) => Math.abs(p.x - pos.x) < 240 && Math.abs(p.y - pos.y) < 120)) pos = { ...pos, y: pos.y + 160 }
    layout[step.id] = pos
    updateDef((d) => ({
      ...d,
      entry: d.entry ?? step.id,
      layout,
      steps: [...d.steps.map((s) => (s.id === selectedId && outlets(s).some((o) => o.handle === 'next' && !o.target) ? setPointer(s, 'next', step.id) : s)), step],
    }))
    setSelectedId(step.id)
  }

  const arrange = () => {
    updateDef((d) => ({ ...d, layout: autoLayout(d) }))
    requestAnimationFrame(() => void rf.current?.fitView({ maxZoom: 1 }))
  }

  /* server actions */
  const showError = (err: unknown) => {
    const text = formatFlowError(err, t)
    setError(text)
    setErrorIds(errorStepIds(text.split('\n'), def.steps))
  }
  const clearError = () => {
    setError('')
    setErrorIds(new Set())
  }

  const save = async (): Promise<boolean> => {
    clearError()
    setWarnings([])
    setBusy(true)
    try {
      const r = await api.put<{ flow: FlowRecord; warnings: string[] }>(`/api/flows/${id}`, { name, channel, definition: def })
      setFlow(r.flow)
      setDef(withLayout(r.flow.definition))
      setName(r.flow.name)
      setDirty(false)
      setWarnings(r.warnings ?? [])
      toast.addToast(t('saved'), { preset: 'success' })
      return true
    } catch (err) {
      showError(err)
      return false
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (dirty && !(await save())) return
    clearError()
    setBusy(true)
    try {
      const r = await api.post<{ ok: boolean; warnings?: string[] }>(`/api/flows/${id}/publish`)
      setFlow((f) => (f ? { ...f, status: 'live' } : f))
      setWarnings(r.warnings ?? [])
      toast.addToast(t('status_live'), { preset: 'success' })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  const unpublish = async () => {
    clearError()
    setBusy(true)
    try {
      await api.post(`/api/flows/${id}/unpublish`)
      setFlow((f) => (f ? { ...f, status: 'draft' } : f))
      toast.addToast(t('status_draft'), { preset: 'default' })
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirmDelete(false)
    clearError()
    setBusy(true)
    try {
      await api.delete(`/api/flows/${id}`)
      setDirty(false)
      navigate('/flows')
    } catch (err) {
      showError(err)
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
  const selectedStep = def.steps.find((s) => s.id === selectedId)
  const closeBtn = <IconBtn icon={CancelIcon} label={t('close')} onClick={() => setSelectedId(null)} />

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

      <div className="fe-toolbar">
        <div className="fe-toolbar__select">
          <SelectInput
            aria-label={t('editor_step_type')}
            value={newStepType}
            options={stepTypes.map((type) => ({ value: type, label: t(`step_${type}` as Key) }))}
            onChange={setNewStepType}
          />
        </div>
        <AddButton text={t('editor_add_step')} onClick={addStep} />
        <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('editor_canvas_arrange')} onClick={arrange} />
        <Button
          size="s"
          styleVariant="secondary"
          colorVariant="monochrome-dark"
          leftContent={PlayIcon}
          text={t('editor_test')}
          aria-expanded={testOpen}
          aria-controls="fe-test-sheet"
          onClick={() => setTestOpen((o) => !o)}
        />
      </div>

      <div className="fe-layout">
        <div className="fe-canvas" ref={canvasRef}>
          <Canvas
            definition={def}
            isSequence={isSequence}
            selectedId={selectedId}
            errorIds={errorIds}
            onSelect={setSelectedId}
            onChange={updateDef}
            onRemove={removeSteps}
            onInit={(instance) => (rf.current = instance)}
          />
        </div>

        <aside className={['fe-panel', selectedId ? 'is-open' : ''].filter(Boolean).join(' ')} aria-label={selectedStep?.id ?? t('editor_triggers')}>
          {selectedId === START ? (
            <VStack spacing={16}>
              <div className="fe-panel__head">
                <Text as="h2" typo="16" bold color="txt-black-darkest" className="fe-grow">
                  {isSequence ? t('editor_canvas_start') : t('editor_triggers')}
                </Text>
                {closeBtn}
              </div>
              {isSequence ? <Banner variant="default" icon={InfoIcon} content={t('editor_sequence_note')} /> : <TriggerList triggers={def.triggers} t={t} onChange={updateTriggers} />}
            </VStack>
          ) : selectedStep ? (
            <VStack spacing={16}>
              <div className="fe-panel__head">
                <Tag size="m" variant="monochrome-dark" className="fe-mono">
                  {selectedStep.id}
                </Tag>
                <div className="fe-grow">
                  <SelectInput
                    aria-label={t('editor_step_type')}
                    value={selectedStep.type}
                    options={stepTypes.map((type) => ({ value: type, label: t(`step_${type}` as Key) }))}
                    onChange={(type: StepType) => setStep(changeStepType(selectedStep, type))}
                  />
                </div>
                <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${selectedStep.id}`} onClick={() => removeSteps([selectedStep.id])} />
                {closeBtn}
              </div>
              <HStack>
                {def.entry === selectedStep.id ? (
                  <Badge size="m" variant="green">
                    {t('editor_entry')}
                  </Badge>
                ) : (
                  <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('editor_canvas_set_entry')} onClick={() => updateDef((d) => ({ ...d, entry: selectedStep.id }))} />
                )}
              </HStack>
              <Banner variant="default" icon={InfoIcon} content={t('editor_placeholders')} />
              <StepBody key={selectedStep.id} step={selectedStep} steps={def.steps} t={t} flows={allFlows} currentId={flow.id} onChange={setStep} />
            </VStack>
          ) : (
            <EmptyState compact icon={FlowIcon} title={t('editor_canvas_select')} description={t('editor_canvas_hint')} />
          )}
        </aside>
      </div>

      <aside id="fe-test-sheet" className="fe-side" role="dialog" aria-modal aria-labelledby="fe-test-title" hidden={!testOpen}>
        <div className="fe-side__scrim" onClick={() => setTestOpen(false)} aria-hidden="true" />
        <div className="fe-side__panel">
          <TestPanel flowId={id} definition={def} kind={flow.kind} defaultChannel={channel === 'any' ? 'line' : channel} t={t} onClose={() => setTestOpen(false)} />
        </div>
      </aside>

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
