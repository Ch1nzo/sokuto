import { asc, eq, like, sql, type AnyColumn } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import { wsKey } from './settings'

export type Workspace = typeof schema.workspaces.$inferSelect

/** A workspace id from a URL, header or cookie: a positive integer, else null. */
export function parseWorkspaceId(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null
}

export const listWorkspaces = (db: Db) => db.select().from(schema.workspaces).orderBy(asc(schema.workspaces.id))

export const getWorkspace = (db: Db, id: number) => db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).get()

export const createWorkspace = (db: Db, name: string) => db.insert(schema.workspaces).values({ name }).returning().get()

export const renameWorkspace = (db: Db, id: number, name: string) => db.update(schema.workspaces).set({ name }).where(eq(schema.workspaces.id, id)).returning().get()

/** Deletes a workspace and everything in it (one D1 batch), then its MCP token. Workspace 1 (Default) cannot be deleted. */
export async function deleteWorkspace(db: Db, kv: KVNamespace, id: number): Promise<'ok' | 'not_found' | 'cannot_delete_default'> {
  if (id === 1) return 'cannot_delete_default'
  if (!(await getWorkspace(db, id))) return 'not_found'
  const ofContacts = (col: AnyColumn) => sql`${col} in (select id from contacts where workspace_id = ${id})`
  const s = schema
  await db.batch([
    db.delete(s.messages).where(ofContacts(s.messages.contactId)),
    db.delete(s.sessions).where(ofContacts(s.sessions.contactId)),
    db.delete(s.contactTags).where(ofContacts(s.contactTags.contactId)),
    db.delete(s.sequenceSubscriptions).where(ofContacts(s.sequenceSubscriptions.contactId)),
    db.delete(s.broadcastJobs).where(ofContacts(s.broadcastJobs.contactId)),
    db.delete(s.broadcasts).where(eq(s.broadcasts.workspaceId, id)),
    db.delete(s.contacts).where(eq(s.contacts.workspaceId, id)),
    db.delete(s.flows).where(eq(s.flows.workspaceId, id)),
    db.delete(s.segments).where(eq(s.segments.workspaceId, id)),
    db.delete(s.snippets).where(eq(s.snippets.workspaceId, id)),
    db.delete(s.events).where(eq(s.events.workspaceId, id)),
    db.delete(s.notifications).where(eq(s.notifications.workspaceId, id)),
    db.delete(s.faqs).where(eq(s.faqs.workspaceId, id)),
    db.delete(s.documents).where(eq(s.documents.workspaceId, id)),
    db.delete(s.products).where(eq(s.products.workspaceId, id)),
    db.delete(s.settings).where(like(s.settings.key, wsKey(id, '%'))),
    db.delete(s.workspaces).where(eq(s.workspaces.id, id)),
  ])
  const hash = await kv.get(`mcp:ws:${id}`)
  if (hash) await kv.delete(`mcp:token:${hash}`)
  await kv.delete(`mcp:ws:${id}`)
  return 'ok'
}
