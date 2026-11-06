import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnDelete,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge, Icon, Tag } from '@channel.io/bezier-react'
import {
  AiIcon,
  ApiIcon,
  ArrowRightUpIcon,
  ButtonRouteIcon,
  ChatBubbleIcon,
  ChatQuestionIcon,
  ClockIcon,
  CommentIcon,
  LightningIcon,
  PlayIcon,
  ShuffleIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import type { FlowDefinition, Step, Trigger } from '@shared/flows/types'
import { useT, type Key } from '../../lib/i18n'
import { useTheme } from '../../lib/theme'
import { START, autoLayout, edgesOf, outlets, setPointer } from './graph'
import type { StepType, TFn } from './model'

type StartNode = Node<{ triggers: Trigger[]; isSequence: boolean }, 'start'>
type StepNode = Node<{ step: Step; isEntry: boolean; hasError: boolean }, 'step'>
type FlowNode = StartNode | StepNode
export type CanvasInstance = ReactFlowInstance<FlowNode>

const STEP_ICONS: Record<StepType, BezierIcon> = {
  message: ChatBubbleIcon,
  question: ChatQuestionIcon,
  condition: ButtonRouteIcon,
  action: LightningIcon,
  delay: ClockIcon,
  random: ShuffleIcon,
  goto: ArrowRightUpIcon,
  comment_reply: CommentIcon,
  request: ApiIcon,
  ai: AiIcon,
}

const seconds = (s: number) => (s % 86400 === 0 ? `${s / 86400}d` : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`)

function summary(step: Step, t: TFn): string {
  switch (step.type) {
    case 'message': return step.text || step.imageUrl || step.attachment?.url || (step.cards?.length ? `${t('editor_cards')} ×${step.cards.length}` : '')
    case 'question': return `${step.text} → ${step.field}`
    case 'condition': return step.rules.map((r) => [r.field, r.op, r.value].filter(Boolean).join(' ')).join(step.mode === 'any' ? ' OR ' : ' AND ')
    case 'action': return step.actions.map((a) => t(`action_${a.type}` as Key)).join(', ')
    case 'delay': return seconds(step.seconds)
    case 'random': return ''
    case 'goto': return step.flowId ? `→ #${step.flowId}` : ''
    case 'comment_reply': return step.text || step.texts?.[0] || ''
    case 'request': return `${step.method} ${step.url}`
    case 'ai': return step.instructions
  }
}

function triggerSummary(tr: Trigger, t: TFn): string {
  const detail = tr.type === 'keyword' || tr.type === 'comment' ? tr.keywords?.join(', ') : tr.type === 'ref' ? tr.ref : tr.type === 'postback' ? tr.payload : tr.type === 'intent' ? tr.description : ''
  return [t(`trigger_${tr.type}` as Key), detail].filter(Boolean).join(': ')
}

const nodeClass = (selected: boolean, error = false) => ['fe-node', selected ? 'is-selected' : '', error ? 'is-error' : ''].filter(Boolean).join(' ')

function StartNodeView({ data, selected }: NodeProps<StartNode>) {
  const t = useT()
  return (
    <div className={nodeClass(selected)}>
      <div className="fe-node__head">
        <Icon source={PlayIcon} size="s" color="bgtxt-green-normal" />
        <span className="fe-node__type">{t('editor_canvas_start')}</span>
      </div>
      <div className="fe-node__body">
        {data.isSequence ? t('editor_canvas_sequence_start') : data.triggers.length ? data.triggers.map((tr, i) => <div key={i}>{triggerSummary(tr, t)}</div>) : '—'}
      </div>
      <div className="fe-node__outlets">
        <div className="fe-node__outlet">
          <span className="fe-node__label">{t('editor_entry')}</span>
          <Handle type="source" position={Position.Right} id="entry" />
        </div>
      </div>
    </div>
  )
}

function StepNodeView({ id, data, selected }: NodeProps<StepNode>) {
  const t = useT()
  const { step } = data
  const outs = outlets(step)
  const text = summary(step, t)
  // Handles appear and disappear with buttons / branches: re-measure them so edges attach correctly.
  const updateInternals = useUpdateNodeInternals()
  const handleKey = outs.map((o) => o.handle).join()
  useEffect(() => updateInternals(id), [id, handleKey, updateInternals])
  return (
    <div className={nodeClass(selected, data.hasError)}>
      <Handle type="target" position={Position.Left} />
      <div className="fe-node__head">
        <Icon source={STEP_ICONS[step.type]} size="s" color="txt-black-dark" />
        <span className="fe-node__type">{t(`step_${step.type}` as Key)}</span>
        <Tag size="xs" variant="monochrome-dark" className="fe-mono">
          {step.id}
        </Tag>
        {data.isEntry && (
          <Badge size="xs" variant="green">
            {t('editor_entry')}
          </Badge>
        )}
      </div>
      {text && <div className="fe-node__body">{text.slice(0, 60)}</div>}
      {outs.length > 0 && (
        <div className="fe-node__outlets">
          {outs.map((o) => (
            <div className="fe-node__outlet" key={o.handle}>
              <span className="fe-node__label">{o.label ?? t('editor_next')}</span>
              <Handle type="source" position={Position.Right} id={o.handle} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { start: StartNodeView, step: StepNodeView }

/** Sets the pointer behind a source handle (`start`'s handle is the entry). */
function link(d: FlowDefinition, source: string, handle: string | null | undefined, target: string | null): FlowDefinition {
  if (source === START) return { ...d, entry: target }
  return { ...d, steps: d.steps.map((s) => (s.id === source ? setPointer(s, handle ?? 'next', target) : s)) }
}

/**
 * Node graph of a flow. The definition (plus `layout`) is the only source of truth: nodes and edges
 * are derived from it, and every edit goes back through `onChange`. Selection is owned by the page.
 */
export function Canvas({
  definition,
  isSequence,
  selectedId,
  errorIds,
  onSelect,
  onChange,
  onRemove,
  onInit,
}: {
  definition: FlowDefinition
  isSequence: boolean
  selectedId: string | null
  errorIds: Set<string>
  onSelect: (id: string | null) => void
  onChange: (fn: (d: FlowDefinition) => FlowDefinition) => void
  onRemove: (ids: string[]) => void
  onInit: (rf: CanvasInstance) => void
}) {
  const { themeName } = useTheme()
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)

  const derived = useMemo<FlowNode[]>(() => {
    const auto = autoLayout(definition) // fallback for steps added outside the canvas (e.g. over MCP)
    const pos = (id: string) => definition.layout?.[id] ?? auto[id] ?? { x: 0, y: 0 }
    return [
      { id: START, type: 'start', position: pos(START), deletable: false, selected: selectedId === START, data: { triggers: definition.triggers, isSequence } },
      ...definition.steps.map(
        (step): StepNode => ({ id: step.id, type: 'step', position: pos(step.id), selected: selectedId === step.id, data: { step, isEntry: definition.entry === step.id, hasError: errorIds.has(step.id) } }),
      ),
    ]
  }, [definition, isSequence, selectedId, errorIds])

  // React Flow needs the measured size on every node object it gets; keep it across re-derivations.
  const [nodes, setNodes] = useState<FlowNode[]>(derived)
  useEffect(() => {
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]))
      return derived.map((n) => ({ ...n, measured: measured.get(n.id) }))
    })
  }, [derived])

  const edges = useMemo<Edge[]>(() => edgesOf(definition).map((e) => ({ ...e, selected: e.id === selectedEdge })), [definition, selectedEdge])

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type === 'position' || c.type === 'dimensions'), ns))
      // A finished drag (or a keyboard move) is stored in the layout.
      const moved = changes.flatMap((c) => (c.type === 'position' && !c.dragging && c.position ? [[c.id, c.position] as const] : []))
      if (moved.length) onChange((d) => ({ ...d, layout: { ...d.layout, ...Object.fromEntries(moved) } }))
      const picked = changes.filter((c) => c.type === 'select')
      if (picked.length) onSelect(picked.find((c) => c.selected)?.id ?? null)
    },
    [onChange, onSelect],
  )

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const picked = changes.filter((c) => c.type === 'select')
    if (picked.length) setSelectedEdge(picked.find((c) => c.selected)?.id ?? null)
    else if (changes.some((c) => c.type === 'remove')) setSelectedEdge(null)
  }, [])

  const onConnect = useCallback((c: Connection) => onChange((d) => link(d, c.source, c.sourceHandle, c.target)), [onChange])

  const onReconnect = useCallback(
    (old: Edge, c: Connection) => onChange((d) => link(link(d, old.source, old.sourceHandle, null), c.source, c.sourceHandle, c.target)),
    [onChange],
  )

  const onDelete: OnDelete<FlowNode> = useCallback(
    ({ nodes: removed, edges: cut }) => {
      if (cut.length) onChange((d) => cut.reduce((acc, e) => link(acc, e.source, e.sourceHandle, null), d))
      const ids = removed.map((n) => n.id).filter((id) => id !== START)
      if (ids.length) onRemove(ids)
    },
    [onChange, onRemove],
  )

  return (
    <ReactFlow<FlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={onReconnect}
      onDelete={onDelete}
      // React Flow listens for Delete on the whole document: ignore it while focus is outside the canvas (panel buttons, dropdowns).
      onBeforeDelete={async () => !document.activeElement || document.activeElement === document.body || !!document.activeElement.closest('.react-flow')}
      onInit={onInit}
      isValidConnection={(c) => c.source !== c.target}
      colorMode={themeName}
      deleteKeyCode={['Backspace', 'Delete']}
      multiSelectionKeyCode={null}
      selectionKeyCode={null}
      nodesConnectable
      snapToGrid
      snapGrid={[16, 16]}
      minZoom={0.2}
      fitView
      fitViewOptions={{ maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable style={{ width: 140, height: 90 }} />
    </ReactFlow>
  )
}
