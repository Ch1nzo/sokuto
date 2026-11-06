import { and, eq, sql, type AnyColumn } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import type { Channel, ChannelProfile } from './channels/types'

export type ContactRow = typeof schema.contacts.$inferSelect

export async function findContact(db: Db, ws: number, channel: Channel, channelUserId: string): Promise<ContactRow | undefined> {
  return db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.workspaceId, ws), eq(schema.contacts.channel, channel), eq(schema.contacts.channelUserId, channelUserId)))
    .get()
}

/** A contact of workspace `ws` by id. */
export async function getContact(db: Db, ws: number, id: number): Promise<ContactRow | undefined> {
  return db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.workspaceId, ws))).get()
}

/** `contactId` belongs to a contact of workspace `ws` (for tables without a workspace column). */
export const ofWorkspace = (contactId: AnyColumn, ws: number) => sql`${contactId} in (select id from contacts where workspace_id = ${ws})`

export async function upsertContact(
  db: Db,
  ws: number,
  channel: Channel,
  channelUserId: string,
  profile: () => Promise<ChannelProfile>,
): Promise<{ contact: ContactRow; created: boolean }> {
  const existing = await findContact(db, ws, channel, channelUserId)
  if (existing) return { contact: existing, created: false }
  const p = await profile().catch(() => ({}) as ChannelProfile)
  const created = await db
    .insert(schema.contacts)
    .values({ workspaceId: ws, channel, channelUserId, displayName: p.displayName ?? null, avatarUrl: p.avatarUrl ?? null, username: p.username ?? null })
    .onConflictDoNothing()
    .returning()
    .get()
  if (created) return { contact: created, created: true }
  const again = await findContact(db, ws, channel, channelUserId)
  if (!again) throw new Error('contact upsert failed')
  return { contact: again, created: false }
}

export async function getTags(db: Db, contactId: number): Promise<string[]> {
  const rows = await db.select({ tag: schema.contactTags.tag }).from(schema.contactTags).where(eq(schema.contactTags.contactId, contactId))
  return rows.map((r) => r.tag)
}

export async function addTag(db: Db, contactId: number, tag: string) {
  const t = tag.trim()
  if (!t) return
  await db.insert(schema.contactTags).values({ contactId, tag: t }).onConflictDoNothing()
}

export async function removeTag(db: Db, contactId: number, tag: string) {
  await db.delete(schema.contactTags).where(and(eq(schema.contactTags.contactId, contactId), eq(schema.contactTags.tag, tag.trim())))
}

/** WHERE clause for the inbox filters `all | open | unread | paused | closed` (anything else lists everyone). */
export function inboxWhere(filter: string) {
  const c = schema.contacts
  return filter === 'paused' ? eq(c.botPaused, 1) : filter === 'unread' ? sql`${c.unread} > 0` : filter === 'open' || filter === 'closed' ? eq(c.status, filter) : undefined
}

export function parseFields(contact: ContactRow): Record<string, string> {
  try {
    return JSON.parse(contact.fields) as Record<string, string>
  } catch {
    return {}
  }
}

export async function setField(db: Db, contact: ContactRow, field: string, value: string): Promise<ContactRow> {
  const fields = parseFields(contact)
  fields[field] = value
  const updated = await db
    .update(schema.contacts)
    .set({ fields: JSON.stringify(fields), updatedAt: new Date().toISOString() })
    .where(eq(schema.contacts.id, contact.id))
    .returning()
    .get()
  return updated ?? { ...contact, fields: JSON.stringify(fields) }
}

export async function setBotPaused(db: Db, contactId: number, paused: boolean, minutes?: number) {
  const until = paused && minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null
  await db
    .update(schema.contacts)
    .set({ botPaused: paused ? 1 : 0, botPausedUntil: until, updatedAt: new Date().toISOString() })
    .where(eq(schema.contacts.id, contactId))
}

/** True when the bot must stay silent for this contact. Auto-resumes after `botPausedUntil`. */
export async function isBotPaused(db: Db, contact: ContactRow): Promise<boolean> {
  if (!contact.botPaused) return false
  if (contact.botPausedUntil && new Date(contact.botPausedUntil).getTime() < Date.now()) {
    await setBotPaused(db, contact.id, false)
    return false
  }
  return true
}

export function firstName(contact: ContactRow): string {
  const name = contact.displayName?.trim() ?? ''
  if (!name) return ''
  // Japanese names rarely use spaces; fall back to the full name.
  return name.includes(' ') ? name.split(' ')[0]! : name
}
