import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db'
import { schema } from './db'
import { decryptString, encryptString, randomToken } from './crypto'
import type { Channel } from './channels/types'

/**
 * Secrets that Sokutō generates by itself on first run and keeps in KV.
 * Users never have to configure these. Shared by all workspaces.
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
  /** Bot variables rendered as {{bot.<key>}} in message text. */
  botFields: Record<string, string>
}

export const DEFAULT_GENERAL: GeneralSettings = {
  botName: 'Sokutō',
  language: 'ja',
  timezone: 'Asia/Tokyo',
  paused: false,
  handoffKeywords: ['担当者', 'オペレーター', 'human', 'agent'],
  handoffReply: '担当者におつなぎします。少々お待ちください。',
  botFields: {},
}

const flowId = z.number().int().positive()

/** Messenger / Instagram profile (`settings` row `ws:<id>:profile:meta`). Menu items open a URL or start a flow. */
export const metaProfileSchema = z.object({
  greeting: z.string().trim().max(160).optional(),
  getStartedFlowId: flowId.optional(),
  menu: z
    .array(
      z
        .object({ label: z.string().trim().min(1).max(30), url: z.string().url().regex(/^https?:\/\//).optional(), flowId: flowId.optional() })
        .refine((m) => !m.url !== !m.flowId, 'needs either url or flowId'),
    )
    .max(3)
    .default([]),
  iceBreakers: z.array(z.object({ question: z.string().trim().min(1).max(80), flowId })).max(4).default([]),
  applyToInstagram: z.boolean().default(false),
})
export type MetaProfile = z.infer<typeof metaProfileSchema>

/** LINE default rich menu (`settings` row `ws:<id>:richmenu:line`). `layout` is the number of areas. */
export const lineRichMenuSchema = z
  .object({
    imageUrl: z.string().url().regex(/^https?:\/\//),
    size: z.enum(['full', 'half']),
    layout: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6)]),
    chatBarText: z.string().trim().min(1).max(14),
    cells: z.array(
      z
        .object({ label: z.string().trim().max(20).optional(), type: z.enum(['flow', 'uri', 'message', 'postback']), value: z.string().trim().min(1).max(300) })
        .refine((c) => c.type !== 'flow' || /^\d+$/.test(c.value), 'flow value must be a flow id')
        .refine((c) => c.type !== 'uri' || /^(https?:\/\/|line:|tel:)/.test(c.value), 'uri must start with https://, line: or tel:'),
    ),
  })
  .refine((m) => m.cells.length === m.layout, { message: 'cells must match the layout', path: ['cells'] })
export type LineRichMenu = z.infer<typeof lineRichMenuSchema>

/** One line of a bot rule list: blank lines (an empty row in the editor) are dropped. */
const ruleLines = z.array(z.string().trim().max(200)).max(20).transform((a) => a.filter(Boolean))

/**
 * Reply bot (`settings` row `ws:<id>:bot`, logic in src/bot.ts). No defaults in the schema (zod 4 would apply them
 * inside `.partial()`); DEFAULT_BOT fills missing keys before validation.
 */
export const botConfigSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(30),
  channels: z.array(z.enum(['line', 'messenger', 'instagram'])).max(3),
  persona: z.string().trim().max(2000),
  guidelines: ruleLines,
  guardrails: ruleLines,
  handoffMessage: z.string().trim().max(500),
  unknownAction: z.enum(['handoff', 'fallback']),
  fallbackMessage: z.string().trim().max(500),
  autoClose: z.boolean(),
  resolveMessage: z.string().trim().max(500),
  maxTurns: z.number().int().min(1).max(50),
  recommendProducts: z.boolean(),
  segmentId: z.number().int().positive().nullable(),
  suggestFaqs: z.boolean(),
  language: z.enum(['auto', 'ja', 'en']),
})
export type BotConfig = z.infer<typeof botConfigSchema>

export const DEFAULT_BOT: BotConfig = {
  enabled: false,
  name: 'Soku',
  channels: ['line', 'messenger', 'instagram'],
  persona: '',
  guidelines: [],
  guardrails: [],
  handoffMessage: '担当者におつなぎします。少々お待ちください。',
  unknownAction: 'handoff',
  fallbackMessage: '申し訳ありません、その内容にはお答えできません。担当者が必要な場合は「担当者」と送ってください。',
  autoClose: true,
  resolveMessage: '',
  maxTurns: 10,
  recommendProducts: true,
  segmentId: null,
  suggestFaqs: false,
  language: 'auto',
}

/** Keys whose value is undefined are left out, so they cannot overwrite a stored value when merged. */
export const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

/** The saved bot settings over the defaults (a row that no longer validates falls back to the defaults). */
export async function getBotConfig(db: Db, ws: number): Promise<BotConfig> {
  const parsed = botConfigSchema.safeParse({ ...DEFAULT_BOT, ...(await getSetting<Partial<BotConfig>>(db, ws, 'bot')) })
  return parsed.success ? parsed.data : DEFAULT_BOT
}

/** Merges `patch` (Partial<BotConfig>) into the saved settings, validates and saves. */
export async function putBotConfig(db: Db, ws: number, patch: object): Promise<{ config: BotConfig } | { errors: string[] }> {
  const parsed = botConfigSchema.safeParse({ ...(await getBotConfig(db, ws)), ...defined(patch) })
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  const seg = schema.segments
  const segmentId = (patch as Partial<BotConfig>).segmentId
  if (segmentId && !(await db.select({ id: seg.id }).from(seg).where(and(eq(seg.id, segmentId), eq(seg.workspaceId, ws))).get())) return { errors: ['segmentId: segment not found'] }
  await putSetting(db, ws, 'bot', parsed.data)
  return { config: parsed.data }
}

/** AI provider for the AI reply step and intent triggers (`settings` row `ws:<id>:ai`, `apiKey` encrypted). */
export type AiConfig = { provider: 'anthropic' | 'openai' | 'workers_ai'; apiKey?: string; model?: string; baseUrl?: string }

const SECRET_FIELDS = new Set(['channelSecret', 'channelAccessToken', 'appSecret', 'pageAccessToken', 'apiKey'])

/** Settings rows are per workspace: `ws:<id>:<key>`. */
export const wsKey = (ws: number, key: string) => `ws:${ws}:${key}`

export async function getSetting<T>(db: Db, ws: number, key: string): Promise<T | null> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, wsKey(ws, key))).get()
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

export async function putSetting(db: Db, ws: number, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value)
  await db
    .insert(schema.settings)
    .values({ key: wsKey(ws, key), value: json, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: json, updatedAt: new Date().toISOString() } })
}

export async function deleteSetting(db: Db, ws: number, key: string): Promise<void> {
  await db.delete(schema.settings).where(eq(schema.settings.key, wsKey(ws, key)))
}

export async function getGeneral(db: Db, ws: number): Promise<GeneralSettings> {
  const stored = await getSetting<Partial<GeneralSettings>>(db, ws, 'general')
  return { ...DEFAULT_GENERAL, ...(stored ?? {}) }
}

async function transform(obj: Record<string, unknown>, fn: (v: string) => Promise<string>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' && SECRET_FIELDS.has(k) && v ? await fn(v) : v
  }
  return out
}

/** Settings row whose SECRET_FIELDS are AES-GCM encrypted with the KV `enc_key` (shared by all workspaces). */
export async function getSecretSetting<T>(db: Db, kv: KVNamespace, ws: number, key: string): Promise<T | null> {
  const stored = await getSetting<Record<string, unknown>>(db, ws, key)
  if (!stored) return null
  const enc = await getOrCreateSecret(kv, 'enc_key')
  return (await transform(stored, (v) => decryptString(enc, v))) as T
}

export async function putSecretSetting(db: Db, kv: KVNamespace, ws: number, key: string, value: object) {
  const enc = await getOrCreateSecret(kv, 'enc_key')
  await putSetting(db, ws, key, await transform(value as Record<string, unknown>, (v) => encryptString(enc, v)))
}

export async function getChannelConfig<K extends keyof ChannelConfigs>(db: Db, kv: KVNamespace, ws: number, name: K): Promise<ChannelConfigs[K] | null> {
  return getSecretSetting<ChannelConfigs[K]>(db, kv, ws, `channel:${name}`)
}

export async function putChannelConfig<K extends keyof ChannelConfigs>(db: Db, kv: KVNamespace, ws: number, name: K, value: NonNullable<ChannelConfigs[K]>) {
  await putSecretSetting(db, kv, ws, `channel:${name}`, value)
}

export const getAiConfig = (db: Db, kv: KVNamespace, ws: number) => getSecretSetting<AiConfig>(db, kv, ws, 'ai')
export const putAiConfig = (db: Db, kv: KVNamespace, ws: number, cfg: AiConfig) => putSecretSetting(db, kv, ws, 'ai', cfg)

export async function deleteChannelConfig(db: Db, ws: number, name: keyof ChannelConfigs) {
  await deleteSetting(db, ws, `channel:${name}`)
}

/** Which channels are configured. Messenger and Instagram share one Meta app. */
export async function configuredChannels(db: Db, ws: number): Promise<Channel[]> {
  const rows = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, [wsKey(ws, 'channel:line'), wsKey(ws, 'channel:meta')]))
  const out: Channel[] = []
  for (const r of rows) {
    if (r.key === wsKey(ws, 'channel:line')) out.push('line')
    if (r.key === wsKey(ws, 'channel:meta')) {
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
