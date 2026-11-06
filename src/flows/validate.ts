import { z } from 'zod'
import type { FlowDefinition, FlowRecord } from './types'
import { INPUT_VALIDATIONS } from './inputs'
import { MESSAGE_TAGS } from '../channels/types'

const next = z.string().nullable().optional()
/** Links rendered as hrefs / sent to channels: http(s) only (no javascript:, data: …). */
const httpUrl = z.string().url().regex(/^https?:\/\//i, 'http(s) URL')

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keyword'), keywords: z.array(z.string().min(1)).min(1), match: z.enum(['contains', 'exact', 'starts_with']).optional() }),
  z.object({ type: z.literal('comment'), keywords: z.array(z.string()).optional(), excludeKeywords: z.array(z.string()).optional(), postIds: z.array(z.string()).optional(), like: z.boolean().optional() }),
  z.object({ type: z.literal('first_message') }),
  z.object({ type: z.literal('follow') }),
  z.object({ type: z.literal('any_message'), cooldownHours: z.number().positive().max(720).optional() }),
  z.object({ type: z.literal('ref'), ref: z.string().min(1) }),
  z.object({ type: z.literal('postback'), payload: z.string().min(1) }),
  z.object({ type: z.literal('story_mention') }),
  z.object({ type: z.literal('story_reply') }),
  z.object({ type: z.literal('intent'), description: z.string().trim().min(1).max(300), examples: z.array(z.string().min(1).max(200)).max(10).optional() }),
])

export const ruleSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['equals', 'not_equals', 'contains', 'has_tag', 'not_has_tag', 'is_set', 'is_empty', 'gt', 'gte', 'lt', 'lte']),
  value: z.string().optional(),
})

/** Body of POST/PUT /api/segments and MCP create_segment. */
export const segmentInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rules: z.array(ruleSchema).min(1).max(20),
  mode: z.enum(['all', 'any']).default('all'),
})

/** Broadcast buttons (POST /api/broadcasts, MCP create_broadcast): each one a link or an automation to start on tap. */
export const broadcastButtonsSchema = z
  .array(
    z
      .object({ label: z.string().trim().min(1).max(40), url: httpUrl.optional(), flowId: z.number().int().positive().optional() })
      .refine((b) => !b.url !== !b.flowId, 'give either url or flowId, not both'),
  )
  .max(3)

export const messageTagSchema = z.enum(MESSAGE_TAGS)

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_tag'), tag: z.string().min(1) }),
  z.object({ type: z.literal('remove_tag'), tag: z.string().min(1) }),
  z.object({ type: z.literal('set_field'), field: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal('notify'), text: z.string().optional() }),
  z.object({ type: z.literal('pause_bot'), minutes: z.number().int().positive().optional() }),
  z.object({ type: z.literal('webhook'), url: httpUrl }),
  z.object({ type: z.literal('subscribe'), flowId: z.number().int().positive() }),
  z.object({ type: z.literal('unsubscribe'), flowId: z.number().int().positive() }),
])

const buttonSchema = z.object({ label: z.string().min(1).max(40), next, url: httpUrl.optional() })
const cardSchema = z.object({ title: z.string().min(1).max(40), subtitle: z.string().max(60).optional(), imageUrl: httpUrl.optional().or(z.literal('')), buttons: z.array(buttonSchema).min(1).max(3) })
const attachmentSchema = z.object({ type: z.enum(['video', 'audio', 'file']), url: z.string().url().startsWith('https://'), previewImageUrl: httpUrl.optional(), durationMs: z.number().int().positive().optional() })

const stepSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('message'), text: z.string().max(2000).default(''), imageUrl: httpUrl.optional().or(z.literal('')), buttons: z.array(buttonSchema).max(13).optional(), cards: z.array(cardSchema).max(10).optional(), attachment: attachmentSchema.optional(), next }),
  z.object({ id: z.string().min(1), type: z.literal('question'), text: z.string().min(1).max(2000), field: z.string().min(1).regex(/^[\w.-]+$/), choices: z.array(z.string().min(1).max(20)).max(13).optional(), validate: z.enum(INPUT_VALIDATIONS).optional(), retryText: z.string().max(2000).optional(), skipLabel: z.string().min(1).max(20).optional(), next }),
  z.object({ id: z.string().min(1), type: z.literal('condition'), rules: z.array(ruleSchema).min(1), mode: z.enum(['all', 'any']).optional(), yes: next, no: next }),
  z.object({ id: z.string().min(1), type: z.literal('action'), actions: z.array(actionSchema).min(1), next }),
  z.object({ id: z.string().min(1), type: z.literal('delay'), seconds: z.number().int().min(1).max(60 * 60 * 24 * 30), next }),
  z.object({ id: z.string().min(1), type: z.literal('random'), branches: z.array(z.object({ weight: z.number().min(0), next })).min(1) }),
  z.object({ id: z.string().min(1), type: z.literal('goto'), flowId: z.number().int().positive() }),
  z.object({ id: z.string().min(1), type: z.literal('comment_reply'), text: z.string().max(1000).default(''), texts: z.array(z.string().max(1000)).max(4).optional(), next }),
  z.object({
    id: z.string().min(1),
    type: z.literal('request'),
    method: z.enum(['GET', 'POST']),
    url: z.string().url().startsWith('https://'),
    headers: z.record(z.string(), z.string()).refine((h) => Object.keys(h).length <= 10, 'at most 10 headers').optional(),
    body: z.string().max(10000).optional(),
    save: z.array(z.object({ field: z.string().min(1).regex(/^[\w.-]+$/), path: z.string().max(200) })).max(10).optional(),
    timeoutMs: z.number().int().min(1000).max(15000).optional(),
    next,
  }),
  z.object({ id: z.string().min(1), type: z.literal('ai'), instructions: z.string().min(1).max(4000), knowledge: z.string().max(20000).optional(), maxTurns: z.number().int().min(1).max(20).optional(), next }),
])

export const flowDefinitionSchema = z.object({
  triggers: z.array(triggerSchema),
  entry: z.string().nullable(),
  steps: z.array(stepSchema).max(200),
})

export const flowChannelSchema = z.enum(['any', 'line', 'messenger', 'instagram'])
export const flowKindSchema = z.enum(['flow', 'sequence'])

const SEQUENCE_STEP_TYPES = new Set(['message', 'condition', 'action', 'delay', 'random'])

/** Validates structure and referential integrity. Returns the parsed definition or a list of problems. */
export function validateFlow(input: unknown, kind: FlowRecord['kind'] = 'flow'): { ok: true; definition: FlowDefinition; warnings: string[] } | { ok: false; errors: string[] } {
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
    if (kind === 'sequence' && !SEQUENCE_STEP_TYPES.has(s.type)) errors.push(`step ${s.id}: ${s.type} steps are not allowed in a sequence`)
    switch (s.type) {
      case 'message':
        check(s.next, `step ${s.id}.next`)
        s.buttons?.forEach((b, i) => check(b.next, `step ${s.id}.buttons[${i}].next`))
        s.cards?.forEach((c, i) => c.buttons.forEach((b, j) => check(b.next, `step ${s.id}.cards[${i}].buttons[${j}].next`)))
        if (new Set(s.cards?.map((c) => c.buttons.length)).size > 1) errors.push(`step ${s.id}: all cards must have the same number of buttons (LINE carousel)`)
        if (!s.text && !s.imageUrl && !s.cards?.length && !s.attachment) errors.push(`step ${s.id}: message needs text, imageUrl, cards or attachment`)
        if (s.attachment?.type === 'video' && !s.attachment.previewImageUrl) warnings.push(`step ${s.id}: video without previewImageUrl is sent as a link on LINE`)
        if (s.attachment?.type === 'audio' && !s.attachment.durationMs) warnings.push(`step ${s.id}: audio without durationMs is sent as a link on LINE`)
        if (s.attachment?.type === 'file') warnings.push(`step ${s.id}: files are sent as a link on LINE and Instagram`)
        break
      case 'question':
        check(s.next, `step ${s.id}.next`)
        if (s.skipLabel && (s.choices?.length ?? 0) >= 13) errors.push(`step ${s.id}: skipLabel needs a free quick-reply slot (max 12 choices)`)
        if (s.validate && !s.skipLabel) warnings.push(`step ${s.id}: validate without skipLabel: the person can only leave the question with a valid answer or a hand-over keyword`)
        break
      case 'condition':
        check(s.yes, `step ${s.id}.yes`)
        check(s.no, `step ${s.id}.no`)
        break
      case 'action':
      case 'delay':
      case 'request':
      case 'ai':
        check(s.next, `step ${s.id}.next`)
        break
      case 'comment_reply':
        check(s.next, `step ${s.id}.next`)
        if (![s.text, ...(s.texts ?? [])].some((t) => t.trim())) errors.push(`step ${s.id}: comment_reply needs text or texts`)
        break
      case 'random':
        s.branches.forEach((b, i) => check(b.next, `step ${s.id}.branches[${i}].next`))
        break
    }
  }
  if (kind === 'sequence') {
    if (def.triggers.length > 0) errors.push('sequences have no triggers: remove them and enroll contacts with a subscribe action')
  } else if (def.triggers.length === 0) warnings.push('no triggers: the flow can only be started by a button or goto')
  if (def.triggers.some((t) => t.type === 'comment') && !def.steps.some((s) => s.type === 'comment_reply')) warnings.push('comment trigger without a comment_reply step: consider a public reply')
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, definition: def, warnings }
}

/** Human-readable description of the flow JSON for AI assistants (MCP get_flow_schema). */
export const FLOW_SCHEMA_DOC = `A flow definition is a JSON object: { "triggers": Trigger[], "entry": stepId | null, "steps": Step[] }.
Steps are a graph: each step names the next step id (or null to end). Use short ids like "m1", "q1", "c1".

Triggers (when the flow starts):
- { "type": "keyword", "keywords": ["価格","price"], "match": "contains"|"exact"|"starts_with" }  message containing a keyword
- { "type": "comment", "keywords": [...]?, "excludeKeywords": [...]?, "postIds": [...]?, "like"?: true }  a comment on a Facebook/Instagram post (optionally only with keywords / on given posts; never when the comment contains one of excludeKeywords). "like": true also likes the comment
- { "type": "first_message" }  the person's very first message
- { "type": "follow" }  LINE follow (friend add)
- { "type": "any_message", "cooldownHours"?: 24 }  fallback for every message; with cooldownHours it starts at most once per contact within that many hours (max 720)
- { "type": "ref", "ref": "campaign1" }  referral link / QR (m.me/<page>?ref=campaign1, ig.me, LINE)
- { "type": "postback", "payload": "..." }  a button payload
- { "type": "story_mention" } / { "type": "story_reply" }  Instagram stories
- { "type": "intent", "description": "asks about shipping or delivery" (≤300), "examples"?: ["送料はいくら?", "いつ届く?"] (≤10) }  classified by AI: when a message (2+ characters) matches no specific trigger and no conversation is waiting, ONE AI call compares it with the intent triggers of all live flows and starts the matching flow; with no match, first_message / any_message apply as usual. Needs an AI provider in Settings (get_overview → ai.configured): without one, intent triggers never fire. Each classified message is one paid API call. test_flow classifies against this flow's intents only and calls the real provider (billed)

Steps:
- { "id", "type": "message", "text": "Hi {{first_name}}!", "imageUrl"?: "https://...", "buttons"?: [{ "label": "注文", "next": "q1" } | { "label": "詳細", "url": "https://..." }], "next"?: stepId }
  Buttons with "next" wait for the tap. Without buttons the flow continues to "next" immediately.
  "cards"?: [{ "title": "Plan A" (≤40), "subtitle"?: "¥1,000 / month" (≤60), "imageUrl"?: "https://...", "buttons": [1–3 buttons as above] }] (≤10) adds a carousel after the text. EVERY card must have the SAME number of buttons (LINE carousel rule). Card buttons with "next" wait for the tap like top-level buttons.
  "attachment"?: { "type": "video"|"audio"|"file", "url": "https://...", "previewImageUrl"?: "https://..." (video), "durationMs"?: 30000 (audio) } sends a video, audio or file. On LINE a video without previewImageUrl, an audio without durationMs, and any file are sent as a text link; on Instagram a file is sent as a link.
  A message needs text, imageUrl, cards or attachment. Send order: image → attachment → text (+ buttons) → cards; quick replies go on the last one.
- { "id", "type": "question", "text": "電話番号は?", "field": "phone", "choices"?: ["1","2","3"], "validate"?: "email"|"phone"|"number"|"url"|"date", "retryText"?: "電話番号の形式で送ってください", "skipLabel"?: "スキップ", "next": stepId }  waits for the answer and saves it to the contact field
  "validate" checks and normalizes the answer before saving (phone: digits with an optional leading +, 8–15 digits, spaces/hyphens/parentheses removed; number: half-width; url: http(s) only; date: saved as YYYY-MM-DD, real days only). An invalid answer gets "retryText" and the question keeps waiting: always write a retryText that says what format is expected (the default is a generic Japanese sentence). "skipLabel" adds a quick reply that moves on to "next" without saving the field; with it, at most 12 choices.
- { "id", "type": "condition", "rules": [{ "field": "rating", "op": "lte", "value": "2" }], "mode"?: "all"|"any", "yes": stepId, "no": stepId }
  ops: equals, not_equals, contains, has_tag, not_has_tag, is_set, is_empty, gt, gte, lt, lte. Special fields: "channel", "last_input", "name", "is_follower" ("true"/"false"; Instagram follow status, always "true" on other channels), "hour" ("0"–"23" in the bot time zone), "weekday" ("0" = Sunday … "6" = Saturday), "days_since_created", "days_since_last_inbound" (whole days; empty for a new contact). Any other field is a contact field; use "tag" with has_tag / not_has_tag.
  Segments (create_segment) reuse these rules and mode to filter contacts and target broadcasts; there "last_input" is always empty.
  Compare numbers as strings: { "field": "hour", "op": "gte", "value": "9" }
- { "id", "type": "action", "actions": [{ "type": "add_tag", "tag": "interested" }, { "type": "remove_tag", "tag": "x" }, { "type": "set_field", "field": "f", "value": "v" }, { "type": "notify", "text": "..." }, { "type": "pause_bot", "minutes"?: 60 }, { "type": "webhook", "url": "https://..." }, { "type": "subscribe", "flowId": 5 }, { "type": "unsubscribe", "flowId": 5 }], "next": stepId }
  subscribe / unsubscribe enroll the contact in / remove them from a live sequence (see Sequences below).
- { "id", "type": "delay", "seconds": 3600, "next": stepId }  waits ≤10 s inline with a typing indicator (up to 20 s per run); longer waits resume from the scheduler, which runs every minute
- { "id", "type": "random", "branches": [{ "weight": 1, "next": "a" }, { "weight": 1, "next": "b" }] }
- { "id", "type": "goto", "flowId": 12 }
- { "id", "type": "comment_reply", "text": "DMを送りました ✓", "texts"?: ["DM しました!", "DM をご確認ください"], "next": stepId }  public reply under the triggering comment (comment trigger only). One of text + texts (max 5 in total, up to 4 in texts; text may be "" when texts is set) is picked at random so replies do not all look the same
- { "id", "type": "request", "method": "GET"|"POST", "url": "https://api.example.com/price?item={{item}}", "headers"?: { "Authorization": "Bearer {{bot.api_key}}" } (≤10), "body"?: "{\\"phone\\": \\"{{phone}}\\"}" (POST, ≤10000 chars), "save"?: [{ "field": "price", "path": "data.price" }] (≤10), "timeoutMs"?: 8000 (1000–15000), "next": stepId }
  Calls an external HTTPS API and saves values from the response to contact fields. Placeholders in "url" are URL-encoded; in a JSON body they are JSON-escaped (POST defaults to Content-Type: application/json). "path" is dotted ("data.price", "items.0.name"; "" = the whole body); objects are saved as JSON, values are cut at 2000 chars. On failure (HTTP error, timeout, non-https) an error event is logged and the flow still continues to "next": branch on the saved field with a condition (is_set / is_empty). test_flow never calls the API: it lists the skipped request in "notes".
- { "id", "type": "ai", "instructions": "You are the assistant of cafe X. Answer only about opening hours ({{bot.hours}}) and reservations; otherwise offer a human." (≤4000, placeholders allowed), "knowledge"?: "FAQ text…" (≤20000), "maxTurns"?: 5 (1–20), "next": stepId }
  An AI conversation: the model answers the message that reached the step (or greets when there is none), then waits and answers each new message until it judges the goal reached or after maxTurns replies (default 5), then the flow goes on to "next". It replies in the user's language; the last 12 messages of this conversation are kept as history. Each turn is one paid API call to the provider in Settings, and test_flow calls it too. If no AI provider is configured or a call fails / returns nothing, nothing is sent, an error event is logged (test_flow: "notes") and the flow continues to "next". Hand-over keywords still work during the conversation. Not allowed in sequences.

Placeholders in text: {{name}}, {{first_name}}, {{username}}, {{last_input}}, {{<field>}} e.g. {{phone}}, {{bot.<key>}} for bot variables set in Settings (keys listed in get_overview → general.botFields).
Tips: for comment triggers put a comment_reply first, then one message with buttons (on Facebook the person must tap a button before the bot can send more). Keep button labels under 20 characters.
On Instagram, is_follower can only be checked after the person has sent a DM or tapped a button: put the condition behind a button such as "フォローしました", not right after the comment.

Sequences (drip campaigns): a flow created with kind "sequence" has no triggers ("triggers": []) and only message, condition, action, delay and random steps. Contacts are enrolled with a subscribe action, POST /api/contacts/:id/sequences or the MCP tool subscribe_sequence (live sequences only, once per contact); the first step runs within a minute, and each delay step schedules the next part (e.g. message → delay 86400 → message → delay 172800 → message). Buttons do not pause a sequence: it moves on to "next" right away, and a later tap runs that button's branch like a normal flow. The enrollment ends at the last step, on unsubscribe, when the sequence is unpublished or deleted, or when the contact unfollows. test_flow plays a sequence with the input { "type": "start" } (delays are skipped).`
