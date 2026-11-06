import type { useT } from '../../lib/i18n'
import type { Action, AttachmentDef, ButtonDef, ConditionRule, FlowRecord, Step, Trigger } from '@shared/flows/types'
import type { Channel, OutboundMessage } from '@shared/channels/types'

/* ---------- Local mirrors of server-only types (src/flows/simulate.ts pulls runtime deps) ---------- */

export type SimulatedInput = { type: 'start' | 'message' | 'comment' | 'follow' | 'postback' | 'ref' | 'story_mention' | 'story_reply'; text?: string; payload?: string; ref?: string; button?: string }
export type SimulationStep = { input: SimulatedInput; triggered: boolean; outputs: OutboundMessage[]; commentReplies: string[]; waiting: string | null; stepId: string | null }
export type SimulationResult = { steps: SimulationStep[]; fields: Record<string, string>; tags: string[]; notifications: string[]; notes: string[]; completed: boolean }

export type FlowChannel = FlowRecord['channel']
export type StepType = Step['type']
export type TriggerType = Trigger['type']
export type ActionType = Action['type']
export type MatchType = NonNullable<Extract<Trigger, { type: 'keyword' }>['match']>
export type ValidateType = NonNullable<Extract<Step, { type: 'question' }>['validate']>
export type StepOf<T extends StepType> = Extract<Step, { type: T }>
export type TFn = ReturnType<typeof useT>

export const STEP_TYPES: StepType[] = ['message', 'question', 'condition', 'action', 'delay', 'random', 'goto', 'comment_reply', 'request', 'ai']
export const SEQUENCE_STEP_TYPES: StepType[] = ['message', 'condition', 'action', 'delay', 'random', 'request']
export const TRIGGER_TYPES: TriggerType[] = ['keyword', 'comment', 'first_message', 'follow', 'any_message', 'ref', 'postback', 'story_mention', 'story_reply', 'intent']
export const ACTION_TYPES: ActionType[] = ['add_tag', 'remove_tag', 'set_field', 'notify', 'pause_bot', 'webhook', 'subscribe', 'unsubscribe']
export const MATCH_TYPES: MatchType[] = ['contains', 'exact', 'starts_with']
export const VALIDATE_TYPES: ValidateType[] = ['email', 'phone', 'number', 'url', 'date']
export const RULE_OPS: ConditionRule['op'][] = ['equals', 'not_equals', 'contains', 'has_tag', 'not_has_tag', 'is_set', 'is_empty', 'gt', 'gte', 'lt', 'lte']
export const OPS_WITHOUT_VALUE: ConditionRule['op'][] = ['is_set', 'is_empty']
export const FLOW_CHANNELS: FlowChannel[] = ['any', 'line', 'messenger', 'instagram']
export const TEST_CHANNELS: Channel[] = ['line', 'messenger', 'instagram']
export const DELAY_PRESETS: { seconds: number; label: string }[] = [
  { seconds: 3, label: '3s' },
  { seconds: 5, label: '5s' },
  { seconds: 60, label: '1m' },
  { seconds: 300, label: '5m' },
  { seconds: 3600, label: '1h' },
  { seconds: 86400, label: '1d' },
]
export const MAX_BUTTONS = 13
export const MAX_BUTTON_LABEL = 40
export const MAX_CHOICE_LABEL = 20
export const MAX_REPLY_VARIANTS = 4
export const MAX_REQUEST_SAVES = 10
export const MAX_CARDS = 10
export const MAX_CARD_BUTTONS = 3
export const MAX_CARD_TITLE = 40
export const MAX_CARD_SUBTITLE = 60
export const ATTACHMENT_TYPES: AttachmentDef['type'][] = ['video', 'audio', 'file']

const ID_PREFIX: Record<StepType, string> = { message: 'm', question: 'q', condition: 'c', action: 'a', delay: 'd', random: 'r', goto: 'g', comment_reply: 'cr', request: 'rq', ai: 'ai' }

/* ---------- Pure helpers ---------- */

export const splitList = (s: string): string[] => s.split(/[,、]/).map((x) => x.trim()).filter(Boolean)

export function newStepId(steps: Step[], type: StepType): string {
  const used = new Set(steps.map((s) => s.id))
  let n = 1
  while (used.has(`${ID_PREFIX[type]}${n}`)) n++
  return `${ID_PREFIX[type]}${n}`
}

export function defaultStep(type: StepType, id: string): Step {
  switch (type) {
    case 'message': return { id, type, text: '', next: null }
    case 'question': return { id, type, text: '', field: '', next: null }
    case 'condition': return { id, type, rules: [{ field: 'tag', op: 'has_tag', value: '' }], mode: 'all', yes: null, no: null }
    case 'action': return { id, type, actions: [{ type: 'add_tag', tag: '' }], next: null }
    case 'delay': return { id, type, seconds: 60, next: null }
    case 'random': return { id, type, branches: [{ weight: 50, next: null }, { weight: 50, next: null }] }
    case 'goto': return { id, type, flowId: 0 }
    case 'comment_reply': return { id, type, text: '', next: null }
    case 'request': return { id, type, method: 'GET', url: '', next: null }
    case 'ai': return { id, type, instructions: '', maxTurns: 5, next: null }
  }
}

export function defaultTrigger(type: TriggerType): Trigger {
  switch (type) {
    case 'keyword': return { type, keywords: [], match: 'contains' }
    case 'comment': return { type, keywords: [], postIds: [] }
    case 'ref': return { type, ref: '' }
    case 'postback': return { type, payload: '' }
    case 'intent': return { type, description: '', examples: [] }
    default: return { type }
  }
}

export function defaultAction(type: ActionType): Action {
  switch (type) {
    case 'add_tag':
    case 'remove_tag': return { type, tag: '' }
    case 'set_field': return { type, field: '', value: '' }
    case 'notify': return { type, text: '' }
    case 'pause_bot': return { type }
    case 'webhook': return { type, url: '' }
    case 'subscribe':
    case 'unsubscribe': return { type, flowId: 0 }
  }
}

function stepNext(s: Step): string | null {
  return 'next' in s ? s.next ?? null : null
}

/** Change a step's type, keeping its id and its "next" pointer where both types have one. */
export function changeStepType(s: Step, type: StepType): Step {
  const fresh = defaultStep(type, s.id)
  const next = stepNext(s)
  return 'next' in fresh ? ({ ...fresh, next } as Step) : fresh
}

/** Replace every pointer to `removedId` in a step with null. */
export function clearRefs(s: Step, removedId: string): Step {
  const fix = (v: string | null | undefined) => (v === removedId ? null : v)
  const fixButtons = (bs: ButtonDef[]) => bs.map((b) => ('next' in b ? { ...b, next: fix(b.next) } : b))
  switch (s.type) {
    case 'message':
      return { ...s, next: fix(s.next), buttons: s.buttons && fixButtons(s.buttons), cards: s.cards?.map((c) => ({ ...c, buttons: fixButtons(c.buttons) })) }
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

export function stepSummary(s: Step): string {
  const text = 'text' in s ? s.text : 'url' in s ? s.url : 'instructions' in s ? s.instructions : ''
  return text.length > 20 ? `${text.slice(0, 20)}…` : text
}
