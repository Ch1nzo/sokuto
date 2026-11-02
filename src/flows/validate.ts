import { z } from 'zod'
import type { FlowDefinition } from './types'

const next = z.string().nullable().optional()

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keyword'), keywords: z.array(z.string().min(1)).min(1), match: z.enum(['contains', 'exact', 'starts_with']).optional() }),
  z.object({ type: z.literal('comment'), keywords: z.array(z.string()).optional(), postIds: z.array(z.string()).optional() }),
  z.object({ type: z.literal('first_message') }),
  z.object({ type: z.literal('follow') }),
  z.object({ type: z.literal('any_message') }),
  z.object({ type: z.literal('ref'), ref: z.string().min(1) }),
  z.object({ type: z.literal('postback'), payload: z.string().min(1) }),
  z.object({ type: z.literal('story_mention') }),
  z.object({ type: z.literal('story_reply') }),
])

const ruleSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['equals', 'not_equals', 'contains', 'has_tag', 'not_has_tag', 'is_set', 'is_empty', 'gt', 'gte', 'lt', 'lte']),
  value: z.string().optional(),
})

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_tag'), tag: z.string().min(1) }),
  z.object({ type: z.literal('remove_tag'), tag: z.string().min(1) }),
  z.object({ type: z.literal('set_field'), field: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal('notify'), text: z.string().optional() }),
  z.object({ type: z.literal('pause_bot'), minutes: z.number().int().positive().optional() }),
  z.object({ type: z.literal('webhook'), url: z.string().url() }),
])

const buttonSchema = z.object({ label: z.string().min(1).max(40), next, url: z.string().url().optional() })

const stepSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('message'), text: z.string().max(2000).default(''), imageUrl: z.string().url().optional().or(z.literal('')), buttons: z.array(buttonSchema).max(13).optional(), next }),
  z.object({ id: z.string().min(1), type: z.literal('question'), text: z.string().min(1).max(2000), field: z.string().min(1).regex(/^[\w.-]+$/), choices: z.array(z.string().min(1).max(20)).max(13).optional(), next }),
  z.object({ id: z.string().min(1), type: z.literal('condition'), rules: z.array(ruleSchema).min(1), mode: z.enum(['all', 'any']).optional(), yes: next, no: next }),
  z.object({ id: z.string().min(1), type: z.literal('action'), actions: z.array(actionSchema).min(1), next }),
  z.object({ id: z.string().min(1), type: z.literal('delay'), seconds: z.number().int().min(1).max(60 * 60 * 24 * 30), next }),
  z.object({ id: z.string().min(1), type: z.literal('random'), branches: z.array(z.object({ weight: z.number().min(0), next })).min(1) }),
  z.object({ id: z.string().min(1), type: z.literal('goto'), flowId: z.number().int().positive() }),
  z.object({ id: z.string().min(1), type: z.literal('comment_reply'), text: z.string().min(1).max(1000), next }),
])

export const flowDefinitionSchema = z.object({
  triggers: z.array(triggerSchema),
  entry: z.string().nullable(),
  steps: z.array(stepSchema).max(200),
})

export const flowChannelSchema = z.enum(['any', 'line', 'messenger', 'instagram'])

/** Validates structure and referential integrity. Returns the parsed definition or a list of problems. */
export function validateFlow(input: unknown): { ok: true; definition: FlowDefinition; warnings: string[] } | { ok: false; errors: string[] } {
  const parsed = flowDefinitionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  const def = parsed.data as FlowDefinition
  const errors: string[] = []
  const warnings: string[] = []
  const ids = new Set<string>()
  for (const s of def.steps) {
    if (ids.has(s.id)) errors.push(`duplicate step id "${s.id}"`)
    ids.add(s.id)
  }
  const check = (ref: string | null | undefined, where: string) => {
    if (ref && !ids.has(ref)) errors.push(`${where} points to unknown step "${ref}"`)
  }
  if (def.entry) check(def.entry, 'entry')
  else if (def.steps.length > 0) errors.push('entry must name the first step')
  for (const s of def.steps) {
    switch (s.type) {
      case 'message':
        check(s.next, `step ${s.id}.next`)
        s.buttons?.forEach((b, i) => check(b.next, `step ${s.id}.buttons[${i}].next`))
        if (!s.text && !s.imageUrl) errors.push(`step ${s.id}: message needs text or imageUrl`)
        break
      case 'question':
        check(s.next, `step ${s.id}.next`)
        break
      case 'condition':
        check(s.yes, `step ${s.id}.yes`)
        check(s.no, `step ${s.id}.no`)
        break
      case 'action':
      case 'delay':
      case 'comment_reply':
        check(s.next, `step ${s.id}.next`)
        break
      case 'random':
        s.branches.forEach((b, i) => check(b.next, `step ${s.id}.branches[${i}].next`))
        break
    }
  }
  if (def.triggers.length === 0) warnings.push('no triggers: the flow can only be started by a button or goto')
  if (def.triggers.some((t) => t.type === 'comment') && !def.steps.some((s) => s.type === 'comment_reply')) warnings.push('comment trigger without a comment_reply step: consider a public reply')
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, definition: def, warnings }
}

/** Human-readable description of the flow JSON for AI assistants (MCP get_flow_schema). */
export const FLOW_SCHEMA_DOC = `A flow definition is a JSON object: { "triggers": Trigger[], "entry": stepId | null, "steps": Step[] }.
Steps are a graph: each step names the next step id (or null to end). Use short ids like "m1", "q1", "c1".

Triggers (when the flow starts):
- { "type": "keyword", "keywords": ["価格","price"], "match": "contains"|"exact"|"starts_with" }  message containing a keyword
- { "type": "comment", "keywords": [...]?, "postIds": [...]? }  a comment on a Facebook/Instagram post (optionally only with keywords / on given posts)
- { "type": "first_message" }  the person's very first message
- { "type": "follow" }  LINE follow (friend add)
- { "type": "any_message" }  fallback for every message
- { "type": "ref", "ref": "campaign1" }  referral link / QR (m.me/<page>?ref=campaign1, ig.me, LINE)
- { "type": "postback", "payload": "..." }  a button payload
- { "type": "story_mention" } / { "type": "story_reply" }  Instagram stories

Steps:
- { "id", "type": "message", "text": "Hi {{first_name}}!", "imageUrl"?: "https://...", "buttons"?: [{ "label": "注文", "next": "q1" } | { "label": "詳細", "url": "https://..." }], "next"?: stepId }
  Buttons with "next" wait for the tap. Without buttons the flow continues to "next" immediately.
- { "id", "type": "question", "text": "電話番号は?", "field": "phone", "choices"?: ["1","2","3"], "next": stepId }  waits for the answer and saves it to the contact field
- { "id", "type": "condition", "rules": [{ "field": "rating", "op": "lte", "value": "2" }], "mode"?: "all"|"any", "yes": stepId, "no": stepId }
  ops: equals, not_equals, contains, has_tag, not_has_tag, is_set, is_empty, gt, gte, lt, lte. Special fields: "channel", "last_input", "name".
- { "id", "type": "action", "actions": [{ "type": "add_tag", "tag": "interested" }, { "type": "remove_tag", "tag": "x" }, { "type": "set_field", "field": "f", "value": "v" }, { "type": "notify", "text": "..." }, { "type": "pause_bot", "minutes"?: 60 }, { "type": "webhook", "url": "https://..." }], "next": stepId }
- { "id", "type": "delay", "seconds": 3600, "next": stepId }
- { "id", "type": "random", "branches": [{ "weight": 1, "next": "a" }, { "weight": 1, "next": "b" }] }
- { "id", "type": "goto", "flowId": 12 }
- { "id", "type": "comment_reply", "text": "DMを送りました ✓", "next": stepId }  public reply under the triggering comment (comment trigger only)

Placeholders in text: {{name}}, {{first_name}}, {{username}}, {{last_input}}, {{<field>}} e.g. {{phone}}.
Tips: for comment triggers put a comment_reply first, then one message with buttons (on Facebook the person must tap a button before the bot can send more). Keep button labels under 20 characters.`
