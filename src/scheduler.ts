import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import type { Env } from './env'
import { getAdapter } from './channels/registry'
import type { Channel } from './channels/types'
import { dueSessions } from './inbound'
import { parseFlow, runFrom, logMessage, type RunContext } from './flows/engine'
import { getGeneral } from './settings'
import { loadSegment, matchesSegment, tagsByContact } from './segments'

const BROADCAST_PER_TICK = 30

export async function runScheduledTasks(env: Env, db: Db): Promise<{ resumed: number; broadcastSent: number }> {
  let resumed = 0
  const { timezone, botFields } = await getGeneral(db)
  for (const s of await dueSessions(db)) {
    const contact = await db.select().from(schema.contacts).where(eq(schema.contacts.id, s.contactId)).get()
    const row = await db.select().from(schema.flows).where(eq(schema.flows.id, s.flowId)).get()
    if (!contact || !row || row.status !== 'live') {
      await db.delete(schema.sessions).where(eq(schema.sessions.contactId, s.contactId))
      continue
    }
    const adapter = await getAdapter(env, db, contact.channel as Channel)
    if (!adapter) continue
    const flow = parseFlow(row)
    const step = flow.definition.steps.find((x) => x.id === s.stepId)
    const ctx: RunContext = { db, adapter, contact, flow, timezone, botFields }
    await runFrom(ctx, step && step.type === 'delay' ? step.next : null)
    resumed++
  }

  // Sequence enrollments whose next step is due (stepId = the step to run now).
  const subs = schema.sequenceSubscriptions
  for (const s of await db.select().from(subs).where(lte(subs.resumeAt, new Date().toISOString())).limit(25)) {
    const contact = await db.select().from(schema.contacts).where(eq(schema.contacts.id, s.contactId)).get()
    const row = await db.select().from(schema.flows).where(eq(schema.flows.id, s.flowId)).get()
    if (!contact || !row || row.status !== 'live' || row.kind !== 'sequence') {
      await db.delete(subs).where(eq(subs.id, s.id))
      continue
    }
    const adapter = await getAdapter(env, db, contact.channel as Channel)
    if (!adapter) continue
    await runFrom({ db, adapter, contact, flow: parseFlow(row), timezone, botFields, sequence: { id: s.id } }, s.stepId)
    resumed++
  }

  const broadcastSent = await processBroadcasts(env, db)
  // Keep the de-duplication table small.
  const cutoff = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
  await db.delete(schema.processedEvents).where(lt(schema.processedEvents.createdAt, cutoff))
  return { resumed, broadcastSent }
}

/** Creates jobs for newly due broadcasts and sends a batch of pending jobs. */
export async function processBroadcasts(env: Env, db: Db): Promise<number> {
  const now = new Date().toISOString()
  const due = await db.select().from(schema.broadcasts).where(and(eq(schema.broadcasts.status, 'scheduled'), lte(schema.broadcasts.scheduledAt, now)))
  for (const b of due) {
    const targets = await broadcastTargets(db, b.channel as Channel | 'any', b.tag, b.segmentId)
    if (targets.length > 0) await db.insert(schema.broadcastJobs).values(targets.map((t) => ({ broadcastId: b.id, contactId: t.id })))
    await db.update(schema.broadcasts).set({ status: targets.length ? 'running' : 'done', total: targets.length }).where(eq(schema.broadcasts.id, b.id))
  }

  const running = await db.select().from(schema.broadcasts).where(eq(schema.broadcasts.status, 'running'))
  let sent = 0
  let budget = BROADCAST_PER_TICK
  for (const b of running) {
    if (budget <= 0) break
    const jobs = await db.select().from(schema.broadcastJobs).where(and(eq(schema.broadcastJobs.broadcastId, b.id), eq(schema.broadcastJobs.status, 'pending'))).limit(budget)
    if (jobs.length === 0) {
      await db.update(schema.broadcasts).set({ status: 'done' }).where(eq(schema.broadcasts.id, b.id))
      continue
    }
    const contacts = await db.select().from(schema.contacts).where(inArray(schema.contacts.id, jobs.map((j) => j.contactId)))
    for (const job of jobs) {
      budget--
      const contact = contacts.find((c) => c.id === job.contactId)
      if (!contact) {
        await db.update(schema.broadcastJobs).set({ status: 'skipped', error: 'contact missing' }).where(eq(schema.broadcastJobs.id, job.id))
        continue
      }
      // Meta only allows ordinary messages within 24h of the person's last message.
      if (contact.channel !== 'line') {
        const last = contact.lastInboundAt ? new Date(contact.lastInboundAt).getTime() : 0
        if (Date.now() - last > 24 * 3600 * 1000) {
          await db.update(schema.broadcastJobs).set({ status: 'skipped', error: 'outside 24h window' }).where(eq(schema.broadcastJobs.id, job.id))
          await db.update(schema.broadcasts).set({ failed: sql`${schema.broadcasts.failed} + 1` }).where(eq(schema.broadcasts.id, b.id))
          continue
        }
      }
      const adapter = await getAdapter(env, db, contact.channel as Channel)
      if (!adapter) {
        await db.update(schema.broadcastJobs).set({ status: 'failed', error: 'channel not configured' }).where(eq(schema.broadcastJobs.id, job.id))
        continue
      }
      const res = await adapter.send(contact.channelUserId, { text: b.text, imageUrl: b.imageUrl ?? undefined })
      await logMessage(db, { contactId: contact.id, direction: 'out', source: 'bot', kind: 'text', text: b.text, payload: { broadcastId: b.id }, error: res.ok ? undefined : res.error })
      await db.update(schema.broadcastJobs).set({ status: res.ok ? 'sent' : 'failed', error: res.ok ? null : res.error }).where(eq(schema.broadcastJobs.id, job.id))
      await db
        .update(schema.broadcasts)
        .set(res.ok ? { sent: sql`${schema.broadcasts.sent} + 1` } : { failed: sql`${schema.broadcasts.failed} + 1` })
        .where(eq(schema.broadcasts.id, b.id))
      if (res.ok) sent++
    }
  }
  return sent
}

/** Contacts on `channel` in the segment (which replaces the tag filter) or with the tag. A deleted segment reaches nobody. */
export async function broadcastTargets(db: Db, channel: Channel | 'any', tag: string | null, segmentId: number | null = null) {
  const all = await db.select().from(schema.contacts)
  let targets = all.filter((c) => channel === 'any' || c.channel === channel)
  if (segmentId !== null) {
    const seg = await loadSegment(db, segmentId)
    if (!seg) return []
    const tags = await tagsByContact(db)
    // ponytail: O(n) in-memory scan over all contacts (rules are not SQL, and D1 caps bound parameters at 100); move to SQL if contacts outgrow Worker memory
    targets = targets.filter((c) => matchesSegment(seg, c, tags.get(c.id) ?? []))
  } else if (tag) {
    const tagged = await db.select({ contactId: schema.contactTags.contactId }).from(schema.contactTags).where(eq(schema.contactTags.tag, tag))
    const ids = new Set(tagged.map((t) => t.contactId))
    targets = targets.filter((c) => ids.has(c.id))
  }
  return targets
}

/** Used by the admin to preview how many people a broadcast would reach right now. */
export async function broadcastReach(db: Db, channel: Channel | 'any', tag: string | null, segmentId: number | null = null) {
  const targets = await broadcastTargets(db, channel, tag, segmentId)
  const reachable = targets.filter((c) => c.channel === 'line' || (c.lastInboundAt && Date.now() - new Date(c.lastInboundAt).getTime() <= 24 * 3600 * 1000))
  return { total: targets.length, reachable: reachable.length }
}
