import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import { createDb, schema } from '../src/db'
import { inboxCounts } from '../src/contacts'
import { realtimeRejection } from '../src/realtime'

const ORIGIN = 'https://sokuto.example.workers.dev'
const upgrade = (headers: Record<string, string>, method = 'GET') => new Request(`${ORIGIN}/api/realtime?ws=1`, { method, headers })

describe('realtimeRejection', () => {
  it('answers 426 to anything but a WebSocket upgrade', async () => {
    for (const req of [upgrade({ origin: ORIGIN }), upgrade({ origin: ORIGIN, upgrade: 'h2c' }), upgrade({ origin: ORIGIN, upgrade: 'websocket' }, 'POST')]) {
      const res = realtimeRejection(req)
      expect(res?.status).toBe(426)
      expect(res?.headers.get('upgrade')).toBe('websocket')
    }
  })

  it('rejects a handshake from another origin or without one (cross-site WebSocket hijacking)', async () => {
    for (const origin of ['https://evil.example', 'http://sokuto.example.workers.dev', 'https://sokuto.example.workers.dev.evil.example', 'null']) {
      const res = realtimeRejection(upgrade({ upgrade: 'websocket', origin }))
      expect(res?.status).toBe(403)
      expect(await res!.json()).toEqual({ error: 'bad_origin' })
    }
    expect(realtimeRejection(upgrade({ upgrade: 'websocket' }))?.status).toBe(403)
  })

  it('lets a same-origin upgrade through', () => {
    expect(realtimeRejection(upgrade({ upgrade: 'websocket', origin: ORIGIN }))).toBeNull()
    expect(realtimeRejection(upgrade({ upgrade: 'WebSocket', origin: ORIGIN }))).toBeNull()
  })
})

// A real local D1 (Miniflare, in memory) with the project's migrations applied.
describe('inboxCounts', () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>

  beforeAll(async () => {
    proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false })
    const dir = join(fileURLToPath(import.meta.url), '../../migrations')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      for (const stmt of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) {
        if (stmt.trim()) await proxy.env.DB.prepare(stmt).run()
      }
    }
  }, 60_000)

  afterAll(async () => {
    await proxy?.dispose()
  })

  it('counts open conversations and conversations with unread messages, per workspace', async () => {
    const db = createDb(proxy.env.DB)
    expect(await inboxCounts(db, 1)).toEqual({ open: 0, unread: 0 })
    await db.insert(schema.workspaces).values({ id: 2, name: 'Other' })
    const row = (workspaceId: number, n: number, status: string, unread: number) => ({ workspaceId, channel: 'line', channelUserId: `u${workspaceId}-${n}`, status, unread })
    await db.insert(schema.contacts).values([row(1, 1, 'open', 2), row(1, 2, 'open', 0), row(1, 3, 'closed', 1), row(1, 4, 'closed', 0), row(1, 5, 'open', 1), row(2, 1, 'open', 3)])
    expect(await inboxCounts(db, 1)).toEqual({ open: 3, unread: 3 })
    expect(await inboxCounts(db, 2)).toEqual({ open: 1, unread: 1 })
    expect(await inboxCounts(db, 3)).toEqual({ open: 0, unread: 0 })
  })
})
