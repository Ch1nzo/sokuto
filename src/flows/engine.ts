import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { schema } from '../db'
import type { ChannelAdapter } from '../channels/adapter'
import type { ChannelProfile, InboundEvent, OutboundMessage } from '../channels/types'
import { addTag, firstName, getTags, parseFields, removeTag, setBotPaused, setField, type ContactRow } from '../contacts'
import { DEFAULT_RETRY_TEXT, SKIP_PAYLOAD, validateInput } from './inputs'
import { matchRules, normalize } from './rules'
import type { ButtonDef, FlowDefinition, FlowRecord, Step, Trigger } from './types'

export type SessionRow = typeof schema.sessions.$inferSelect

export type RunContext = {
  db: Db
  adapter: ChannelAdapter
  contact: ContactRow
  flow: FlowRecord
  /** Present when the run was started by a comment: first message goes as a private reply. */
  commentId?: string
  replyToken?: string
  /** Last free-text input (used by conditions and placeholders). */
  lastInput?: string
  dryRun?: boolean
  /** In dry runs the session and tags live here instead of in D1. */
  dryRunSession?: SessionRow | null
  dryRunTags?: Set<string>
  dryRunNotifications?: string[]
  /** Bot variables from Settings, rendered as {{bot.<key>}}. */
  botFields?: Record<string, string>
  /** IANA time zone of the bot (Settings), used by time-based conditions. */
  timezone?: string
  /** Clock override for tests. */
  now?: () => Date
  /** Instagram follow status, fetched once per run by the first is_follower condition. */
  followsBusiness?: boolean
  /** Seconds already waited inline (short delays) in this run. */
  inlineWaited?: number
}

const MAX_STEPS_PER_RUN = 50
// ponytail: inline waits are capped at 10 s per step / 20 s per run so the webhook's waitUntil (~30 s) never expires; longer waits go through the scheduler.
const INLINE_DELAY_MAX = 10
const INLINE_DELAY_BUDGET = 20

export function parseFlow(row: typeof schema.flows.$inferSelect): FlowRecord {
  let definition: FlowDefinition
  try {
    definition = JSON.parse(row.definition) as FlowDefinition
  } catch {
    definition = { triggers: [], entry: null, steps: [] }
  }
  return { id: row.id, name: row.name, channel: row.channel as FlowRecord['channel'], status: row.status as FlowRecord['status'], definition, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

export function buttonPayload(flowId: number, stepId: string, index: number): string {
  return `sk:${flowId}:${stepId}:${index}`
}

export function parseButtonPayload(payload: string | undefined): { flowId: number; stepId: string; index: number } | null {
  if (!payload) return null
  const m = /^sk:(\d+):([^:]+):(\d+)$/.exec(payload)
  if (!m) return null
  return { flowId: Number(m[1]), stepId: m[2]!, index: Number(m[3]) }
}

function keywordMatches(text: string | undefined, keywords: string[], mode: 'contains' | 'exact' | 'starts_with' = 'contains'): boolean {
  const t = normalize(text)
  if (!t) return false
  return keywords.some((k) => {
    const kw = normalize(k)
    if (!kw) return false
    if (mode === 'exact') return t === kw
    if (mode === 'starts_with') return t.startsWith(kw)
    return t.includes(kw)
  })
}

/** Returns the trigger of `flow` that matches `event`, or null. */
export function matchTrigger(flow: FlowRecord, event: InboundEvent, isFirstMessage: boolean): Trigger | null {
  if (flow.status !== 'live') return null
  if (flow.channel !== 'any' && flow.channel !== event.channel) return null
  let fallback: Trigger | null = null
  for (const t of flow.definition.triggers) {
    switch (t.type) {
      case 'keyword':
        if ((event.type === 'message' || event.type === 'story_reply') && keywordMatches(event.text, t.keywords, t.match)) return t
        break
      case 'comment':
        if (event.type === 'comment') {
          if (t.postIds && t.postIds.length > 0 && !(event.postId && t.postIds.includes(event.postId))) break
          if (t.keywords && t.keywords.length > 0 && !keywordMatches(event.text, t.keywords)) break
          if (t.excludeKeywords?.length && keywordMatches(event.text, t.excludeKeywords)) break
          return t
        }
        break
      case 'postback':
        if (event.type === 'postback' && event.payload === t.payload) return t
        break
      case 'ref':
        if (event.type === 'ref' && event.ref === t.ref) return t
        break
      case 'follow':
        if (event.type === 'follow') return t
        break
      case 'story_mention':
        if (event.type === 'story_mention') return t
        break
      case 'story_reply':
        if (event.type === 'story_reply') return t
        break
      case 'first_message':
        if (event.type === 'message' && isFirstMessage) fallback = fallback ?? t
        break
      case 'any_message':
        if (event.type === 'message') fallback = fallback ?? t
        break
    }
  }
  return fallback
}

/** Replaces {{name}}, {{first_name}}, {{field}}, {{bot.key}} and {field} placeholders; `encode` escapes the substituted values. */
export function renderText(text: string, contact: ContactRow, lastInput?: string, botFields?: Record<string, string>, encode?: (v: string) => string): string {
  const fields = parseFields(contact)
  const vars: Record<string, string> = {
    ...fields,
    name: contact.displayName ?? '',
    first_name: firstName(contact),
    username: contact.username ?? '',
    last_input: lastInput ?? '',
  }
  for (const [k, v] of Object.entries(botFields ?? {})) vars[`bot.${k}`] = v
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}|\{([\w.-]+)\}/g, (m, a: string | undefined, b: string | undefined) => {
    const key = (a ?? b ?? '').replace(/^field\./, '')
    return key in vars ? (encode ? encode(vars[key]!) : vars[key]!) : m
  })
}

function render(ctx: RunContext, text: string, encode?: (v: string) => string): string {
  return renderText(text, ctx.contact, ctx.lastInput, ctx.botFields, encode)
}

async function contactTags(ctx: RunContext): Promise<string[]> {
  if (ctx.dryRun) return [...(ctx.dryRunTags ?? [])]
  return getTags(ctx.db, ctx.contact.id)
}

/** Instagram only (Meta returns it once the person has messaged); other channels always count as following. */
async function isFollower(ctx: RunContext): Promise<boolean> {
  if (ctx.contact.channel !== 'instagram') return true
  if (ctx.followsBusiness === undefined) {
    const p = await ctx.adapter.getProfile(ctx.contact.channelUserId).catch((): ChannelProfile => ({}))
    ctx.followsBusiness = p.followsBusiness ?? false
  }
  return ctx.followsBusiness
}

export async function logEvent(db: Db, ev: { type: string; channel?: string; flowId?: number; stepId?: string; contactId?: number; meta?: unknown }) {
  await db.insert(schema.events).values({ type: ev.type, channel: ev.channel, flowId: ev.flowId, stepId: ev.stepId, contactId: ev.contactId, meta: ev.meta === undefined ? null : JSON.stringify(ev.meta) })
}

export async function logMessage(
  db: Db,
  m: { contactId: number; direction: 'in' | 'out'; source: 'user' | 'bot' | 'human' | 'system'; kind: string; text?: string | null; payload?: unknown; flowId?: number; stepId?: string; error?: string },
) {
  await db.insert(schema.messages).values({
    contactId: m.contactId,
    direction: m.direction,
    source: m.source,
    kind: m.kind,
    text: m.text ?? null,
    payload: m.payload === undefined ? null : JSON.stringify(m.payload),
    flowId: m.flowId,
    stepId: m.stepId,
    error: m.error,
  })
  const now = new Date().toISOString()
  await db
    .update(schema.contacts)
    .set(m.direction === 'in' ? { lastInboundAt: now, updatedAt: now } : { lastOutboundAt: now, updatedAt: now })
    .where(eq(schema.contacts.id, m.contactId))
}

async function deliver(ctx: RunContext, step: Step, msg: OutboundMessage) {
  let result
  if (ctx.commentId && ctx.adapter.sendPrivateReply) {
    result = await ctx.adapter.sendPrivateReply(ctx.commentId, msg)
    ctx.commentId = undefined
  } else {
    result = await ctx.adapter.send(ctx.contact.channelUserId, msg, { replyToken: ctx.replyToken })
  }
  if (ctx.dryRun) return result
  await logMessage(ctx.db, { contactId: ctx.contact.id, direction: 'out', source: 'bot', kind: msg.imageUrl && !msg.text ? 'image' : 'text', text: msg.text, payload: msg, flowId: ctx.flow.id, stepId: step.id, error: result.ok ? undefined : result.error })
  await logEvent(ctx.db, { type: result.ok ? 'step_sent' : 'error', channel: ctx.contact.channel, flowId: ctx.flow.id, stepId: step.id, contactId: ctx.contact.id, meta: result.ok ? undefined : { error: result.error } })
  return result
}

async function saveSession(ctx: RunContext, patch: Partial<Omit<SessionRow, 'contactId'>>) {
  const values = { contactId: ctx.contact.id, flowId: ctx.flow.id, stepId: null, waiting: null, field: null, resumeAt: null, context: '{}', updatedAt: new Date().toISOString(), ...patch }
  if (ctx.dryRun) {
    ctx.dryRunSession = values
    return
  }
  await ctx.db
    .insert(schema.sessions)
    .values(values)
    .onConflictDoUpdate({ target: schema.sessions.contactId, set: values })
}

async function endSession(ctx: RunContext) {
  if (ctx.dryRun) {
    ctx.dryRunSession = null
    return
  }
  await ctx.db.delete(schema.sessions).where(eq(schema.sessions.contactId, ctx.contact.id))
  await logEvent(ctx.db, { type: 'flow_completed', channel: ctx.contact.channel, flowId: ctx.flow.id, contactId: ctx.contact.id })
}

function renderButtons(ctx: RunContext, step: Step & { type: 'message' }, buttons: ButtonDef[]) {
  return buttons.map((b, i) => ({ label: render(ctx, b.label), url: b.url, payload: b.url ? undefined : buttonPayload(ctx.flow.id, step.id, i) }))
}

/** Choices as quick replies, plus the skip button when the step has one. */
function questionQuickReplies(step: Step & { type: 'question' }): OutboundMessage['quickReplies'] {
  const qr = (step.choices ?? []).map((c) => ({ label: c, payload: `sk-choice:${c}` }))
  if (step.skipLabel) qr.push({ label: step.skipLabel, payload: SKIP_PAYLOAD })
  return qr.length > 0 ? qr : undefined
}

export async function performActions(ctx: RunContext, actions: Array<{ type: string } & Record<string, unknown>>) {
  for (const a of actions) {
    if (ctx.dryRun) {
      ctx.dryRunTags ??= new Set()
      if (a.type === 'add_tag') ctx.dryRunTags.add(String(a.tag ?? ''))
      else if (a.type === 'remove_tag') ctx.dryRunTags.delete(String(a.tag ?? ''))
      else if (a.type === 'notify') (ctx.dryRunNotifications ??= []).push(render(ctx, String(a.text ?? `{{name}} → ${ctx.flow.name}`)))
      else if (a.type === 'set_field') {
        const f = parseFields(ctx.contact)
        f[String(a.field)] = render(ctx, String(a.value ?? ''))
        ctx.contact = { ...ctx.contact, fields: JSON.stringify(f) }
      } else if (a.type === 'pause_bot') ctx.contact = { ...ctx.contact, botPaused: 1 }
      continue
    }
    switch (a.type) {
      case 'add_tag':
        await addTag(ctx.db, ctx.contact.id, String(a.tag ?? ''))
        break
      case 'remove_tag':
        await removeTag(ctx.db, ctx.contact.id, String(a.tag ?? ''))
        break
      case 'set_field':
        ctx.contact = await setField(ctx.db, ctx.contact, String(a.field), render(ctx, String(a.value ?? '')))
        break
      case 'notify':
        await ctx.db.insert(schema.notifications).values({ contactId: ctx.contact.id, text: render(ctx, String(a.text ?? `{{name}} が自動化「${ctx.flow.name}」に反応しました`)) })
        break
      case 'pause_bot':
        await setBotPaused(ctx.db, ctx.contact.id, true, typeof a.minutes === 'number' ? a.minutes : undefined)
        ctx.contact = { ...ctx.contact, botPaused: 1 }
        break
      case 'webhook': {
        const url = String(a.url ?? '')
        if (!/^https?:\/\//.test(url)) break
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact: { id: ctx.contact.id, channel: ctx.contact.channel, name: ctx.contact.displayName, fields: parseFields(ctx.contact), tags: await getTags(ctx.db, ctx.contact.id) }, flow: { id: ctx.flow.id, name: ctx.flow.name }, lastInput: ctx.lastInput ?? null }),
        }).catch(() => undefined)
        break
      }
    }
  }
}

/** Runs the flow from `stepId` until it has to wait for the user, a delay, or the end. */
export async function runFrom(ctx: RunContext, stepId: string | null | undefined): Promise<void> {
  let current = stepId ?? null
  for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
    if (!current) return endSession(ctx)
    const step = ctx.flow.definition.steps.find((s) => s.id === current)
    if (!step) return endSession(ctx)
    switch (step.type) {
      case 'message': {
        const buttons = step.buttons?.filter((b) => b.label) ?? []
        const msg: OutboundMessage = { text: step.text ? render(ctx, step.text) : undefined, imageUrl: step.imageUrl || undefined }
        if (buttons.length > 0) {
          const rendered = renderButtons(ctx, step, buttons)
          if (buttons.length <= 3 && buttons.some((b) => b.url)) msg.buttons = rendered
          else msg.quickReplies = rendered
        }
        const result = await deliver(ctx, step, msg)
        if (!result.ok) return endSession(ctx)
        const waitsForButton = buttons.some((b) => !b.url && b.next)
        if (waitsForButton) {
          await saveSession(ctx, { stepId: step.id, waiting: 'button' })
          return
        }
        current = step.next ?? null
        break
      }
      case 'question': {
        const result = await deliver(ctx, step, { text: render(ctx, step.text), quickReplies: questionQuickReplies(step) })
        if (!result.ok) return endSession(ctx)
        await saveSession(ctx, { stepId: step.id, waiting: 'input', field: step.field })
        return
      }
      case 'condition': {
        const needTags = step.rules.some((r) => r.op === 'has_tag' || r.op === 'not_has_tag')
        const tags = needTags ? await contactTags(ctx) : []
        const needFollow = step.rules.some((r) => r.field === 'is_follower')
        const subject = { contact: ctx.contact, tags, lastInput: ctx.lastInput, timezone: ctx.timezone, now: ctx.now, isFollower: needFollow ? await isFollower(ctx) : undefined }
        current = (matchRules(step.rules, step.mode, subject) ? step.yes : step.no) ?? null
        break
      }
      case 'action':
        await performActions(ctx, step.actions as Array<{ type: string } & Record<string, unknown>>)
        current = step.next ?? null
        break
      case 'delay': {
        if (ctx.dryRun) {
          current = step.next ?? null
          break
        }
        const waited = ctx.inlineWaited ?? 0
        if (step.seconds <= INLINE_DELAY_MAX && waited + step.seconds <= INLINE_DELAY_BUDGET) {
          ctx.inlineWaited = waited + step.seconds
          await ctx.adapter.typing?.(ctx.contact.channelUserId, step.seconds)
          await new Promise((r) => setTimeout(r, step.seconds * 1000))
          current = step.next ?? null
          break
        }
        const resumeAt = new Date(Date.now() + Math.max(0, step.seconds) * 1000).toISOString()
        await saveSession(ctx, { stepId: step.id, waiting: 'delay', resumeAt })
        return
      }
      case 'random': {
        const total = step.branches.reduce((s, b) => s + Math.max(0, b.weight), 0)
        let r = Math.random() * (total || 1)
        let chosen = step.branches[0]
        for (const b of step.branches) {
          r -= Math.max(0, b.weight)
          if (r <= 0) {
            chosen = b
            break
          }
        }
        current = chosen?.next ?? null
        break
      }
      case 'goto': {
        const row = await ctx.db.select().from(schema.flows).where(eq(schema.flows.id, step.flowId)).get()
        if (!row) return endSession(ctx)
        ctx.flow = parseFlow(row)
        current = ctx.flow.definition.entry
        break
      }
      case 'comment_reply': {
        const variants = [step.text, ...(step.texts ?? [])].filter((t) => t.trim())
        const text = ctx.dryRun ? variants[0] : variants[Math.floor(Math.random() * variants.length)]
        if (text && ctx.commentId && ctx.adapter.replyToComment) {
          const res = await ctx.adapter.replyToComment(ctx.commentId, render(ctx, text))
          if (!ctx.dryRun) await logEvent(ctx.db, { type: res.ok ? 'comment_replied' : 'error', channel: ctx.contact.channel, flowId: ctx.flow.id, stepId: step.id, contactId: ctx.contact.id, meta: res.ok ? undefined : { error: res.error } })
        }
        current = step.next ?? null
        break
      }
    }
  }
  await endSession(ctx)
}

export async function startFlow(ctx: RunContext, trigger: Trigger | null): Promise<void> {
  if (!ctx.dryRun) await logEvent(ctx.db, { type: 'trigger_fired', channel: ctx.contact.channel, flowId: ctx.flow.id, contactId: ctx.contact.id, meta: trigger ? { trigger: trigger.type } : undefined })
  if (trigger?.type === 'comment' && trigger.like && ctx.commentId && ctx.adapter.likeComment) {
    const res = await ctx.adapter.likeComment(ctx.commentId).catch((e: unknown) => ({ ok: false as const, error: String(e) }))
    if (!res.ok && !ctx.dryRun) await logEvent(ctx.db, { type: 'error', channel: ctx.contact.channel, flowId: ctx.flow.id, contactId: ctx.contact.id, meta: { op: 'like_comment', error: res.error } })
  }
  await runFrom(ctx, ctx.flow.definition.entry)
}

/**
 * Continues a waiting session with the user's reply.
 * Returns false when the input does not belong to the session (caller should treat it as a new message).
 */
export async function resumeSession(ctx: RunContext, session: SessionRow, event: InboundEvent): Promise<boolean> {
  const step = ctx.flow.definition.steps.find((s) => s.id === session.stepId)
  if (!step) {
    await endSession(ctx)
    return false
  }
  if (session.waiting === 'input' && step.type === 'question') {
    if (event.payload === SKIP_PAYLOAD && step.skipLabel) {
      await runFrom(ctx, step.next)
      return true
    }
    const raw = event.payload?.startsWith('sk-choice:') ? event.payload.slice('sk-choice:'.length) : (event.text ?? event.payload ?? '')
    if (!raw.trim() && !(event.attachments && event.attachments.length)) return false
    let value = raw.trim() || (event.attachments?.[0]?.url ?? event.attachments?.[0]?.type ?? '')
    if (step.choices && step.choices.length > 0 && !step.choices.some((c) => normalize(c) === normalize(value))) {
      // Not one of the offered choices: let triggers decide, otherwise re-ask.
      return false
    }
    if (step.validate) {
      const normalized = validateInput(step.validate, value)
      if (normalized === null) {
        await deliver(ctx, step, { text: render(ctx, step.retryText || DEFAULT_RETRY_TEXT), quickReplies: questionQuickReplies(step) })
        return true
      }
      value = normalized
    }
    ctx.lastInput = value
    if (ctx.dryRun) {
      const f = parseFields(ctx.contact)
      f[step.field] = value
      ctx.contact = { ...ctx.contact, fields: JSON.stringify(f) }
    } else {
      ctx.contact = await setField(ctx.db, ctx.contact, step.field, value)
      await logEvent(ctx.db, { type: 'input_saved', channel: ctx.contact.channel, flowId: ctx.flow.id, stepId: step.id, contactId: ctx.contact.id, meta: { field: step.field } })
    }
    await runFrom(ctx, step.next)
    return true
  }
  if (session.waiting === 'button' && step.type === 'message') {
    const parsed = parseButtonPayload(event.payload)
    if (!parsed || parsed.flowId !== ctx.flow.id || parsed.stepId !== step.id) return false
    const button = step.buttons?.[parsed.index]
    if (!button) return false
    if (!ctx.dryRun) await logEvent(ctx.db, { type: 'button_clicked', channel: ctx.contact.channel, flowId: ctx.flow.id, stepId: step.id, contactId: ctx.contact.id, meta: { label: button.label } })
    await runFrom(ctx, button.next)
    return true
  }
  return false
}

/** Handles a button tap that arrives without a session (e.g. after a Facebook comment private reply). */
export async function resumeFromButton(ctx: RunContext, payload: string): Promise<boolean> {
  const parsed = parseButtonPayload(payload)
  if (!parsed || parsed.flowId !== ctx.flow.id) return false
  const step = ctx.flow.definition.steps.find((s) => s.id === parsed.stepId)
  if (!step || step.type !== 'message') return false
  const button = step.buttons?.[parsed.index]
  if (!button) return false
  if (!ctx.dryRun) await logEvent(ctx.db, { type: 'button_clicked', channel: ctx.contact.channel, flowId: ctx.flow.id, stepId: step.id, contactId: ctx.contact.id, meta: { label: button.label } })
  await runFrom(ctx, button.next)
  return true
}
