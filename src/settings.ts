import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import { decryptString, encryptString, randomToken } from './crypto'
import type { Channel } from './channels/types'

/**
 * Secrets that Sokuto generates by itself on first run and keeps in KV.
 * Users never have to configure these.
 */
export type SecretName = 'session_secret' | 'enc_key' | 'meta_verify_token'

export async function getOrCreateSecret(kv: KVNamespace, name: SecretName): Promise<string> {
  const existing = await kv.get(`secret:${name}`)
  if (existing) return existing
  const value = randomToken(32)
  await kv.put(`secret:${name}`, value)
  // Re-read to avoid a race where two isolates generate different values.
  return (await kv.get(`secret:${name}`)) ?? value
}

export type LineConfig = {
  channelSecret: string
  channelAccessToken: string
  botBasicId?: string
  displayName?: string
}

export type MetaConfig = {
  appId: string
  appSecret: string
  pageId?: string
  pageName?: string
  pageAccessToken: string
  instagramAccountId?: string
  instagramUsername?: string
}

export type ChannelConfigs = { line?: LineConfig; meta?: MetaConfig }

export type GeneralSettings = {
  botName: string
  language: 'ja' | 'en'
  timezone: string
  /** Pause the whole bot (all channels). */
  paused: boolean
  /** Hand-over keywords that pause the bot for a contact. */
  handoffKeywords: string[]
  handoffReply: string
}

export const DEFAULT_GENERAL: GeneralSettings = {
  botName: 'Sokuto',
  language: 'ja',
  timezone: 'Asia/Tokyo',
  paused: false,
  handoffKeywords: ['担当者', 'オペレーター', 'human', 'agent'],
  handoffReply: '担当者におつなぎします。少々お待ちください。',
}

const SECRET_FIELDS = new Set(['channelSecret', 'channelAccessToken', 'appSecret', 'pageAccessToken'])

export async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

export async function putSetting(db: Db, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value)
  await db
    .insert(schema.settings)
    .values({ key, value: json, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: json, updatedAt: new Date().toISOString() } })
}

export async function getGeneral(db: Db): Promise<GeneralSettings> {
  const stored = await getSetting<Partial<GeneralSettings>>(db, 'general')
  return { ...DEFAULT_GENERAL, ...(stored ?? {}) }
}

async function transform(obj: Record<string, unknown>, fn: (v: string) => Promise<string>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' && SECRET_FIELDS.has(k) && v ? await fn(v) : v
  }
  return out
}

export async function getChannelConfig<K extends keyof ChannelConfigs>(db: Db, kv: KVNamespace, name: K): Promise<ChannelConfigs[K] | null> {
  const stored = await getSetting<Record<string, unknown>>(db, `channel:${name}`)
  if (!stored) return null
  const key = await getOrCreateSecret(kv, 'enc_key')
  return (await transform(stored, (v) => decryptString(key, v))) as ChannelConfigs[K]
}

export async function putChannelConfig<K extends keyof ChannelConfigs>(db: Db, kv: KVNamespace, name: K, value: NonNullable<ChannelConfigs[K]>) {
  const key = await getOrCreateSecret(kv, 'enc_key')
  const encrypted = await transform(value as Record<string, unknown>, (v) => encryptString(key, v))
  await putSetting(db, `channel:${name}`, encrypted)
}

export async function deleteChannelConfig(db: Db, name: keyof ChannelConfigs) {
  await db.delete(schema.settings).where(eq(schema.settings.key, `channel:${name}`))
}

/** Which channels are configured. Messenger and Instagram share one Meta app. */
export async function configuredChannels(db: Db): Promise<Channel[]> {
  const rows = await db.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings)
  const out: Channel[] = []
  for (const r of rows) {
    if (r.key === 'channel:line') out.push('line')
    if (r.key === 'channel:meta') {
      out.push('messenger')
      try {
        const v = JSON.parse(r.value) as { instagramAccountId?: string }
        if (v.instagramAccountId) out.push('instagram')
      } catch {
        /* ignore */
      }
    }
  }
  return out
}
