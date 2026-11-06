import { and, eq, gte, isNotNull, sql } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import type { ChannelAdapter } from './channels/adapter'
import type { InboundEvent } from './channels/types'
import { isBotPaused, upsertContact, type ContactRow } from './contacts'
import { getGeneral } from './settings'
import { logEvent, logMessage, matchIntent, matchTrigger, parseButtonPayload, parseFlow, parseFlowPayload, resumeFromButton, resumeSession, startFlow, type RunContext } from './flows/engine'
import type { AiCaller } from './ai'
import { parseBroadcastButtons, parseBroadcastPayload } from './broadcasts'
import { handoffToHuman, runBot } from './bot'

/** Remembers platform event ids so retried webhooks are not processed twice. */
export async function markProcessed(db: Db, id: string): Promise<boolean> {
  const inserted = await db.insert(schema.processedEvents).values({ id }).onConflictDoNothing().returning().get()
  return Boolean(inserted)
}

export async function liveFlows(db: Db, ws: number) {
  const rows = await db.select().from(schema.flows).where(and(eq(schema.flows.workspaceId, ws), eq(schema.flows.status, 'live'))).orderBy(schema.flows.id)
  return rows.map(parseFlow)
}

/** Processes one normalized inbound event of workspace `ws` end to end. */
export async function handleInbound(db: Db, ws: number, adapter: ChannelAdapter, event: InboundEvent, replyToken?: string, ai?: AiCaller): Promise<void> {
  if (!(await markProcessed(db, `${ws}:${event.channel}:${event.eventId}`))) return
  const { contact: initial, created } = await upsertContact(db, ws, event.channel, event.channelUserId, () => adapter.getProfile(event.channelUserId))
  let contact: ContactRow = initial

  if (event.type === 'unfollow') {
    await logMessage(db, { contactId: contact.id, direction: 'in', source: 'system', kind: 'event', text: 'unfollow' })
    await db.delete(schema.sessions).where(eq(schema.sessions.contactId, contact.id))
    await db.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.contactId, contact.id))
    return
  }

  const kind = event.type === 'comment' ? 'comment' : event.type === 'postback' ? 'postback' : event.attachments?.length && !event.text ? (event.attachments[0]!.type === 'image' ? 'image' : 'event') : event.type === 'message' ? 'text' : 'event'
  const displayText = event.text ?? (event.type === 'postback' ? (event.payload?.startsWith('sk-choice:') ? event.payload.slice(10) : undefined) : undefined) ?? (event.type === 'follow' ? 'follow' : event.type === 'ref' ? `ref:${event.ref}` : event.type === 'story_mention' ? 'story mention' : undefined)
  await logMessage(db, { contactId: contact.id, direction: 'in', source: 'user', kind, text: displayText ?? null, payload: { type: event.type, payload: event.payload, commentId: event.commentId, postId: event.postId, attachments: event.attachments } })
  await db.update(schema.contacts).set({ unread: (contact.unread ?? 0) + 1, status: 'open' }).where(eq(schema.contacts.id, contact.id))

  const general = await getGeneral(db, ws)
  if (general.paused) return
  const base = { db, ws, adapter, replyToken, timezone: general.timezone, botFields: general.botFields, ai }

  // Hand-over keywords pause the bot for this contact and notify the team.
  if (event.type === 'message' && event.text && general.handoffKeywords.some((k) => k && event.text!.toLowerCase().includes(k.toLowerCase()))) {
    await handoffToHuman(db, ws, adapter, contact, replyToken, general.handoffReply)
    return
  }

  if (await isBotPaused(db, contact)) return

  const flows = await liveFlows(db, ws)

  // 0. Broadcast buttons (`sk-bc:<broadcastId>:<i>`): count the tap and start its automation.
  // Handled before the session so a tap while a question is waiting is not taken as the answer.
  const bc = parseBroadcastPayload(event.payload)
  if (bc) {
    const row = await db.select().from(schema.broadcasts).where(and(eq(schema.broadcasts.id, bc.broadcastId), eq(schema.broadcasts.workspaceId, ws))).get()
    const button = row ? parseBroadcastButtons(row.buttons)[bc.index] : undefined
    if (row && button) {
      await logEvent(db, { workspaceId: ws, type: 'button_clicked', channel: contact.channel, contactId: contact.id, meta: { broadcastId: row.id, index: bc.index, label: button.label } })
      await db.update(schema.broadcasts).set({ clicked: sql`${schema.broadcasts.clicked} + 1` }).where(eq(schema.broadcasts.id, row.id))
      const flow = flows.find((f) => f.id === button.flowId)
      if (flow) await startFlow({ ...base, contact, flow }, null)
    }
    return
  }

  const session = await db.select().from(schema.sessions).where(eq(schema.sessions.contactId, contact.id)).get()

  // 1. Continue a waiting conversation.
  if (session && session.waiting !== 'delay') {
    const flow = flows.find((f) => f.id === session.flowId)
    if (flow) {
      const ctx: RunContext = { ...base, contact, flow, lastInput: event.text }
      if (await resumeSession(ctx, session, event)) return
      contact = ctx.contact
    } else {
      await db.delete(schema.sessions).where(eq(schema.sessions.contactId, contact.id))
    }
  }

  // 2. A button tap always resolves to its flow, even without a session.
  const button = parseButtonPayload(event.payload)
  if (button) {
    const flow = flows.find((f) => f.id === button.flowId)
    if (flow) {
      const ctx: RunContext = { ...base, contact, flow }
      if (await resumeFromButton(ctx, event.payload!)) return
    }
  }

  // 2b. Profile menus, ice breakers and LINE rich menu areas (`sk-flow:<id>`) start that flow directly.
  const directId = event.type === 'postback' ? parseFlowPayload(event.payload) : null
  const direct = flows.find((f) => f.id === directId)
  if (direct) {
    await startFlow({ ...base, contact, flow: direct }, null)
    return
  }

  // 3. Match triggers. Specific triggers win over first_message / any_message.
  let chosen: { flow: (typeof flows)[number]; trigger: NonNullable<ReturnType<typeof matchTrigger>> } | null = null
  for (const flow of flows) {
    const trigger = matchTrigger(flow, event, created)
    if (!trigger) continue
    const specific = trigger.type !== 'first_message' && trigger.type !== 'any_message'
    if (specific) {
      chosen = { flow, trigger }
      break
    }
    if (!chosen || (chosen.trigger.type === 'any_message' && trigger.type === 'first_message')) chosen = { flow, trigger }
  }
  // 3b. Intent triggers: without a session, one AI call may pick a flow for a message no specific trigger matched.
  if (!session) chosen = (await matchIntent(ai, flows, event, chosen?.trigger ?? null)) ?? chosen
  // 4. No live automation took it: Soku (the reply bot) may answer a text message.
  if (!chosen) {
    if (!session && event.type === 'message' && event.text?.trim()) await runBot({ ...base, contact, general }, event.text)
    return
  }
  // any_message with a cooldown starts at most once per contact within that window.
  if (chosen.trigger.type === 'any_message' && chosen.trigger.cooldownHours) {
    const since = new Date(Date.now() - chosen.trigger.cooldownHours * 3_600_000).toISOString()
    const e = schema.events
    const recent = await db.select({ id: e.id }).from(e).where(and(eq(e.type, 'trigger_fired'), eq(e.flowId, chosen.flow.id), eq(e.contactId, contact.id), gte(e.createdAt, since))).get()
    if (recent) return
  }
  const ctx: RunContext = { ...base, contact, flow: chosen.flow, commentId: event.type === 'comment' ? event.commentId : undefined, lastInput: event.text }
  await startFlow(ctx, chosen.trigger)
}

/** Sessions waiting on a delay whose time has come. */
export async function dueSessions(db: Db, limit = 25) {
  const now = new Date().toISOString()
  const rows = await db.select().from(schema.sessions).where(and(eq(schema.sessions.waiting, 'delay'), isNotNull(schema.sessions.resumeAt))).limit(200)
  return rows.filter((r) => r.resumeAt! <= now).slice(0, limit)
}
