import { RecordingAdapter } from '../channels/adapter'
import type { Channel, InboundEvent, OutboundMessage } from '../channels/types'
import type { Db } from '../db'
import type { ContactRow } from '../contacts'
import type { AiCaller } from '../ai'
import { buttonPayload, flattenButtons, matchIntent, matchTrigger, parseButtonPayload, resumeFromButton, resumeSession, startFlow, type RunContext } from './engine'
import { SKIP_PAYLOAD } from './inputs'
import type { FlowRecord } from './types'

/** "start" runs the flow from its entry without a trigger (how a sequence enrollment starts). */
export type SimulatedInput = { type: 'start' | 'message' | 'comment' | 'follow' | 'postback' | 'ref' | 'story_mention' | 'story_reply'; text?: string; payload?: string; ref?: string; button?: string }

export type SimulationStep = { input: SimulatedInput; triggered: boolean; outputs: OutboundMessage[]; commentReplies: string[]; waiting: string | null; stepId: string | null }

export type SimulationResult = { steps: SimulationStep[]; fields: Record<string, string>; tags: string[]; notifications: string[]; notes: string[]; completed: boolean }

/** `ai` is called for real when given (API/MCP tests pass lazyAi: billed by the provider). */
export type SimulateOptions = { botFields?: Record<string, string>; timezone?: string; now?: () => Date; ai?: AiCaller }

/** Plays a list of user inputs against a flow without touching channels, contacts or stats. */
export async function simulateFlow(db: Db, flow: FlowRecord, inputs: SimulatedInput[], channel: Channel = flow.channel === 'any' ? 'line' : flow.channel, isNewContact = true, opts: SimulateOptions = {}): Promise<SimulationResult> {
  const adapter = new RecordingAdapter(channel)
  const contact: ContactRow = {
    id: -1,
    workspaceId: flow.workspaceId,
    channel,
    channelUserId: 'test-user',
    displayName: 'テスト 太郎',
    avatarUrl: null,
    username: 'test_user',
    fields: '{}',
    botPaused: 0,
    botPausedUntil: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    unread: 0,
    status: 'open',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const liveFlow: FlowRecord = { ...flow, status: 'live' }
  const ctx: RunContext = { db, ws: flow.workspaceId, adapter, contact, flow: liveFlow, dryRun: true, dryRunSession: null, dryRunTags: new Set(), dryRunNotifications: [], dryRunNotes: [], botFields: opts.botFields, timezone: opts.timezone ?? 'Asia/Tokyo', now: opts.now, ai: opts.ai }
  const steps: SimulationStep[] = []
  let first = isNewContact
  for (const input of inputs) {
    const before = adapter.sent.length
    const beforeReplies = adapter.commentReplies.length
    let payload = input.payload
    // Allow "button: label" to tap a button on the step the session waits on.
    if (input.button && ctx.dryRunSession?.stepId) {
      const step = liveFlow.definition.steps.find((s) => s.id === ctx.dryRunSession!.stepId)
      if (step && step.type === 'message') {
        const idx = flattenButtons(step).findIndex((b) => b.label === input.button)
        if (idx >= 0) payload = `sk:${liveFlow.id}:${step.id}:${idx}`
      } else if (step && step.type === 'question') payload = input.button === step.skipLabel ? SKIP_PAYLOAD : `sk-choice:${input.button}`
    } else if (input.button && !ctx.dryRunSession) {
      // No session (e.g. a sequence moved on without waiting): tap the first button with that label anywhere in the flow.
      for (const s of liveFlow.definition.steps) {
        const idx = s.type === 'message' ? flattenButtons(s).findIndex((b) => b.label === input.button) : -1
        if (idx >= 0) {
          payload = buttonPayload(liveFlow.id, s.id, idx)
          break
        }
      }
    }
    const event: InboundEvent = { channel, channelUserId: 'test-user', eventId: `sim-${steps.length}`, type: payload && input.type === 'message' ? 'postback' : input.type === 'start' ? 'message' : input.type, text: input.text, payload, ref: input.ref, commentId: input.type === 'comment' ? 'sim-comment' : undefined, timestamp: Date.now() }
    ctx.lastInput = input.text
    ctx.commentId = event.commentId
    ctx.flow = liveFlow
    // Only the enrollment run is in sequence mode; later taps continue as a normal flow (as in production).
    ctx.sequence = input.type === 'start' && liveFlow.kind === 'sequence' ? { id: -1 } : undefined
    let triggered = input.type === 'start'
    if (triggered) await startFlow(ctx, null)
    else if (ctx.dryRunSession && ctx.dryRunSession.waiting !== 'delay') {
      triggered = await resumeSession(ctx, ctx.dryRunSession, event)
    }
    if (!triggered && parseButtonPayload(event.payload)) triggered = await resumeFromButton(ctx, event.payload!)
    if (!triggered) {
      let trigger = matchTrigger(liveFlow, event, first)
      // Intent triggers as in inbound.ts, with this flow's intents as the only candidates.
      if (!ctx.dryRunSession) trigger = (await matchIntent(ctx.ai, [liveFlow], event, trigger))?.trigger ?? trigger
      if (trigger) {
        triggered = true
        await startFlow(ctx, trigger)
      }
    }
    first = false
    steps.push({ input, triggered, outputs: adapter.sent.slice(before), commentReplies: adapter.commentReplies.slice(beforeReplies), waiting: ctx.dryRunSession?.waiting ?? null, stepId: ctx.dryRunSession?.stepId ?? null })
  }
  return { steps, fields: JSON.parse(ctx.contact.fields) as Record<string, string>, tags: [...(ctx.dryRunTags ?? [])], notifications: ctx.dryRunNotifications ?? [], notes: ctx.dryRunNotes ?? [], completed: ctx.dryRunSession === null }
}
