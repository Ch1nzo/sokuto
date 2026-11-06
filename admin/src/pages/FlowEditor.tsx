import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { animateValue, cubicBezier, m, useReducedMotion, type AnimationPlaybackControls } from 'motion/react'
import { getViewportForBounds } from '@xyflow/react'
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
import { ArrowLeftIcon, CancelIcon, CheckIcon, ChevronSmallDownIcon, ErrorTriangleIcon, FlowIcon, InfoIcon, GlobeIcon, MoreIcon, PausedIcon, PlayIcon, PlusIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { FlowDefinition, FlowRecord, Step, Trigger } from '@shared/flows/types'
import { api } from '../lib/api'
import { useT, type Key } from '../lib/i18n'
import { EASE_DRAWER, EASE_IN_OUT } from '../lib/motion'
import { EmptyState, ErrorBanner, LoadingState, MenuButton, PageHeader, SelectInput, type MenuButtonItem } from '../components'
import { formatFlowError } from './flow-editor/errors'
import { IconBtn } from './flow-editor/fields'
import { START, autoLayout, errorStepIds, outlets, setPointer, type Point } from './flow-editor/graph'
import { changeStepType, clearRefs, defaultStep, FLOW_CHANNELS, newStepId, SEQUENCE_STEP_TYPES, STEP_TYPES, type FlowChannel, type StepType } from './flow-editor/model'
import { Canvas, STEP_ICONS, type CanvasInstance } from './flow-editor/Canvas'
import { StepBody } from './flow-editor/StepCard'
import { TestPanel } from './flow-editor/TestPanel'
import { TriggerList } from './flow-editor/TriggerCard'
import './flow-editor.css'

/** Top bar widths (px, measured) below which the meta row wraps under the title, and secondary buttons drop their text. */
const STACK_BELOW = 880
const ICON_ONLY_BELOW = 520
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Test drawer: slides in from the right (a fade under reduced motion); the scrim fades. */
const DRAWER_TRANSITION = { duration: 0.22, ease: EASE_DRAWER }
const SCRIM_VARIANTS = { open: { opacity: 1 }, closed: { opacity: 0 } }
const PANEL_SLIDE = { open: { x: 0 }, closed: { x: '100%' } }
/** "Arrange" glides every node to its new place (positions interpolated in JS so edges stay attached). */
const ARRANGE_MS = 250
const arrangeEase = cubicBezier(...EASE_IN_OUT)
const lerpLayout = (from: Record<string, Point>, to: Record<string, Point>, p: number): Record<string, Point> =>
  Object.fromEntries(Object.entries(to).map(([k, b]) => {
    const a = from[k] ?? b
    return [k, { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }]
  }))

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  // The drawer stays mounted (the test transcript survives closing it); `hidden` only once its exit has finished.
  const [testHidden, setTestHidden] = useState(true)
  const [appearId, setAppearId] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()
  const arrangeAnim = useRef<AnimationPlaybackControls | null>(null)
  const lastPanel = useRef<ReactNode>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [barWidth, setBarWidth] = useState(Number.POSITIVE_INFINITY)
  const rf = useRef<CanvasInstance | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // The top bar spans the canvas, so its width (not the viewport) decides the layout: it also narrows when the step panel opens.
  const barObserver = useRef<ResizeObserver | null>(null)
  const topbarRef = useCallback((el: HTMLElement | null) => {
    barObserver.current?.disconnect()
    barObserver.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setBarWidth(entry.contentRect.width))
    ro.observe(el)
    barObserver.current = ro
  }, [])

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
    setTestHidden(false)
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

  // Ctrl/Cmd+S saves (when there is something to save) instead of opening the browser's "Save page" dialog.
  const saveShortcut = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveShortcut.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  const addStep = (type: StepType) => {
    const step = defaultStep(type, newStepId(def.steps, type))
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
    setAppearId(step.id)
  }

  const stopArrange = useCallback(() => {
    arrangeAnim.current?.stop()
    arrangeAnim.current = null
  }, [])
  useEffect(() => stopArrange, [stopArrange])

  /** Auto layout. Nodes glide there (250ms --ease-in-out) while the view pans to fit the result; instant under reduced motion. */
  const arrange = () => {
    stopArrange()
    const inst = rf.current
    const box = canvasRef.current?.getBoundingClientRect()
    if (reduceMotion || !inst || !box) {
      updateDef((d) => ({ ...d, layout: autoLayout(d) }))
      requestAnimationFrame(() => void rf.current?.fitView({ maxZoom: 1 }))
      return
    }
    const nodes = inst.getNodes()
    const from = Object.fromEntries(nodes.map((n) => [n.id, n.position]))
    const to = autoLayout(def)
    // Fit the view to where the nodes will end up, in step with the glide (fitView would use their current places).
    const rects = nodes.map((n) => ({ ...(to[n.id] ?? n.position), w: n.measured?.width ?? 260, h: n.measured?.height ?? 80 }))
    if (rects.length) {
      const x = Math.min(...rects.map((r) => r.x))
      const y = Math.min(...rects.map((r) => r.y))
      const bounds = { x, y, width: Math.max(...rects.map((r) => r.x + r.w)) - x, height: Math.max(...rects.map((r) => r.y + r.h)) - y }
      void inst.setViewport(getViewportForBounds(bounds, box.width, box.height, 0.2, 1, 0.1), { duration: ARRANGE_MS, ease: arrangeEase })
    }
    setDirty(true)
    // Motion's plain value animation (0 → 1, ms; the engine domAnimation already ships, unlike the full `animate()`).
    arrangeAnim.current = animateValue({
      keyframes: [0, 1],
      duration: ARRANGE_MS,
      ease: EASE_IN_OUT,
      onUpdate: (p) => setDef((d) => ({ ...d, layout: { ...d.layout, ...lerpLayout(from, to, p) } })),
      onComplete: () => {
        arrangeAnim.current = null
        setDef((d) => ({ ...d, layout: autoLayout(d) }))
      },
    })
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

  saveShortcut.current = () => {
    if (dirty && !busy) void save()
  }

  /** Back to the list; unsaved edits ask first (the in-app navigation never fires beforeunload). */
  const leave = () => (dirty ? setConfirmLeave(true) : navigate('/flows'))

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
  const stacked = barWidth < STACK_BELOW
  const iconOnly = barWidth < ICON_ONLY_BELOW
  const saveKey = isMac ? '⌘S' : 'Ctrl+S'
  const moreItems: MenuButtonItem[] = [
    ...(live ? [{ key: 'unpublish', label: t('editor_unpublish'), icon: PausedIcon, onSelect: () => void unpublish() }] : []),
    { key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setConfirmDelete(true) },
  ]
  const closeBtn = <IconBtn icon={CancelIcon} label={t('close')} onClick={() => setSelectedId(null)} />
  // While the mobile bottom sheet slides away (selection already cleared), it keeps showing what it showed.
  const panelContent =
    selectedId === START ? (
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
    )
  if (selectedId) lastPanel.current = panelContent

  return (
    <div className="stack fe-page">
      <header className={['fe-topbar', stacked ? 'is-stacked' : '', iconOnly ? 'is-compact' : ''].filter(Boolean).join(' ')} ref={topbarRef}>
        <h1 className="visually-hidden">{name || flow.name}</h1>
        <div className="fe-topbar__title">
          <Button size="m" styleVariant="tertiary" colorVariant="monochrome-dark" leftContent={ArrowLeftIcon} aria-label={t('editor_back')} title={t('editor_back')} onClick={leave} />
          <div className="fe-title" data-value={name || flow.name}>
            <TextField
              className="fe-title__input"
              wrapperClassName="fe-title__field"
              size="m"
              value={name}
              aria-label={t('editor_name')}
              title={name || flow.name}
              placeholder={flow.name}
              onChange={(e) => {
                setName(e.target.value)
                touch()
              }}
            />
          </div>
        </div>
        <div className="fe-topbar__meta">
          <Badge size="m" variant={live ? 'green' : 'monochrome-light'}>
            {live ? t('status_live') : t('status_draft')}
          </Badge>
          {isSequence && (
            <Badge size="m" variant="purple">
              {t('flows_kind_sequence')}
            </Badge>
          )}
          <div className="fe-channel">
            <SelectInput
              aria-label={t('editor_channel')}
              title={t('editor_channel')}
              leftContent={GlobeIcon}
              value={channel}
              options={FLOW_CHANNELS.map((c) => ({ value: c, label: t(`channel_${c}` as Key) }))}
              onChange={(c) => {
                setChannel(c)
                touch()
              }}
            />
          </div>
          <span className="fe-unsaved" role="status">
            {dirty && (
              <>
                <span className="fe-unsaved__dot" aria-hidden="true" />
                <span className="fe-unsaved__text">{t('editor_unsaved')}</span>
              </>
            )}
          </span>
        </div>
        <div className="fe-topbar__actions">
          <Button
            styleVariant="secondary"
            colorVariant="monochrome-dark"
            leftContent={PlayIcon}
            text={iconOnly ? undefined : t('editor_test')}
            aria-label={iconOnly ? t('editor_test') : undefined}
            title={iconOnly ? t('editor_test') : undefined}
            aria-expanded={testOpen}
            aria-controls="fe-test-sheet"
            onClick={() => setTestOpen((o) => !o)}
          />
          {live ? (
            dirty ? (
              <Button text={t('editor_save_apply')} title={`${t('editor_save_apply_hint')} (${saveKey})`} loading={busy} disabled={busy} onClick={() => void save()} />
            ) : (
              <Button styleVariant="secondary" colorVariant="monochrome-dark" leftContent={CheckIcon} text={iconOnly ? undefined : t('editor_saved_state')} aria-label={t('editor_saved_state')} disabled />
            )
          ) : (
            <>
              <Button
                styleVariant="secondary"
                colorVariant="monochrome-dark"
                text={t('save')}
                title={`${t('save')} (${saveKey})`}
                loading={busy && dirty}
                disabled={busy || !dirty}
                onClick={() => void save()}
              />
              <Button text={t('editor_publish')} disabled={busy} onClick={() => void publish()} />
            </>
          )}
        </div>
        <MenuButton className="fe-topbar__more" label={t('editor_more')} icon={MoreIcon} iconOnly styleVariant="tertiary" align="right" disabled={busy} items={moreItems} />
      </header>

      {error && <ErrorBanner error={error} />}
      {warnings.length > 0 && <Banner className="fe-warnings" variant="orange" icon={ErrorTriangleIcon} content={`${t('editor_warnings')}\n${warnings.map((w) => `• ${w}`).join('\n')}`} />}

      <div className={['fe-layout', selectedId ? 'has-panel' : ''].filter(Boolean).join(' ')}>
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
            appearId={appearId}
            onNodeDragStart={stopArrange}
          />
          <div className="fe-canvasbar" role="toolbar" aria-label={t('editor_canvas_tools')}>
            <MenuButton
              label={t('editor_add_step')}
              icon={PlusIcon}
              rightContent={ChevronSmallDownIcon}
              colorVariant="blue"
              items={stepTypes.map((type) => ({ key: type, label: t(`step_${type}` as Key), icon: STEP_ICONS[type], onSelect: () => addStep(type) }))}
            />
            <Button styleVariant="tertiary" colorVariant="monochrome-dark" text={t('editor_canvas_arrange')} onClick={arrange} />
          </div>
        </div>

        <aside className={['fe-panel', selectedId ? 'is-open' : ''].filter(Boolean).join(' ')} aria-label={selectedStep?.id ?? t('editor_triggers')} inert={!selectedId}>
          {selectedId ? panelContent : lastPanel.current}
        </aside>
      </div>

      {/* Stays mounted while closed so the transcript survives; inert during the slide-out, `hidden` after it. */}
      <aside id="fe-test-sheet" className="fe-side" role="dialog" aria-modal aria-labelledby="fe-test-title" hidden={!testOpen && testHidden} inert={!testOpen}>
        <m.div
          className="fe-side__scrim"
          aria-hidden="true"
          variants={SCRIM_VARIANTS}
          initial={false}
          animate={testOpen ? 'open' : 'closed'}
          transition={DRAWER_TRANSITION}
          onClick={() => setTestOpen(false)}
        />
        <m.div
          className="fe-side__panel"
          variants={reduceMotion ? SCRIM_VARIANTS : PANEL_SLIDE}
          initial={false}
          animate={testOpen ? 'open' : 'closed'}
          transition={DRAWER_TRANSITION}
          onAnimationComplete={(v) => v === 'closed' && setTestHidden(true)}
        >
          <TestPanel flowId={id} definition={def} kind={flow.kind} defaultChannel={channel === 'any' ? 'line' : channel} t={t} onClose={() => setTestOpen(false)} />
        </m.div>
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

      <ConfirmModal show={confirmLeave} onHide={() => setConfirmLeave(false)}>
        <ConfirmModalContent>
          <ConfirmModalHeader title={t('editor_leave_title')} description={t('editor_leave_desc')} />
          <ConfirmModalFooter
            rightContent={
              <ButtonGroup>
                <ConfirmModalClose>
                  <Button styleVariant="secondary" colorVariant="monochrome-dark" text={t('cancel')} />
                </ConfirmModalClose>
                <Button
                  colorVariant="red"
                  text={t('editor_leave_confirm')}
                  onClick={() => {
                    setConfirmLeave(false)
                    setDirty(false)
                    navigate('/flows')
                  }}
                />
              </ButtonGroup>
            }
          />
        </ConfirmModalContent>
      </ConfirmModal>
    </div>
  )
}
