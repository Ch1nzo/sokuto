import { RecordingAdapter } from '../channels/adapter'
import type { Channel, InboundEvent, OutboundMessage } from '../channels/types'
import type { Db } from '../db'
import type { ContactRow } from '../contacts'
import { matchTrigger, parseButtonPayload, resumeFromButton, resumeSession, startFlow, type RunContext } from './engine'
import type { FlowRecord } from './types'

export type SimulatedInput = { type: 'message' | 'comment' | 'follow' | 'postback' | 'ref' | 'story_mention' | 'story_reply'; text?: string; payload?: string; ref?: string; button?: string }

export type SimulationStep = { input: SimulatedInput; triggered: boolean; outputs: OutboundMessage[]; commentReplies: string[]; waiting: string | null; stepId: string | null }

export type SimulationResult = { steps: SimulationStep[]; fields: Record<string, string>; tags: string[]; notifications: string[]; completed: boolean }

/** Plays a list of user inputs against a flow without touching channels, contacts or stats. */
export async function simulateFlow(db: Db, flow: FlowRecord, inputs: SimulatedInput[], channel: Channel = flow.channel === 'any' ? 'line' : flow.channel, isNewContact = true): Promise<SimulationResult> {
  const adapter = new RecordingAdapter(channel)
  const contact: ContactRow = {
    id: -1,
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const liveFlow: FlowRecord = { ...flow, status: 'live' }
  const ctx: RunContext = { db, adapter, contact, flow: liveFlow, dryRun: true, dryRunSession: null, dryRunTags: new Set(), dryRunNotifications: [] }
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
        const idx = step.buttons?.findIndex((b) => b.label === input.button) ?? -1
        if (idx >= 0) payload = `sk:${liveFlow.id}:${step.id}:${idx}`
      } else if (step && step.type === 'question') payload = `sk-choice:${input.button}`
    }
    const event: InboundEvent = { channel, channelUserId: 'test-user', eventId: `sim-${steps.length}`, type: payload && input.type === 'message' ? 'postback' : input.type, text: input.text, payload, ref: input.ref, commentId: input.type === 'comment' ? 'sim-comment' : undefined, timestamp: Date.now() }
    ctx.lastInput = input.text
    ctx.commentId = event.commentId
    ctx.flow = liveFlow
    let triggered = false
    if (ctx.dryRunSession && ctx.dryRunSession.waiting !== 'delay') {
      triggered = await resumeSession(ctx, ctx.dryRunSession, event)
    }
    if (!triggered && parseButtonPayload(event.payload)) triggered = await resumeFromButton(ctx, event.payload!)
    if (!triggered) {
      const trigger = matchTrigger(liveFlow, event, first)
      if (trigger) {
        triggered = true
        await startFlow(ctx, trigger)
      }
    }
    first = false
    steps.push({ input, triggered, outputs: adapter.sent.slice(before), commentReplies: adapter.commentReplies.slice(beforeReplies), waiting: ctx.dryRunSession?.waiting ?? null, stepId: ctx.dryRunSession?.stepId ?? null })
  }
  return { steps, fields: JSON.parse(ctx.contact.fields) as Record<string, string>, tags: [...(ctx.dryRunTags ?? [])], notifications: ctx.dryRunNotifications ?? [], completed: ctx.dryRunSession === null }
}
