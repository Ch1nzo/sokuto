import { Badge, Button, HStack, SegmentedControl, SegmentedControlItem, Tag, Text, TextField, VStack } from '@channel.io/bezier-react'
import { ArrowDownIcon, ArrowUpIcon, CancelIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { Action, ButtonDef, ConditionRule, FlowRecord, Step } from '@shared/flows/types'
import type { Key } from '../../lib/i18n'
import { SelectField, SelectInput, TextAreaField, TextInputField } from '../../components'
import { AddButton, IconBtn, ListInputField, StepPicker } from './fields'
import {
  ACTION_TYPES,
  DELAY_PRESETS,
  MAX_BUTTONS,
  MAX_BUTTON_LABEL,
  MAX_CHOICE_LABEL,
  OPS_WITHOUT_VALUE,
  RULE_OPS,
  STEP_TYPES,
  changeStepType,
  defaultAction,
  type ActionType,
  type StepOf,
  type StepType,
  type TFn,
} from './model'

type BodyProps<T extends StepType> = { step: StepOf<T>; onChange: (s: Step) => void; steps: Step[]; t: TFn }

function NextField({ step, onChange, steps, t }: { step: Step & { next?: string | null }; onChange: (s: Step) => void; steps: Step[]; t: TFn }) {
  return <StepPicker label={t('editor_next')} value={step.next} steps={steps} selfId={step.id} t={t} onChange={(next) => onChange({ ...step, next } as Step)} />
}

/** Integer input for TextField type=number (returns NaN-safe values through `parse`). */
function NumberInput({ value, onChange, min, max, ariaLabel, className }: { value: number | undefined; onChange: (raw: string) => void; min?: number; max?: number; ariaLabel?: string; className?: string }) {
  return <TextField className={className} type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
}

function MessageBody({ step, onChange, steps, t }: BodyProps<'message'>) {
  const buttons = step.buttons ?? []
  const setButtons = (bs: ButtonDef[]) => onChange({ ...step, buttons: bs.length ? bs : undefined })
  const setButton = (i: number, b: ButtonDef) => setButtons(buttons.map((x, j) => (j === i ? b : x)))
  return (
    <>
      <TextAreaField label={t('editor_text')} value={step.text} maxLength={2000} onChange={(e) => onChange({ ...step, text: e.target.value })} />
      <TextInputField label={t('editor_image')} type="url" value={step.imageUrl ?? ''} placeholder="https://" onChange={(e) => onChange({ ...step, imageUrl: e.target.value || undefined })} />
      <VStack spacing={8}>
        <Text typo="13" bold color="txt-black-darker">
          {t('editor_buttons')} <span className="fe-count">({buttons.length}/{MAX_BUTTONS})</span>
        </Text>
        {buttons.map((b, i) => (
          <div className="fe-subitem" key={i}>
            <div className="fe-grid-2">
              <TextInputField
                label={t('editor_button_label')}
                helperText={`${b.label.length}/${MAX_BUTTON_LABEL}`}
                value={b.label}
                maxLength={MAX_BUTTON_LABEL}
                onChange={(e) => setButton(i, { ...b, label: e.target.value })}
              />
              <TextInputField
                label={t('editor_button_url')}
                type="url"
                value={b.url ?? ''}
                placeholder="https://"
                onChange={(e) => {
                  const url = e.target.value
                  setButton(i, url ? { label: b.label, url } : { label: b.label, next: b.next ?? null })
                }}
              />
            </div>
            <HStack spacing={8} align="end">
              <div className="fe-grow">{!b.url && <StepPicker label={t('editor_next')} value={b.next} steps={steps} t={t} onChange={(next) => setButton(i, { ...b, next })} />}</div>
              <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${b.label || t('editor_button_label')}`} onClick={() => setButtons(buttons.filter((_, j) => j !== i))} />
            </HStack>
          </div>
        ))}
        <div>
          <AddButton text={t('editor_add_button')} disabled={buttons.length >= MAX_BUTTONS} onClick={() => setButtons([...buttons, { label: '', next: null }])} />
        </div>
      </VStack>
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function QuestionBody({ step, onChange, steps, t }: BodyProps<'question'>) {
  const tooLong = (step.choices ?? []).filter((c) => c.length > MAX_CHOICE_LABEL)
  const problem = (step.choices?.length ?? 0) > MAX_BUTTONS || tooLong.length > 0
  return (
    <>
      <TextAreaField label={t('editor_text')} value={step.text} maxLength={2000} onChange={(e) => onChange({ ...step, text: e.target.value })} />
      <div className="fe-grid-2">
        <TextInputField label={t('editor_field')} value={step.field} placeholder="phone" onChange={(e) => onChange({ ...step, field: e.target.value.replace(/\s/g, '') })} />
        <ListInputField
          label={t('editor_choices')}
          value={step.choices ?? []}
          onChange={(choices) => onChange({ ...step, choices: choices.length ? choices : undefined })}
          helperText={problem ? undefined : `≤ ${MAX_BUTTONS} × ≤ ${MAX_CHOICE_LABEL}`}
        />
      </div>
      {problem && (
        <Text typo="12" color="bgtxt-orange-normal" className="fe-wrap">
          ≤ {MAX_BUTTONS} × ≤ {MAX_CHOICE_LABEL}
          {tooLong.length > 0 ? `: ${tooLong.join(', ')}` : ''}
        </Text>
      )}
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function ConditionBody({ step, onChange, steps, t }: BodyProps<'condition'>) {
  const setRule = (i: number, r: ConditionRule) => onChange({ ...step, rules: step.rules.map((x, j) => (j === i ? r : x)) })
  return (
    <>
      <VStack spacing={8}>
        <Text typo="13" bold color="txt-black-darker">
          {t('editor_rules')}
        </Text>
        {step.rules.map((r, i) => {
          const noValue = OPS_WITHOUT_VALUE.includes(r.op)
          return (
            <div className={noValue ? 'fe-rule fe-rule--novalue' : 'fe-rule'} key={i}>
              <TextField className="fe-rule__field" value={r.field} placeholder="tag / channel / last_input / field" aria-label={t('editor_rule_field')} onChange={(e) => setRule(i, { ...r, field: e.target.value })} />
              <div className="fe-rule__op">
                <SelectInput
                  aria-label={t('editor_rule_op')}
                  value={r.op}
                  options={RULE_OPS.map((op) => ({ value: op, label: op }))}
                  onChange={(op) => setRule(i, OPS_WITHOUT_VALUE.includes(op) ? { field: r.field, op } : { ...r, op, value: r.value ?? '' })}
                />
              </div>
              {!noValue && <TextField className="fe-rule__value" value={r.value ?? ''} aria-label={t('editor_value')} placeholder={t('editor_value')} onChange={(e) => setRule(i, { ...r, value: e.target.value })} />}
              <div className="fe-rule__remove">
                <IconBtn icon={CancelIcon} label={t('delete')} disabled={step.rules.length <= 1} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })} />
              </div>
            </div>
          )
        })}
        <HStack spacing={8} justify="between" wrap>
          <AddButton text={t('editor_add_rule')} onClick={() => onChange({ ...step, rules: [...step.rules, { field: '', op: 'equals', value: '' }] })} />
          <SegmentedControl type="radiogroup" size="s" width={260} value={step.mode ?? 'all'} onValueChange={(mode: 'all' | 'any') => onChange({ ...step, mode })} aria-label={t('editor_rules')}>
            <SegmentedControlItem value="all">{t('editor_mode_all')}</SegmentedControlItem>
            <SegmentedControlItem value="any">{t('editor_mode_any')}</SegmentedControlItem>
          </SegmentedControl>
        </HStack>
      </VStack>
      <div className="fe-grid-2">
        <StepPicker label={t('editor_yes')} value={step.yes} steps={steps} selfId={step.id} t={t} onChange={(yes) => onChange({ ...step, yes })} />
        <StepPicker label={t('editor_no')} value={step.no} steps={steps} selfId={step.id} t={t} onChange={(no) => onChange({ ...step, no })} />
      </div>
    </>
  )
}

function ActionFields({ action, onChange, t }: { action: Action; onChange: (a: Action) => void; t: TFn }) {
  switch (action.type) {
    case 'add_tag':
    case 'remove_tag':
      return <TextInputField label={t('test_result_tags')} value={action.tag} onChange={(e) => onChange({ ...action, tag: e.target.value })} />
    case 'set_field':
      return (
        <div className="fe-grid-2">
          <TextInputField label={t('test_result_fields')} value={action.field} onChange={(e) => onChange({ ...action, field: e.target.value })} />
          <TextInputField label={t('editor_value')} value={action.value} onChange={(e) => onChange({ ...action, value: e.target.value })} />
        </div>
      )
    case 'notify':
      return <TextInputField label={t('editor_text')} value={action.text ?? ''} onChange={(e) => onChange({ ...action, text: e.target.value })} />
    case 'pause_bot':
      return (
        <TextInputField
          label={t('editor_minutes')}
          type="number"
          inputMode="numeric"
          min={1}
          value={action.minutes ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            onChange(Number.isFinite(n) && n > 0 ? { type: 'pause_bot', minutes: n } : { type: 'pause_bot' })
          }}
        />
      )
    case 'webhook':
      return <TextInputField label="URL" type="url" value={action.url} placeholder="https://" onChange={(e) => onChange({ ...action, url: e.target.value })} />
  }
}

function ActionBody({ step, onChange, steps, t }: BodyProps<'action'>) {
  const setAction = (i: number, a: Action) => onChange({ ...step, actions: step.actions.map((x, j) => (j === i ? a : x)) })
  return (
    <>
      <VStack spacing={8}>
        <Text typo="13" bold color="txt-black-darker">
          {t('editor_actions')}
        </Text>
        {step.actions.map((a, i) => (
          <div className="fe-subitem" key={i}>
            <HStack spacing={8} align="center">
              <div className="fe-grow">
                <SelectInput
                  aria-label={t('editor_actions')}
                  value={a.type}
                  options={ACTION_TYPES.map((type) => ({ value: type, label: t(`action_${type}` as Key) }))}
                  onChange={(type: ActionType) => setAction(i, defaultAction(type))}
                />
              </div>
              <IconBtn icon={CancelIcon} label={t('delete')} disabled={step.actions.length <= 1} onClick={() => onChange({ ...step, actions: step.actions.filter((_, j) => j !== i) })} />
            </HStack>
            <ActionFields action={a} t={t} onChange={(na) => setAction(i, na)} />
          </div>
        ))}
        <div>
          <AddButton text={t('editor_add_action')} onClick={() => onChange({ ...step, actions: [...step.actions, defaultAction('add_tag')] })} />
        </div>
      </VStack>
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function DelayBody({ step, onChange, steps, t }: BodyProps<'delay'>) {
  return (
    <>
      <VStack spacing={6}>
        <Text typo="13" bold color="txt-black-darker">
          {t('editor_seconds')}
        </Text>
        <div className="fe-delay">
          <NumberInput className="fe-delay__input" ariaLabel={t('editor_seconds')} min={1} max={2592000} value={step.seconds} onChange={(raw) => onChange({ ...step, seconds: Math.max(0, parseInt(raw, 10) || 0) })} />
          <div className="fe-delay__presets" role="group" aria-label={t('editor_seconds')}>
            {DELAY_PRESETS.map((p) => (
              <Button
                key={p.seconds}
                size="s"
                styleVariant={step.seconds === p.seconds ? 'primary' : 'secondary'}
                colorVariant={step.seconds === p.seconds ? 'blue' : 'monochrome-dark'}
                text={p.label}
                aria-pressed={step.seconds === p.seconds}
                onClick={() => onChange({ ...step, seconds: p.seconds })}
              />
            ))}
          </div>
        </div>
      </VStack>
      <NextField step={step} onChange={onChange} steps={steps} t={t} />
    </>
  )
}

function RandomBody({ step, onChange, steps, t }: BodyProps<'random'>) {
  const total = step.branches.reduce((sum, b) => sum + (b.weight > 0 ? b.weight : 0), 0)
  const setBranch = (i: number, b: { weight: number; next?: string | null }) => onChange({ ...step, branches: step.branches.map((x, j) => (j === i ? b : x)) })
  return (
    <VStack spacing={8}>
      <Text typo="13" bold color="txt-black-darker">
        {t('editor_branches')}
      </Text>
      {step.branches.map((b, i) => (
        <div className="fe-branch" key={i}>
          <NumberInput className="fe-branch__weight" ariaLabel={`${t('editor_branches')} ${i + 1}`} min={0} value={b.weight} onChange={(raw) => setBranch(i, { ...b, weight: Math.max(0, Number(raw) || 0) })} />
          <Badge size="m" variant="monochrome-light" className="fe-branch__pct">
            {total > 0 ? `${Math.round((Math.max(0, b.weight) / total) * 100)}%` : '—'}
          </Badge>
          <div className="fe-branch__next">
            <StepPicker value={b.next} steps={steps} selfId={step.id} t={t} ariaLabel={`${t('editor_next')} ${i + 1}`} onChange={(next) => setBranch(i, { ...b, next })} />
          </div>
          <IconBtn icon={CancelIcon} label={t('delete')} disabled={step.branches.length <= 1} onClick={() => onChange({ ...step, branches: step.branches.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <div>
        <AddButton text={t('editor_add_branch')} onClick={() => onChange({ ...step, branches: [...step.branches, { weight: 50, next: null }] })} />
      </div>
    </VStack>
  )
}

function GotoBody({ step, onChange, t, flows, currentId }: BodyProps<'goto'> & { flows: FlowRecord[]; currentId: number }) {
  const options = [
    { value: '', label: '—' },
    ...flows.filter((f) => f.id !== currentId).map((f) => ({ value: String(f.id), label: `#${f.id} ${f.name}${f.status === 'live' ? '' : ` (${t('status_draft')})`}` })),
  ]
  return <SelectField label={t('editor_goto_flow')} value={step.flowId ? String(step.flowId) : ''} options={options} onChange={(v) => onChange({ ...step, flowId: Number(v) || 0 })} />
}

function CommentReplyBody({ step, onChange, steps, t }: BodyProps<'comment_reply'>) {
  return (
    <>
      <TextAreaField label={t('editor_text')} value={step.text} maxLength={1000} helperText={`${step.text.length}/1000`} onChange={(e) => onChange({ ...step, text: e.target.value })} />
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

export function StepCard({
  step,
  index,
  count,
  isEntry,
  steps,
  flows,
  currentId,
  onChange,
  onMove,
  onRemove,
  t,
}: {
  step: Step
  index: number
  count: number
  isEntry: boolean
  steps: Step[]
  flows: FlowRecord[]
  currentId: number
  onChange: (s: Step) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
  t: TFn
}) {
  return (
    <section className="fe-item fe-step" aria-label={`${step.id} · ${t(`step_${step.type}` as Key)}`}>
      <div className="fe-step__head">
        <div className="fe-step__meta">
          <Tag size="m" variant="monochrome-dark" className="fe-mono">
            {step.id}
          </Tag>
          {isEntry && (
            <Badge size="m" variant="green">
              {t('editor_entry')}
            </Badge>
          )}
        </div>
        <div className="fe-step__type">
          <SelectInput
            aria-label={t('editor_step_type')}
            value={step.type}
            options={STEP_TYPES.map((type) => ({ value: type, label: t(`step_${type}` as Key) }))}
            onChange={(type: StepType) => onChange(changeStepType(step, type))}
          />
        </div>
        <div className="fe-step__tools">
          <IconBtn icon={ArrowUpIcon} label={t('editor_move_up')} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconBtn icon={ArrowDownIcon} label={t('editor_move_down')} disabled={index === count - 1} onClick={() => onMove(1)} />
          <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${step.id}`} onClick={onRemove} />
        </div>
      </div>
      <StepBody step={step} steps={steps} t={t} flows={flows} currentId={currentId} onChange={onChange} />
    </section>
  )
}
