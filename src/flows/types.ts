import type { Channel } from '../channels/types'
import type { InputValidation } from './inputs'

/** When an automation starts. */
export type Trigger =
  | { type: 'keyword'; keywords: string[]; match?: 'contains' | 'exact' | 'starts_with' }
  | { type: 'comment'; keywords?: string[]; excludeKeywords?: string[]; postIds?: string[]; like?: boolean }
  | { type: 'first_message' }
  | { type: 'follow' }
  | { type: 'any_message'; cooldownHours?: number }
  | { type: 'ref'; ref: string }
  | { type: 'postback'; payload: string }
  | { type: 'story_mention' }
  | { type: 'story_reply' }

export type ConditionRule = {
  /** Field name on the contact, "tag" (with has_tag), or a special field handled in rules.ts ruleValue. */
  field: string
  op: 'equals' | 'not_equals' | 'contains' | 'has_tag' | 'not_has_tag' | 'is_set' | 'is_empty' | 'gt' | 'gte' | 'lt' | 'lte'
  value?: string
}

export type Action =
  | { type: 'add_tag'; tag: string }
  | { type: 'remove_tag'; tag: string }
  | { type: 'set_field'; field: string; value: string }
  | { type: 'notify'; text?: string }
  | { type: 'pause_bot'; minutes?: number }
  | { type: 'webhook'; url: string }

export type ButtonDef = { label: string; next?: string | null; url?: string }

export type Step =
  | { id: string; type: 'message'; text: string; imageUrl?: string; buttons?: ButtonDef[]; next?: string | null }
  | { id: string; type: 'question'; text: string; field: string; choices?: string[]; validate?: InputValidation; retryText?: string; skipLabel?: string; next?: string | null }
  | { id: string; type: 'condition'; rules: ConditionRule[]; mode?: 'all' | 'any'; yes?: string | null; no?: string | null }
  | { id: string; type: 'action'; actions: Action[]; next?: string | null }
  | { id: string; type: 'delay'; seconds: number; next?: string | null }
  | { id: string; type: 'random'; branches: { weight: number; next?: string | null }[] }
  | { id: string; type: 'goto'; flowId: number }
  | { id: string; type: 'comment_reply'; text: string; texts?: string[]; next?: string | null }

export type FlowDefinition = {
  triggers: Trigger[]
  /** Id of the first step. */
  entry: string | null
  steps: Step[]
}

export type FlowRecord = {
  id: number
  name: string
  channel: Channel | 'any'
  status: 'draft' | 'live'
  definition: FlowDefinition
  createdAt: string
  updatedAt: string
}

export const STEP_TYPES = ['message', 'question', 'condition', 'action', 'delay', 'random', 'goto', 'comment_reply'] as const
export const TRIGGER_TYPES = ['keyword', 'comment', 'first_message', 'follow', 'any_message', 'ref', 'postback', 'story_mention', 'story_reply'] as const
