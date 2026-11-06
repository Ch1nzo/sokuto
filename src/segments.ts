import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import type { ContactRow } from './contacts'
import type { ConditionRule } from './flows/types'
import { matchRules } from './flows/rules'

/** A saved set of condition rules used to filter contacts and target broadcasts. */
export type Segment = { id: number; name: string; rules: ConditionRule[]; mode: 'all' | 'any'; createdAt: string }

export function parseSegment(row: typeof schema.segments.$inferSelect): Segment {
  let rules: ConditionRule[] = []
  try {
    const parsed: unknown = JSON.parse(row.rules)
    if (Array.isArray(parsed)) rules = parsed as ConditionRule[]
  } catch {
    // corrupt JSON: no rules, so the segment matches nobody
  }
  return { id: row.id, name: row.name, rules, mode: row.mode === 'any' ? 'any' : 'all', createdAt: row.createdAt }
}

export async function loadSegment(db: Db, id: number): Promise<Segment | null> {
  if (!Number.isInteger(id)) return null
  const row = await db.select().from(schema.segments).where(eq(schema.segments.id, id)).get()
  return row ? parseSegment(row) : null
}

/** Every contact's tags in one query (avoids D1's 100 bound-parameter limit of `in (...)`). */
export async function tagsByContact(db: Db): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>()
  for (const r of await db.select({ contactId: schema.contactTags.contactId, tag: schema.contactTags.tag }).from(schema.contactTags)) {
    const list = map.get(r.contactId)
    if (list) list.push(r.tag)
    else map.set(r.contactId, [r.tag])
  }
  return map
}

/** A segment without rules matches nobody, so a broken segment can never broadcast to everyone. */
export function matchesSegment(seg: Segment, contact: ContactRow, tags: string[]): boolean {
  return seg.rules.length > 0 && matchRules(seg.rules, seg.mode, { contact, tags })
}
