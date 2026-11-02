import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import { useT, type Key } from '../lib/i18n'
import type { Action, ButtonDef, ConditionRule, FlowDefinition, FlowRecord, Step, Trigger } from '@shared/flows/types'
import type { Channel, OutboundMessage } from '@shared/channels/types'

/* ---------- Local mirrors of server-only types (src/flows/simulate.ts pulls runtime deps) ---------- */

type SimulatedInput = { type: 'message' | 'comment' | 'follow' | 'postback' | 'ref' | 'story_mention' | 'story_reply'; text?: string; payload?: string; ref?: string; button?: string }
type SimulationStep = { input: SimulatedInput; triggered: boolean; outputs: OutboundMessage[]; commentReplies: string[]; waiting: string | null; stepId: string | null }
type SimulationResult = { steps: SimulationStep[]; fields: Record<string, string>; tags: string[]; notifications: string[]; completed: boolean }

type FlowChannel = FlowRecord['channel']
type StepType = Step['type']
type TriggerType = Trigger['type']
type ActionType = Action['type']
type StepOf<T extends StepType> = Extract<Step, { type: T }>
type TFn = ReturnType<typeof useT>

const STEP_TYPES: StepType[] = ['message', 'question', 'condition', 'action', 'delay', 'random', 'goto', 'comment_reply']
const TRIGGER_TYPES: TriggerType[] = ['keyword', 'comment', 'first_message', 'follow', 'any_message', 'ref', 'postback', 'story_mention', 'story_reply']
const ACTION_TYPES: ActionType[] = ['add_tag', 'remove_tag', 'set_field', 'notify', 'pause_bot', 'webhook']
const RULE_OPS: ConditionRule['op'][] = ['equals', 'not_equals', 'contains', 'has_tag', 'not_has_tag', 'is_set', 'is_empty', 'gt', 'gte', 'lt', 'lte']
const FLOW_CHANNELS: FlowChannel[] = ['any', 'line', 'messenger', 'instagram']
const TEST_CHANNELS: Channel[] = ['line', 'messenger', 'instagram']
const DELAY_PRESETS: { seconds: number; label: string }[] = [
  { seconds: 60, label: '1m' },
  { seconds: 300, label: '5m' },
  { seconds: 3600, label: '1h' },
  { seconds: 86400, label: '1d' },
]
const MAX_BUTTONS = 13

const ID_PREFIX: Record<StepType, string> = { message: 'm', question: 'q', condition: 'c', action: 'a', delay: 'd', random: 'r', goto: 'g', comment_reply: 'cr' }

/* ---------- Pure helpers ---------- */

const splitList = (s: string): string[] => s.split(/[,、]/).map((x) => x.trim()).filter(Boolean)

function newStepId(steps: Step[], type: StepType): string {
  const used = new Set(steps.map((s) => s.id))
  let n = 1
  while (used.has(`${ID_PREFIX[type]}${n}`)) n++
  return `${ID_PREFIX[type]}${n}`
}

function defaultStep(type: StepType, id: string): Step {
  switch (type) {
    case 'message': return { id, type, text: '', next: null }
    case 'question': return { id, type, text: '', field: '', next: null }
    case 'condition': return { id, type, rules: [{ field: 'tag', op: 'has_tag', value: '' }], mode: 'all', yes: null, no: null }
    case 'action': return { id, type, actions: [{ type: 'add_tag', tag: '' }], next: null }
    case 'delay': return { id, type, seconds: 60, next: null }
    case 'random': return { id, type, branches: [{ weight: 50, next: null }, { weight: 50, next: null }] }
    case 'goto': return { id, type, flowId: 0 }
    case 'comment_reply': return { id, type, text: '', next: null }
  }
}

function defaultTrigger(type: TriggerType): Trigger {
  switch (type) {
    case 'keyword': return { type, keywords: [], match: 'contains' }
    case 'comment': return { type, keywords: [], postIds: [] }
    case 'ref': return { type, ref: '' }
    case 'postback': return { type, payload: '' }
    default: return { type }
  }
}

function defaultAction(type: ActionType): Action {
  switch (type) {
    case 'add_tag':
    case 'remove_tag': return { type, tag: '' }
    case 'set_field': return { type, field: '', value: '' }
    case 'notify': return { type, text: '' }
    case 'pause_bot': return { type }
    case 'webhook': return { type, url: '' }
  }
}

function stepNext(s: Step): string | null {
  return 'next' in s ? s.next ?? null : null
}

/** Change a step's type, keeping its id and its "next" pointer where both types have one. */
function changeStepType(s: Step, type: StepType): Step {
  const fresh = defaultStep(type, s.id)
  const next = stepNext(s)
  return 'next' in fresh ? ({ ...fresh, next } as Step) : fresh
}

/** Replace every pointer to `removedId` in a step with null. */
function clearRefs(s: Step, removedId: string): Step {
  const fix = (v: string | null | undefined) => (v === removedId ? null : v)
  switch (s.type) {
    case 'message':
      return { ...s, next: fix(s.next), buttons: s.buttons?.map((b) => ('next' in b ? { ...b, next: fix(b.next) } : b)) }
    case 'condition':
      return { ...s, yes: fix(s.yes), no: fix(s.no) }
    case 'random':
      return { ...s, branches: s.branches.map((b) => ({ ...b, next: fix(b.next) })) }
    case 'goto':
      return s
    default:
      return { ...s, next: fix(s.next) }
  }
}

function stepSummary(s: Step): string {
  const text = 'text' in s ? s.text : ''
  return text.length > 20 ? `${text.slice(0, 20)}…` : text
}

/* ---------- Small shared inputs ---------- */

/** Text input bound to a string[]; keeps the raw text locally so typing "a, " is not swallowed. */
function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '))
  useEffect(() => {
    if (splitList(text).join('\u0000') !== value.join('\u0000')) setText(value.join(', '))
  }, [value])
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        onChange(splitList(e.target.value))
      }}
    />
  )
}

function StepSelect({ value, onChange, steps, t, selfId, allowEnd = true }: { value: string | null | undefined; onChange: (v: string | null) => void; steps: Step[]; t: TFn; selfId?: string; allowEnd?: boolean }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{allowEnd ? t('editor_end') : '—'}</option>
      {steps.map((s) => (
        <option key={s.id} value={s.id} disabled={s.id === selfId}>
          {[s.id, t(`step_${s.type}` as Key), stepSummary(s)].filter(Boolean).join(' · ')}
        </option>
      ))}
    </select>
  )
}

/* ---------- Trigger editor ---------- */

function TriggerCard({ trigger, onChange, onRemove, t }: { trigger: Trigger; onChange: (tr: Trigger) => void; onRemove: () => void; t: TFn }) {
  return (
    <div className="step-card">
      <div className="head">
        <select value={trigger.type} onChange={(e) => onChange(defaultTrigger(e.target.value as TriggerType))} style={{ flex: 1, minWidth: 200 }}>
          {TRIGGER_TYPES.map((type) => (
            <option key={type} value={type}>{t(`trigger_${type}` as Key)}</option>
          ))}
        </select>
        <button className="btn small danger" onClick={onRemove}>{t('delete')}</button>
      </div>
      {trigger.type === 'keyword' && (
        <div className="inline-fields">
          <div>
            <label>{t('editor_keywords')}</label>
            <ListInput value={trigger.keywords} onChange={(keywords) => onChange({ ...trigger, keywords })} />
          </div>
          <div>
            <label>{t('editor_match')}</label>
            <select value={trigger.match ?? 'contains'} onChange={(e) => onChange({ ...trigger, match: e.target.value as 'contains' | 'exact' | 'starts_with' })}>
              <option value="contains">contains</option>
              <option value="exact">exact</option>
              <option value="starts_with">starts_with</option>
            </select>
          </div>
        </div>
      )}
      {trigger.type === 'comment' && (
        <div className="inline-fields">
          <div>
            <label>{t('editor_keywords')}</label>
            <ListInput value={trigger.keywords ?? []} onChange={(keywords) => onChange({ ...trigger, keywords })} />
          </div>
          <div>
            <label>{t('editor_post_ids')}</label>
            <ListInput value={trigger.postIds ?? []} onChange={(postIds) => onChange({ ...trigger, postIds })} />
          </div>
        </div>
      )}
      {trigger.type === 'ref' && (
        <>
          <label>{t('editor_ref')}</label>
          <input value={trigger.ref} onChange={(e) => onChange({ ...trigger, ref: e.target.value })} />
        </>
      )}
      {trigger.type === 'postback' && (
        <>
          <label>{t('editor_payload')}</label>
          <input value={trigger.payload} onChange={(e) => onChange({ ...trigger, payload: e.target.value })} />
        </>
      )}
    </div>
  )
}

/* ---------- Step body editors ---------- */

type BodyProps<T extends StepType> = { step: StepOf<T>; onChange: (s: Step) => void; steps: Step[]; t: TFn }

function NextField({ step, onChange, steps, t }: { step: Step & { next?: string | null }; onChange: (s: Step) => void; steps: Step[]; t: TFn }) {
  return (
    <>
      <label>{t('editor_next')}</label>
      <StepSelect value={step.next} steps={steps} selfId={step.id} t={t} onChange={(next) => onChange({ ...step, next } as Step)} />
    </>
  )
}

function MessageBody({ step, onChange, steps, t }: BodyProps<'message'>) {
  const buttons = step.buttons ?? []
  const setButtons = (bs: ButtonDef[]) => onChange({ ...step, buttons: bs.length ? bs : undefined })
  const setButton = (i: number, b: ButtonDef) => setButtons(buttons.map((x, j) => (j === i ? b : x)))
  return (
    <>
      <label>{t('editor_text')}</label>
      <textarea value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} />
      <label>{t('editor_image')}</label>
      <input value={step.imageUrl ?? ''} placeholder="https://" onChange={(e) => onChange({ ...step, imageUrl: e.target.value || undefined })} />
      <label>{t('editor_buttons')}</label>
      {buttons.map((b, i) => (
        <div className="list-item" key={i}>
          <div className="inline-fields">
            <div>
              <label>{t('editor_button_label')} <span className="small">({b.label.length}/40)</span></label>
              <input value={b.label} maxLength={40} onChange={(e) => setButton(i, { ...b, label: e.target.value })} />
            </div>
            <div>
              <label>{t('editor_button_url')}</label>
              <input
                value={b.url ?? ''}
                placeholder="https://"
                onChange={(e) => {
                  const url = e.target.value
                  setButton(i, url ? { label: b.label, url } : { label: b.label, next: b.next ?? null })
                }}
              />
            </div>
          </div>
          {!b.url && (
            <>
              <label>{t('editor_next')}</label>
              <StepSelect value={b.next} steps={steps} t={t} onChange={(next) => setButton(i, { ...b, next })} />
            </>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn small danger" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>{t('delete')}</button>
          </div>
        </div>
      ))}
      <button className="btn small" disabled={buttons.length >= MAX_BUTTONS} onClick={() => setButtons([...buttons, { label: '', next: null }])}>
        + {t('editor_add_button')}
      </button>
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function QuestionBody({ step, onChange, steps, t }: BodyProps<'question'>) {
  const tooLong = (step.choices ?? []).filter((c) => c.length > 20)
  return (
    <>
      <label>{t('editor_text')}</label>
      <textarea value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} />
      <div className="inline-fields">
        <div>
          <label>{t('editor_field')}</label>
          <input value={step.field} placeholder="phone" onChange={(e) => onChange({ ...step, field: e.target.value.replace(/\s/g, '') })} />
        </div>
        <div>
          <label>{t('editor_choices')}</label>
          <ListInput value={step.choices ?? []} onChange={(choices) => onChange({ ...step, choices: choices.length ? choices : undefined })} />
        </div>
      </div>
      {((step.choices?.length ?? 0) > MAX_BUTTONS || tooLong.length > 0) && (
        <div className="small" style={{ color: 'var(--warn)' }}>≤ {MAX_BUTTONS} × ≤ 20{tooLong.length > 0 ? `: ${tooLong.join(', ')}` : ''}</div>
      )}
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

const OPS_WITHOUT_VALUE: ConditionRule['op'][] = ['is_set', 'is_empty']

function ConditionBody({ step, onChange, steps, t }: BodyProps<'condition'>) {
  const setRule = (i: number, r: ConditionRule) => onChange({ ...step, rules: step.rules.map((x, j) => (j === i ? r : x)) })
  return (
    <>
      <label>{t('editor_rules')}</label>
      {step.rules.map((r, i) => (
        <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
          <input value={r.field} placeholder="tag / channel / last_input / field" onChange={(e) => setRule(i, { ...r, field: e.target.value })} style={{ flex: 2, minWidth: 0 }} />
          <select
            value={r.op}
            onChange={(e) => {
              const op = e.target.value as ConditionRule['op']
              setRule(i, OPS_WITHOUT_VALUE.includes(op) ? { field: r.field, op } : { ...r, op, value: r.value ?? '' })
            }}
            style={{ flex: 1, minWidth: 0 }}
          >
            {RULE_OPS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
          {!OPS_WITHOUT_VALUE.includes(r.op) && (
            <input value={r.value ?? ''} onChange={(e) => setRule(i, { ...r, value: e.target.value })} style={{ flex: 2, minWidth: 0 }} />
          )}
          <button className="btn small danger" disabled={step.rules.length <= 1} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange({ ...step, rules: [...step.rules, { field: '', op: 'equals', value: '' }] })}>+ {t('editor_add_rule')}</button>
      <label>&nbsp;</label>
      <select value={step.mode ?? 'all'} onChange={(e) => onChange({ ...step, mode: e.target.value as 'all' | 'any' })}>
        <option value="all">{t('editor_mode_all')}</option>
        <option value="any">{t('editor_mode_any')}</option>
      </select>
      <div className="inline-fields">
        <div>
          <label>{t('editor_yes')}</label>
          <StepSelect value={step.yes} steps={steps} selfId={step.id} t={t} onChange={(yes) => onChange({ ...step, yes })} />
        </div>
        <div>
          <label>{t('editor_no')}</label>
          <StepSelect value={step.no} steps={steps} selfId={step.id} t={t} onChange={(no) => onChange({ ...step, no })} />
        </div>
      </div>
    </>
  )
}

function ActionFields({ action, onChange, t }: { action: Action; onChange: (a: Action) => void; t: TFn }) {
  switch (action.type) {
    case 'add_tag':
    case 'remove_tag':
      return <input value={action.tag} placeholder={t('test_result_tags')} onChange={(e) => onChange({ ...action, tag: e.target.value })} />
    case 'set_field':
      return (
        <div className="inline-fields">
          <input value={action.field} placeholder={t('test_result_fields')} onChange={(e) => onChange({ ...action, field: e.target.value })} />
          <input value={action.value} placeholder="value" onChange={(e) => onChange({ ...action, value: e.target.value })} />
        </div>
      )
    case 'notify':
      return <input value={action.text ?? ''} placeholder={t('editor_text')} onChange={(e) => onChange({ ...action, text: e.target.value })} />
    case 'pause_bot':
      return (
        <input
          type="number"
          min={1}
          value={action.minutes ?? ''}
          placeholder="minutes"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            onChange(Number.isFinite(n) && n > 0 ? { type: 'pause_bot', minutes: n } : { type: 'pause_bot' })
          }}
        />
      )
    case 'webhook':
      return <input value={action.url} placeholder="https://" onChange={(e) => onChange({ ...action, url: e.target.value })} />
  }
}

function ActionBody({ step, onChange, steps, t }: BodyProps<'action'>) {
  const setAction = (i: number, a: Action) => onChange({ ...step, actions: step.actions.map((x, j) => (j === i ? a : x)) })
  return (
    <>
      <label>{t('editor_actions')}</label>
      {step.actions.map((a, i) => (
        <div className="list-item" key={i}>
          <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
            <select value={a.type} onChange={(e) => setAction(i, defaultAction(e.target.value as ActionType))} style={{ flex: 1, minWidth: 0 }}>
              {ACTION_TYPES.map((type) => (
                <option key={type} value={type}>{t(`action_${type}` as Key)}</option>
              ))}
            </select>
            <button className="btn small danger" disabled={step.actions.length <= 1} onClick={() => onChange({ ...step, actions: step.actions.filter((_, j) => j !== i) })}>×</button>
          </div>
          <ActionFields action={a} t={t} onChange={(na) => setAction(i, na)} />
        </div>
      ))}
      <button className="btn small" onClick={() => onChange({ ...step, actions: [...step.actions, defaultAction('add_tag')] })}>+ {t('editor_add_action')}</button>
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function DelayBody({ step, onChange, steps, t }: BodyProps<'delay'>) {
  return (
    <>
      <label>{t('editor_seconds')}</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          type="number"
          min={1}
          max={2592000}
          value={step.seconds}
          onChange={(e) => onChange({ ...step, seconds: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          style={{ maxWidth: 160 }}
        />
        <div className="chips" style={{ marginTop: 0 }}>
          {DELAY_PRESETS.map((p) => (
            <button key={p.seconds} type="button" className="chip" onClick={() => onChange({ ...step, seconds: p.seconds })}>{p.label}</button>
          ))}
        </div>
      </div>
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function RandomBody({ step, onChange, steps, t }: BodyProps<'random'>) {
  const total = step.branches.reduce((sum, b) => sum + (b.weight > 0 ? b.weight : 0), 0)
  const setBranch = (i: number, b: { weight: number; next?: string | null }) => onChange({ ...step, branches: step.branches.map((x, j) => (j === i ? b : x)) })
  return (
    <>
      <label>{t('editor_branches')}</label>
      {step.branches.map((b, i) => (
        <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
          <input type="number" min={0} value={b.weight} onChange={(e) => setBranch(i, { ...b, weight: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 90, flex: 'none' }} />
          <span className="small muted" style={{ width: 44, flex: 'none' }}>{total > 0 ? `${Math.round((Math.max(0, b.weight) / total) * 100)}%` : '—'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <StepSelect value={b.next} steps={steps} selfId={step.id} t={t} onChange={(next) => setBranch(i, { ...b, next })} />
          </div>
          <button className="btn small danger" disabled={step.branches.length <= 1} onClick={() => onChange({ ...step, branches: step.branches.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange({ ...step, branches: [...step.branches, { weight: 50, next: null }] })}>+</button>
    </>
  )
}

function GotoBody({ step, onChange, t, flows, currentId }: BodyProps<'goto'> & { flows: FlowRecord[]; currentId: number }) {
  return (
    <>
      <label>{t('editor_goto_flow')}</label>
      <select value={step.flowId || ''} onChange={(e) => onChange({ ...step, flowId: Number(e.target.value) || 0 })}>
        <option value="">—</option>
        {flows.filter((f) => f.id !== currentId).map((f) => (
          <option key={f.id} value={f.id}>#{f.id} {f.name}{f.status === 'live' ? '' : ` (${t('status_draft')})`}</option>
        ))}
      </select>
    </>
  )
}

function CommentReplyBody({ step, onChange, steps, t }: BodyProps<'comment_reply'>) {
  return (
    <>
      <label>{t('editor_text')}</label>
      <textarea value={step.text} maxLength={1000} onChange={(e) => onChange({ ...step, text: e.target.value })} />
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function StepBody({ step, onChange, steps, t, flows, currentId }: { step: Step; onChange: (s: Step) => void; steps: Step[]; t: TFn; flows: FlowRecord[]; currentId: number }) {
  switch (step.type) {
    case 'message': return <MessageBody step={step} onChange={onChange} steps={steps} t={t} />
    case 'question': return <QuestionBody step={step} onChange={onChange} steps={steps} t={t} />
    case 'condition': return <ConditionBody step={step} onChange={onChange} steps={steps} t={t} />
    case 'action': return <ActionBody step={step} onChange={onChange} steps={steps} t={t} />
    case 'delay': return <DelayBody step={step} onChange={onChange} steps={steps} t={t} />
    case 'random': return <RandomBody step={step} onChange={onChange} steps={steps} t={t} />
    case 'goto': return <GotoBody step={step} onChange={onChange} steps={steps} t={t} flows={flows} currentId={currentId} />
    case 'comment_reply': return <CommentReplyBody step={step} onChange={onChange} steps={steps} t={t} />
  }
}

/* ---------- Test panel ---------- */

function inputLabel(input: SimulatedInput, t: TFn): string {
  if (input.button) return input.button
  if (input.type === 'follow') return t('test_follow')
  return input.text ?? input.payload ?? input.ref ?? input.type
}

function TestPanel({ flowId, definition, defaultChannel, t }: { flowId: string; definition: FlowDefinition; defaultChannel: Channel; t: TFn }) {
  const [inputs, setInputs] = useState<SimulatedInput[]>([])
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [text, setText] = useState('')
  const [channel, setChannel] = useState<Channel>(defaultChannel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setChannel(defaultChannel), [defaultChannel])

  const run = async (next: SimulatedInput[], ch: Channel = channel) => {
    setInputs(next)
    setError('')
    if (next.length === 0) {
      setResult(null)
      return
    }
    setBusy(true)
    try {
      const r = await api.post<SimulationResult>(`/api/flows/${flowId}/test`, { inputs: next, channel: ch, newContact: true, definition })
      setResult(r)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const send = (input: SimulatedInput) => {
    void run([...inputs, input])
    if (input.text !== undefined) setText('')
  }

  const reset = () => {
    setInputs([])
    setResult(null)
    setError('')
    setText('')
  }

  const lastStep = result?.steps[result.steps.length - 1]

  return (
    <div className="card">
      <h2>{t('test_title')}</h2>
      <div className="small muted" style={{ marginBottom: 8 }}>{t('test_lead')}</div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <select
          value={channel}
          onChange={(e) => {
            const ch = e.target.value as Channel
            setChannel(ch)
            if (inputs.length) void run(inputs, ch)
          }}
          style={{ flex: 1 }}
        >
          {TEST_CHANNELS.map((c) => (
            <option key={c} value={c}>{t(`channel_${c}` as Key)}</option>
          ))}
        </select>
        <button className="btn small" onClick={reset}>{t('test_reset')}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0', maxHeight: '55vh', overflow: 'auto' }}>
        {result?.steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="bubble in">
              {inputLabel(s.input, t)}
              {s.input.type === 'comment' && <div className="meta">{t('test_comment')}</div>}
            </div>
            {!s.triggered && <div className="small muted">{t('test_not_triggered')}</div>}
            {s.outputs.map((o, j) => {
              const chips = [...(o.buttons ?? []), ...(o.quickReplies ?? [])]
              return (
                <div key={j} style={{ alignSelf: 'flex-end', maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  {(o.text || o.imageUrl) && (
                    <div className="bubble out" style={{ maxWidth: '100%' }}>
                      {o.imageUrl && <img src={o.imageUrl} alt="" style={{ maxWidth: 160, maxHeight: 120, borderRadius: 8, display: 'block', marginBottom: o.text ? 6 : 0 }} />}
                      {o.text}
                    </div>
                  )}
                  {chips.length > 0 && (
                    <div className="chips" style={{ justifyContent: 'flex-end' }}>
                      {chips.map((b, k) =>
                        b.url ? (
                          <a key={k} className="chip" href={b.url} target="_blank" rel="noreferrer">{b.label} ↗</a>
                        ) : (
                          <button key={k} type="button" className="chip" disabled={busy} onClick={() => send({ type: 'message', button: b.label })}>{b.label}</button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {s.commentReplies.map((c, j) => (
              <div key={`c${j}`} className="small muted" style={{ alignSelf: 'flex-end' }}>💬 {c}</div>
            ))}
          </div>
        ))}
        {busy && <div className="small muted">{t('loading')}</div>}
      </div>

      {error && <div className="alert error">{error}</div>}

      <input
        value={text}
        placeholder={t('test_placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim() && !busy) send({ type: 'message', text: text.trim() })
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small primary" disabled={busy || !text.trim()} onClick={() => send({ type: 'message', text: text.trim() })}>{t('test_message')}</button>
        <button className="btn small" disabled={busy || !text.trim()} onClick={() => send({ type: 'comment', text: text.trim() })}>{t('test_comment')}</button>
        <button className="btn small" disabled={busy} onClick={() => send({ type: 'follow' })}>{t('test_follow')}</button>
      </div>

      {result && (
        <div style={{ marginTop: 12 }}>
          {lastStep?.waiting === 'input' && <div className="badge">{t('test_waiting_input')}</div>}
          {lastStep?.waiting === 'button' && <div className="badge">{t('test_waiting_button')}</div>}
          {lastStep?.waiting && lastStep.waiting !== 'input' && lastStep.waiting !== 'button' && <div className="badge">{lastStep.waiting}</div>}
          <label>{t('test_result_fields')}</label>
          {Object.keys(result.fields).length === 0 ? (
            <div className="small muted">—</div>
          ) : (
            <div className="code-box small mono">
              {Object.entries(result.fields).map(([k, v]) => (
                <div key={k}>{k}: {JSON.stringify(v)}</div>
              ))}
            </div>
          )}
          <label>{t('test_result_tags')}</label>
          {result.tags.length === 0 ? (
            <div className="small muted">—</div>
          ) : (
            <div className="row">{result.tags.map((tag) => <span key={tag} className="badge tag">{tag}</span>)}</div>
          )}
          <label>{t('test_result_notifications')}</label>
          {result.notifications.length === 0 ? (
            <div className="small muted">—</div>
          ) : (
            result.notifications.map((n, i) => <div key={i} className="small">🔔 {n}</div>)
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Page ---------- */

export default function FlowEditor() {
  const t = useT()
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const [flow, setFlow] = useState<FlowRecord | null>(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<FlowChannel>('any')
  const [def, setDef] = useState<FlowDefinition>({ triggers: [], entry: null, steps: [] })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [allFlows, setAllFlows] = useState<FlowRecord[]>([])
  const [newStepType, setNewStepType] = useState<StepType>('message')

  useEffect(() => {
    setFlow(null)
    setLoadError('')
    api
      .get<{ flow: FlowRecord }>(`/api/flows/${id}`)
      .then((r) => {
        setFlow(r.flow)
        setName(r.flow.name)
        setChannel(r.flow.channel)
        setDef(r.flow.definition)
        setDirty(false)
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)))
    api
      .get<{ flows: FlowRecord[] }>('/api/flows')
      .then((r) => setAllFlows(r.flows))
      .catch(() => setAllFlows([]))
  }, [id])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const touch = () => {
    setDirty(true)
    setNotice('')
  }
  const updateDef = (fn: (d: FlowDefinition) => FlowDefinition) => {
    setDef(fn)
    touch()
  }

  /* triggers */
  const setTrigger = (i: number, tr: Trigger) => updateDef((d) => ({ ...d, triggers: d.triggers.map((x, j) => (j === i ? tr : x)) }))
  const addTrigger = () => updateDef((d) => ({ ...d, triggers: [...d.triggers, defaultTrigger('keyword')] }))
  const removeTrigger = (i: number) => updateDef((d) => ({ ...d, triggers: d.triggers.filter((_, j) => j !== i) }))

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
    setNotice('')
    setBusy(true)
    try {
      const r = await api.put<{ flow: FlowRecord; warnings: string[] }>(`/api/flows/${id}`, { name, channel, definition: def })
      setFlow(r.flow)
      setDef(r.flow.definition)
      setName(r.flow.name)
      setDirty(false)
      setWarnings(r.warnings ?? [])
      setNotice(t('saved'))
      return true
    } catch (err) {
      setError(errorMessage(err))
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
      setNotice(t('status_live'))
    } catch (err) {
      setError(errorMessage(err))
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
      setNotice(t('status_draft'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(t('confirmDelete'))) return
    setError('')
    try {
      await api.delete(`/api/flows/${id}`)
      setDirty(false)
      navigate('/flows')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (loadError) return <div className="alert error">{loadError}</div>
  if (!flow) return <div className="muted">{t('loading')}</div>

  const live = flow.status === 'live'

  return (
    <>
      <div className="page-title">
        <div className="row">
          <h1>{name || flow.name}</h1>
          <span className={`badge ${flow.status}`}>{live ? t('status_live') : t('status_draft')}</span>
          {dirty && <span className="small" style={{ color: 'var(--warn)' }}>● {t('editor_unsaved')}</span>}
        </div>
        <div className="row">
          <button className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>{t('save')}</button>
          {live ? (
            <button className="btn" disabled={busy} onClick={() => void unpublish()}>{t('editor_unpublish')}</button>
          ) : (
            <button className="btn" disabled={busy} onClick={() => void publish()}>{t('editor_publish')}</button>
          )}
          <button className="btn danger" disabled={busy} onClick={() => void remove()}>{t('delete')}</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {warnings.length > 0 && <div className="alert warn"><strong>{t('editor_warnings')}</strong>{'\n'}{warnings.join('\n')}</div>}
      {notice && !error && <div className="alert ok">{notice}</div>}

      <div className="editor">
        <div style={{ minWidth: 0 }}>
          <div className="card">
            <div className="inline-fields">
              <div>
                <label>{t('editor_name')}</label>
                <input value={name} onChange={(e) => (setName(e.target.value), touch())} />
              </div>
              <div>
                <label>{t('editor_channel')}</label>
                <select value={channel} onChange={(e) => (setChannel(e.target.value as FlowChannel), touch())}>
                  {FLOW_CHANNELS.map((c) => (
                    <option key={c} value={c}>{t(`channel_${c}` as Key)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>{t('editor_triggers')}</h2>
            {def.triggers.map((tr, i) => (
              <TriggerCard key={i} trigger={tr} t={t} onChange={(ntr) => setTrigger(i, ntr)} onRemove={() => removeTrigger(i)} />
            ))}
            <button className="btn small" onClick={addTrigger}>+ {t('editor_add_trigger')}</button>
          </div>

          <div className="card">
            <h2>{t('editor_steps')}</h2>
            <div className="small muted" style={{ marginBottom: 8 }}>{t('editor_placeholders')}</div>
            <label>{t('editor_entry')}</label>
            <StepSelect value={def.entry} steps={def.steps} t={t} allowEnd={false} onChange={(entry) => updateDef((d) => ({ ...d, entry }))} />
            <div style={{ height: 12 }} />
            {def.steps.map((s, i) => (
              <div className="step-card" key={s.id + ':' + i}>
                <div className="head">
                  <span className="id">{s.id}</span>
                  {def.entry === s.id && <span className="badge live">{t('editor_entry')}</span>}
                  <select value={s.type} onChange={(e) => setStep(i, changeStepType(s, e.target.value as StepType))} style={{ width: 'auto', flex: 1, minWidth: 140 }}>
                    {STEP_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`step_${type}` as Key)}</option>
                    ))}
                  </select>
                  <button className="btn small" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="up">↑</button>
                  <button className="btn small" disabled={i === def.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="down">↓</button>
                  <button className="btn small danger" onClick={() => removeStep(i)}>{t('delete')}</button>
                </div>
                <StepBody step={s} steps={def.steps} t={t} flows={allFlows} currentId={flow.id} onChange={(ns) => setStep(i, ns)} />
              </div>
            ))}
            <div className="row">
              <select value={newStepType} onChange={(e) => setNewStepType(e.target.value as StepType)} style={{ width: 'auto' }}>
                {STEP_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`step_${type}` as Key)}</option>
                ))}
              </select>
              <button className="btn small" onClick={addStep}>+ {t('editor_add_step')}</button>
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <TestPanel flowId={id} definition={def} defaultChannel={channel === 'any' ? 'line' : channel} t={t} />
        </div>
      </div>
    </>
  )
}
