import { and, desc, eq, gt, gte, inArray, isNotNull, like, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db'
import { schema } from './db'
import { jsonObject, type AiCaller, type AiMessage, type AiRequest } from './ai'
import type { ChannelAdapter } from './channels/adapter'
import type { Channel, OutboundCard } from './channels/types'
import { getTags, setBotPaused, type ContactRow } from './contacts'
import { logEvent, logMessage } from './flows/engine'
import { loadSegment, matchesSegment } from './segments'
import { defined, getBotConfig, type BotConfig, type GeneralSettings } from './settings'

/*
 * Soku, the reply bot: answers inbound text messages that no live automation took, from the workspace's
 * knowledge (approved FAQs, documents, products). Pure helpers first (tests/bot.test.ts), then the DB side.
 */

export type FaqRow = Omit<typeof schema.faqs.$inferSelect, 'variants'> & { variants: string[] }
type ProductRow = typeof schema.products.$inferSelect
export type Product = Omit<ProductRow, 'tags' | 'inStock'> & { tags: string[]; inStock: boolean }
export type HandoffReason = 'customer_request' | 'missing_knowledge' | 'policy' | 'max_turns' | 'ai_error' | 'other'
type AiReason = Extract<HandoffReason, 'customer_request' | 'missing_knowledge' | 'policy' | 'other'>
export type KnowledgeFaq = Pick<FaqRow, 'id' | 'question' | 'variants' | 'answer'>
export type KnowledgeDocument = { id: number; name: string; content: string }
export type Chunk = { documentId: number; name: string; text: string }
/** What one reply sees: the retrieved part of the workspace's knowledge. */
export type Knowledge = { faqs: KnowledgeFaq[]; chunks: Chunk[]; products: Product[] }
export type BotReply = { reply: string; action: 'answer' | 'handoff' | 'unknown'; resolved: boolean; faqIds: number[]; productIds: number[]; reason: AiReason }
type Fail = { error: string; errors?: string[] }

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
const errorText = (e: unknown) => (e instanceof Error ? (e.name === 'TimeoutError' ? 'timeout' : e.message) : String(e))
/** Loopback, private, link-local and internal hostnames (also by IP literal). Workers cannot reach them anyway; this makes the refusal explicit and testable. */
const PRIVATE_HOST = /^(localhost|[^.]+\.(local|internal|localdomain|home|lan)|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?(::1?|f[cd][0-9a-f]{2}:.*|fe80:.*|::ffff:.*)\]?)$/i
/** The URL when it is https and points at a public hostname, else null. */
export function publicHttpsUrl(url: string): URL | null {
  if (!/^https:\/\/\S+$/i.test(url) || !URL.canParse(url)) return null
  const u = new URL(url)
  return PRIVATE_HOST.test(u.hostname.toLowerCase().replace(/\.$/, '')) ? null : u
}
const isHttps = (url: string) => publicHttpsUrl(url) !== null
const now = () => new Date().toISOString()
/** A JSON string[] column (corrupt JSON or non-strings are dropped). */
function strings(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}
const parseFaq = <T extends { variants: string }>(row: T): Omit<T, 'variants'> & { variants: string[] } => ({ ...row, variants: strings(row.variants) })
/** Every phrasing of a FAQ, the primary question first. */
const phrasings = (f: Pick<KnowledgeFaq, 'question' | 'variants'>) => [f.question, ...f.variants]
/** Phrasings that differ only in case or surrounding spaces are the same question. */
const sameKey = (s: string) => s.trim().toLowerCase()

/* ---------- Search ---------- */

const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]+/gu
const norm = (s: string) => s.normalize('NFKC').toLowerCase()

/** Search terms: NFKC + lower case; words of 2+ letters / digits, and 2-grams of kanji / kana runs (a lone kanji counts as is). */
export function terms(text: string): Set<string> {
  const s = norm(text)
  const out = new Set<string>()
  for (const run of s.match(CJK) ?? []) {
    const chars = [...run]
    if (chars.length === 1) out.add(run)
    for (let i = 0; i < chars.length - 1; i++) out.add(chars[i]! + chars[i + 1]!)
  }
  for (const word of s.replace(CJK, ' ').match(/[\p{L}\p{N}]{2,}/gu) ?? []) out.add(word)
  return out
}

/** Splits text into pieces of at most `size` chars, cutting between lines (paragraphs) where possible. */
export function chunk(text: string, size = 1200): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of text.split(/\n+/)) {
    const para = line.trim()
    for (let i = 0; i < para.length; i += size) {
      const piece = para.slice(i, i + size)
      if (cur && cur.length + 1 + piece.length > size) {
        out.push(cur)
        cur = ''
      }
      cur = cur ? `${cur}\n${piece}` : piece
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Approved FAQs up to this many characters in total are all sent with every reply. */
export const SMALL_FAQS = 6000

// ponytail: substring scoring over every chunk of every document on each message; move to D1 FTS5 when knowledge outgrows the Worker CPU budget.
function top<T>(items: T[], text: (x: T) => string, q: string[], limit: number): T[] {
  return items
    .map((x) => {
      const t = norm(text(x))
      return { x, score: q.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.x)
}

/** The knowledge for one message: items ranked by how many query terms they contain (0 = left out). */
export function retrieve(query: string, k: { faqs: KnowledgeFaq[]; documents: KnowledgeDocument[]; products: Product[] }, limits = { faqs: 6, chunks: 4, products: 5 }): Knowledge {
  const q = [...terms(query)]
  const small = k.faqs.reduce((n, f) => n + phrasings(f).join('').length + f.answer.length, 0) <= SMALL_FAQS
  const chunks = k.documents.flatMap((doc) => chunk(doc.content).map((text) => ({ documentId: doc.id, name: doc.name, text })))
  return {
    faqs: small ? k.faqs : top(k.faqs, (f) => `${phrasings(f).join('\n')}\n${f.answer}`, q, limits.faqs),
    chunks: top(chunks, (c) => c.text, q, limits.chunks),
    products: top(k.products, (p) => `${p.name}\n${p.description}\n${p.tags.join(' ')}`, q, limits.products),
  }
}

/* ---------- Prompt and reply ---------- */

const CHANNEL_NAMES: Record<string, string> = { line: 'LINE', messenger: 'Facebook Messenger', instagram: 'Instagram' }
const LANGUAGES = { ja: 'Japanese', en: 'English' }
const AI_REASONS: AiReason[] = ['customer_request', 'missing_knowledge', 'policy', 'other']

export function priceLabel(p: Pick<Product, 'price' | 'currency'>): string {
  if (p.price === null) return ''
  try {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: p.currency }).format(p.price)
  } catch {
    return `${p.price} ${p.currency}`
  }
}

/** Button label language: the bot's language, or the admin language when it follows the customer. */
export const botLang = (cfg: BotConfig, general: Pick<GeneralSettings, 'language'>) => (cfg.language === 'auto' ? general.language : cfg.language)

function knowledgeText(k: Knowledge): string {
  const items = [
    ...k.faqs.map((f) => `[F${f.id}] Q: ${phrasings(f).join(' / ')} A: ${f.answer}`),
    ...k.chunks.map((c) => `[D${c.documentId} ${c.name}] ${c.text}`),
    ...k.products.map((p) => `[P${p.id}] ${[p.name, priceLabel(p), p.description, p.tags.join(', ')].filter(Boolean).join(' — ')}`),
  ]
  return items.join('\n\n') || '(empty)'
}

function localTime(timezone: string): string {
  try {
    return `${new Date().toLocaleString('sv-SE', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' })} (${timezone})`
  } catch {
    return `${now().slice(0, 16)} (UTC)`
  }
}

export type BotPromptInput = {
  cfg: BotConfig
  general: GeneralSettings
  contact?: Pick<ContactRow, 'displayName'> | null
  knowledge: Knowledge
  /** Oldest first; `in` is the customer, anything else the business. The last one is the message to answer. */
  history: { direction: string; text: string | null }[]
  channel: string
  /** A draft for a staff member (plain text) instead of the bot's JSON reply. */
  draft?: boolean
}

/** The system prompt and conversation for one reply. Contact custom fields and bot variables never go in. */
export function buildBotPrompt({ cfg, general, contact, knowledge, history, channel, draft }: BotPromptInput): AiRequest {
  const where = CHANNEL_NAMES[channel] ?? channel
  const list = (items: string[]) => items.map((s) => `- ${s}`).join('\n')
  const language = cfg.language === 'auto' ? "Reply in the customer's language." : `Always reply in ${LANGUAGES[cfg.language]}.`
  const rules = draft
    ? [
        'Use only facts from the Knowledge below. Where it does not cover something, write [要確認] instead of guessing.',
        language,
        'Keep it short for a chat (a few sentences). Plain text only: no Markdown.',
      ]
    : [
        'Answer only from the Knowledge below. When it does not contain the answer, do not guess: use action "unknown".',
        'When the customer asks for a person, is upset, or wants something you cannot do yourself, use action "handoff".',
        language,
        'Keep replies short for a chat (a few sentences). Plain text only: no Markdown.',
        'Only recommend products from the Knowledge, by their P ids. Never invent products, prices or links.',
      ]
  const sections = [
    draft
      ? `You write reply drafts for the staff of this business, who chat with customers on ${where} as ${cfg.name}. A staff member reviews your draft before sending it.`
      : `You are ${cfg.name}, the support assistant of this business, chatting on ${where}.`,
    cfg.persona && `## Persona\n${cfg.persona}`,
    cfg.guidelines.length > 0 && `## Response guidelines\n${list(cfg.guidelines)}`,
    `## Rules\n${list([...cfg.guardrails, ...rules])}`,
    `## Knowledge\n${knowledgeText(knowledge)}`,
    `## Customer\n${[contact?.displayName && `Name: ${JSON.stringify(contact.displayName.slice(0, 60))}`, `Channel: ${where}`, `Business local time: ${localTime(general.timezone)}`].filter(Boolean).join('\n')}`,
    draft
      ? '## Output format\nReply with the draft text only: no JSON, no quotes, no explanations.'
      : [
          '## Output format',
          'Answer with JSON only:',
          '{"reply": string, "action": "answer"|"handoff"|"unknown", "resolved": boolean, "faqIds": number[], "productIds": number[], "reason": "customer_request"|"missing_knowledge"|"policy"|"other"}',
          '- reply: the message to the customer.',
          '- action: "answer" when the Knowledge answers it, "unknown" when it does not, "handoff" to pass the conversation to a person.',
          '- resolved: true only when the request is completely handled and the customer signals the end of the conversation.',
          '- faqIds: the F ids you used. productIds: the P ids to show as product cards (only when they fit the request).',
          '- reason: why, for "handoff" and "unknown".',
        ].join('\n'),
  ]
  const turns = history.filter((h) => h.text?.trim()).slice(-12)
  let messages: AiMessage[]
  if (draft) {
    const transcript = turns.map((h) => `${h.direction === 'in' ? 'Customer' : 'Business'}: ${h.text}`).join('\n')
    messages = [{ role: 'user', content: `Conversation so far:\n${transcript}\n\nWrite the next reply from the business.` }]
  } else {
    messages = turns.map((h) => ({ role: h.direction === 'in' ? 'user' : 'assistant', content: h.text! }))
    // Providers expect the conversation to open with the customer.
    while (messages[0]?.role === 'assistant') messages.shift()
  }
  return { system: sections.filter(Boolean).join('\n\n'), messages, maxTokens: 600 }
}

const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x > 0))] : [])

/**
 * The bot's JSON reply. Plain text is sent as an answer; an empty answer, or JSON cut off mid-way
 * (it must never reach the customer), counts as "unknown". Ids are not checked here: callers keep the known ones.
 */
export function parseBotReply(raw: string): BotReply {
  const v = jsonObject(raw)
  if (!v || (typeof v.reply !== 'string' && typeof v.action !== 'string')) {
    const text = /^\s*(```|\{)/.test(raw) ? '' : raw.trim()
    return { reply: text, action: text ? 'answer' : 'unknown', resolved: false, faqIds: [], productIds: [], reason: text ? 'other' : 'missing_knowledge' }
  }
  const reply = typeof v.reply === 'string' ? v.reply.trim() : ''
  const action = v.action === 'handoff' || v.action === 'unknown' ? v.action : reply ? 'answer' : 'unknown'
  const reason = AI_REASONS.find((r) => r === v.reason) ?? (action === 'unknown' ? 'missing_knowledge' : 'other')
  return { reply, action, resolved: v.resolved === true, faqIds: ids(v.faqIds), productIds: ids(v.productIds), reason }
}

/** Keeps only the FAQ / product ids that were in the knowledge given to the model. */
function known(out: BotReply, k: Knowledge) {
  return {
    faqs: k.faqs.filter((f) => out.faqIds.includes(f.id)),
    products: k.products.filter((p) => out.productIds.includes(p.id)),
    documents: [...new Map(k.chunks.map((c) => [c.documentId, { id: c.documentId, name: c.name }])).values()],
  }
}

/**
 * Carousel cards for products with a URL (LINE needs a button on every card), at most 10. LINE also needs the same
 * layout in every column, so images are used only when every card has an https one.
 */
export function productCards(products: Product[], lang: 'ja' | 'en' = 'ja'): OutboundCard[] {
  const list = products.filter((p) => p.url).slice(0, 10)
  const images = list.every((p) => p.imageUrl?.startsWith('https://'))
  return list.map((p) => ({
    title: p.name.slice(0, 40),
    subtitle: [priceLabel(p), p.description].filter(Boolean).join(' ').slice(0, 60) || undefined,
    imageUrl: images ? p.imageUrl! : undefined,
    buttons: [{ label: lang === 'en' ? 'View' : '詳しく見る', url: p.url! }],
  }))
}

/** Products listed as text (for the ones without a URL, which cannot be cards). */
export const productText = (products: Product[]) => products.map((p) => `・${[p.name, priceLabel(p)].filter(Boolean).join(' ')}`).join('\n')

/* ---------- Documents ---------- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })

/** Readable text of an HTML page: no scripts, styles, navigation, header or footer; one line per paragraph. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|nav|header|footer|head|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(br|p|div|li|h[1-6]|tr|section|article|main|aside|ul|ol|table|blockquote|pre|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { title, text }
}

export const MAX_DOCUMENT_CHARS = 200_000
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new Error('too_large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

/** Text of an https page (HTML, plain text or JSON; no PDF): 10 s timeout, 2 MB, 200,000 characters. */
export async function fetchDocument(url: string): Promise<{ title: string; content: string }> {
  // Redirects are followed by hand so every hop is checked against the same https + public-host rule (max 3 hops).
  let target = publicHttpsUrl(url)
  if (!target) throw new Error('url_must_be_https')
  let res: Response
  for (let hop = 0; ; hop++) {
    res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1' } })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) break
    await res.body?.cancel()
    if (hop >= 3) throw new Error('too_many_redirects')
    target = publicHttpsUrl(new URL(location, target).href)
    if (!target) throw new Error('url_must_be_https')
  }
  const fail = async (error: string) => {
    await res.body?.cancel()
    throw new Error(error)
  }
  if (!res.ok) return fail(`http_${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!/^\s*(text\/|application\/json)/i.test(type)) return fail('unsupported_content_type')
  if (Number(res.headers.get('content-length')) > MAX_DOCUMENT_BYTES) return fail('too_large')
  const bytes = await readCapped(res, MAX_DOCUMENT_BYTES)
  let raw: string
  try {
    raw = new TextDecoder(/charset=["']?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8').decode(bytes)
  } catch {
    raw = new TextDecoder().decode(bytes)
  }
  const { title, text } = /html|xml/i.test(type) ? htmlToText(raw) : { title: '', text: raw.trim() }
  return { title, content: text.slice(0, MAX_DOCUMENT_CHARS) }
}

/* ---------- Products ---------- */

const optUrl = z.string().trim().max(2000).regex(/^(https?:\/\/\S+)?$/i, 'must be an http(s) URL').nullable()

/** A product as typed or imported. No defaults here: DEFAULT_PRODUCT (create) or the stored row (update) fills the rest. */
export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  price: z.number().int().min(0).nullable(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'must be a 3-letter currency code'),
  url: optUrl,
  imageUrl: optUrl,
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
  sku: z.string().trim().max(100).nullable(),
  inStock: z.boolean(),
})
export type ProductInput = z.infer<typeof productInputSchema>
export const DEFAULT_PRODUCT: Omit<ProductInput, 'name'> = { description: '', price: null, currency: 'JPY', url: null, imageUrl: null, tags: [], sku: null, inStock: true }

export function parseProduct(row: ProductRow): Product {
  return { ...row, tags: strings(row.tags), inStock: Boolean(row.inStock) }
}

const productValues = (p: ProductInput) => ({ ...p, currency: p.currency.toUpperCase(), url: p.url || null, imageUrl: p.imageUrl || null, sku: p.sku || null, tags: JSON.stringify(p.tags), inStock: p.inStock ? 1 : 0 })

/** CSV records (RFC 4180: quoted fields may hold commas, line breaks and `""`) with the line each starts on. Blank rows are skipped. */
function csvRecords(text: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let start = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else {
        cell += ch
        if (ch === '\n') line++
      }
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cells.push(cell)
      out.push({ line: start, cells })
      cells = []
      cell = ''
      start = ++line
    } else cell += ch
  }
  if (cell || cells.length) out.push({ line: start, cells: [...cells, cell] })
  return out.filter((r) => r.cells.some((c) => c.trim()))
}

const CSV_COLUMNS = ['name', 'description', 'price', 'currency', 'url', 'imageUrl', 'tags', 'sku', 'inStock'] as const
export const MAX_CSV_ROWS = 500

/**
 * Products from a CSV with a header row (`name` required; tags split on `|` or `;`). Invalid rows become errors.
 * `columns` lists the recognized header columns (an update by sku changes only those).
 */
export function parseProductsCsv(csv: string): { rows: ProductInput[]; errors: { line: number; error: string }[]; columns: string[] } {
  const [head, ...body] = csvRecords(csv.replace(/^\uFEFF/, ''))
  const rows: ProductInput[] = []
  const errors: { line: number; error: string }[] = []
  const cols = head?.cells.map((h) => CSV_COLUMNS.find((c) => c.toLowerCase() === h.trim().toLowerCase()))
  const columns = (cols ?? []).filter((c) => c !== undefined)
  if (!head || !cols?.includes('name')) return { rows, errors: [{ line: head?.line ?? 1, error: 'the header row needs a name column' }], columns }
  for (const [i, r] of body.entries()) {
    if (i >= MAX_CSV_ROWS) {
      errors.push({ line: r.line, error: `at most ${MAX_CSV_ROWS} rows per import; this row and the ones after it were skipped` })
      break
    }
    const cell: Partial<Record<(typeof CSV_COLUMNS)[number], string>> = {}
    cols.forEach((c, j) => c && (cell[c] = r.cells[j]?.trim() ?? ''))
    const stock = cell.inStock?.toLowerCase() ?? ''
    if (stock && !['true', 'false', '1', '0'].includes(stock)) {
      errors.push({ line: r.line, error: 'inStock: must be true, false, 1 or 0' })
      continue
    }
    const v = productInputSchema.safeParse({
      ...DEFAULT_PRODUCT,
      name: cell.name ?? '',
      description: cell.description ?? '',
      price: cell.price ? Number(cell.price.replace(/[,\s¥￥$€₩円]/g, '')) : null,
      currency: cell.currency || 'JPY',
      url: cell.url || null,
      imageUrl: cell.imageUrl || null,
      tags: (cell.tags ?? '').split(/[|;]/).map((t) => t.trim()).filter(Boolean),
      sku: cell.sku || null,
      inStock: stock ? stock === 'true' || stock === '1' : true,
    })
    if (v.success) rows.push(v.data)
    else errors.push({ line: r.line, error: issues(v.error).join('; ') })
  }
  return { rows, errors, columns }
}

/* ---------- FAQ suggestions ---------- */

const SUGGEST_RULES =
  'Each answer must state only facts given by the business, never guesses. Leave out personal data (names, phone numbers, addresses, order numbers). Write in the language of the source. For each question also give up to 3 other ways a customer might ask it ("variants"). Answer with a JSON array only: [{"question": string, "variants": string[], "answer": string}] ([] when there is nothing worth saving).'

/** FAQ candidates from a finished conversation (up to 3). */
export function faqSuggestPrompt(transcript: string): AiRequest {
  return {
    system: `You maintain the FAQ of a business. From the conversation below, write up to 3 general question / answer pairs that would help answer future customers. ${SUGGEST_RULES}`,
    messages: [{ role: 'user', content: transcript }],
    maxTokens: 1000,
  }
}

/** FAQ candidates from a document (up to 10). */
export function documentFaqPrompt(text: string): AiRequest {
  return {
    system: `You maintain the FAQ of a business. From the document below, write up to 10 question / answer pairs customers are likely to ask. ${SUGGEST_RULES}`,
    messages: [{ role: 'user', content: text }],
    maxTokens: 2000,
  }
}

/** `[{"question","variants","answer"}]` from a model reply (fences and surrounding prose allowed; ≤ 3 distinct variants, missing ones are fine). */
export function parseFaqSuggestions(raw: string, max = 3): { question: string; variants: string[]; answer: string }[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end < start) return []
  let v: unknown
  try {
    v = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(v)) return []
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  return v
    .flatMap((x: { question?: unknown; variants?: unknown; answer?: unknown } | null) => {
      const question = str(x?.question).slice(0, 500)
      const answer = str(x?.answer).slice(0, 4000)
      const seen = new Set([sameKey(question)])
      const variants = (Array.isArray(x?.variants) ? x.variants : [])
        .map((v) => str(v).slice(0, 500))
        .filter((v) => v && !seen.has(sameKey(v)) && seen.add(sameKey(v)))
        .slice(0, 3)
      return question && answer ? [{ question, variants, answer }] : []
    })
    .slice(0, max)
}

/* ---------- Knowledge storage (shared by the API and MCP; every query is scoped to the workspace) ---------- */

const phrase = z.string().trim().min(1).max(500)
export const faqInputSchema = z
  .object({ question: phrase, variants: z.array(phrase).max(10), answer: z.string().trim().min(1).max(4000), status: z.enum(['approved', 'suggested']) })
  .refine((f) => new Set(phrasings(f).map(sameKey)).size === f.variants.length + 1, { message: 'repeats the question or another variant', path: ['variants'] })

export async function listFaqs(db: Db, ws: number, status?: string) {
  const f = schema.faqs
  const only = status === 'approved' || status === 'suggested' ? eq(f.status, status) : undefined
  return (await db.select().from(f).where(and(eq(f.workspaceId, ws), only)).orderBy(desc(f.updatedAt), desc(f.id))).map(parseFaq)
}

/** Creates (`id` null) or updates a FAQ from a partial body. Approving a suggestion = setting status "approved". */
export async function saveFaq(db: Db, ws: number, id: number | null, body: object): Promise<{ faq: FaqRow } | Fail> {
  const f = schema.faqs
  const row = id === null ? undefined : await db.select().from(f).where(and(eq(f.id, id), eq(f.workspaceId, ws))).get()
  if (id !== null && !row) return { error: 'not_found' }
  const v = faqInputSchema.safeParse({ ...(row ? parseFaq(row) : { status: 'approved', variants: [] }), ...defined(body) })
  if (!v.success) return { error: 'invalid_faq', errors: issues(v.error) }
  const values = { ...v.data, variants: JSON.stringify(v.data.variants) }
  const faq = row ? await db.update(f).set({ ...values, updatedAt: now() }).where(eq(f.id, row.id)).returning().get() : await db.insert(f).values({ workspaceId: ws, ...values }).returning().get()
  return { faq: parseFaq(faq!) }
}

export async function deleteFaq(db: Db, ws: number, id: number): Promise<boolean> {
  const f = schema.faqs
  return Boolean(await db.delete(f).where(and(eq(f.id, id), eq(f.workspaceId, ws))).returning({ id: f.id }).get())
}

export async function listProducts(db: Db, ws: number, q = '') {
  const p = schema.products
  const s = q.trim() ? `%${q.trim()}%` : null
  const rows = await db
    .select()
    .from(p)
    .where(and(eq(p.workspaceId, ws), s ? or(like(p.name, s), like(p.sku, s), like(p.tags, s)) : undefined))
    .orderBy(p.name, p.id)
  return rows.map(parseProduct)
}

export async function saveProduct(db: Db, ws: number, id: number | null, body: object): Promise<{ product: Product } | Fail> {
  const p = schema.products
  const row = id === null ? undefined : await db.select().from(p).where(and(eq(p.id, id), eq(p.workspaceId, ws))).get()
  if (id !== null && !row) return { error: 'not_found' }
  const v = productInputSchema.safeParse({ ...(row ? parseProduct(row) : DEFAULT_PRODUCT), ...defined(body) })
  if (!v.success) return { error: 'invalid_product', errors: issues(v.error) }
  const values = productValues(v.data)
  const saved = row ? await db.update(p).set({ ...values, updatedAt: now() }).where(eq(p.id, row.id)).returning().get() : await db.insert(p).values({ workspaceId: ws, ...values }).returning().get()
  return { product: parseProduct(saved!) }
}

export async function deleteProduct(db: Db, ws: number, id: number): Promise<boolean> {
  const p = schema.products
  return Boolean(await db.delete(p).where(and(eq(p.id, id), eq(p.workspaceId, ws))).returning({ id: p.id }).get())
}

/**
 * Imports a product CSV in one D1 batch. A row whose sku matches a stored product updates the columns the CSV has
 * (the last row with that sku wins); other rows are added.
 */
export async function importProducts(db: Db, ws: number, csv: string) {
  const { rows, errors, columns } = parseProductsCsv(csv)
  const p = schema.products
  const stored = new Map((await db.select({ id: p.id, sku: p.sku }).from(p).where(and(eq(p.workspaceId, ws), isNotNull(p.sku)))).map((r) => [r.sku!, r.id]))
  const last = new Map(rows.map((r, i) => [r.sku, i]))
  const time = now()
  let updated = 0
  const stmts = rows
    .filter((r, i) => !r.sku || last.get(r.sku) === i)
    .map((r) => {
      const id = r.sku ? stored.get(r.sku) : undefined
      if (id) updated++
      const values = productValues(r)
      if (!id) return db.insert(p).values({ workspaceId: ws, ...values })
      return db
        .update(p)
        .set({ ...Object.fromEntries(Object.entries(values).filter(([k]) => columns.includes(k))), updatedAt: time })
        .where(eq(p.id, id))
    })
  if (stmts.length) await db.batch(stmts as unknown as Parameters<Db['batch']>[0])
  return { imported: stmts.length - updated, updated, errors }
}

const d = schema.documents
/** Documents without their text (`chars` is its length). */
const documentColumns = { id: d.id, name: d.name, url: d.url, status: d.status, error: d.error, chars: sql<number>`length(${d.content})`, fetchedAt: d.fetchedAt, createdAt: d.createdAt }

export const listDocuments = (db: Db, ws: number) => db.select(documentColumns).from(d).where(eq(d.workspaceId, ws)).orderBy(desc(d.createdAt), desc(d.id))
const documentById = (db: Db, ws: number, id: number) => db.select(documentColumns).from(d).where(and(eq(d.id, id), eq(d.workspaceId, ws))).get()

/** Fetches a document's URL; a failure is stored on the row (status "failed") rather than thrown. */
async function load(url: string) {
  const fetchedAt = now()
  try {
    const page = await fetchDocument(url)
    if (!page.content) throw new Error('no_text')
    return { title: page.title, content: page.content, status: 'ready', error: null, fetchedAt }
  } catch (e) {
    return { title: '', content: null, status: 'failed', error: errorText(e), fetchedAt }
  }
}

const documentInputSchema = z
  .object({
    name: z.string().trim().max(120).nullish(),
    url: z.string().trim().max(2000).regex(/^(https:\/\/\S+)?$/i, 'must be an https:// URL').nullish(),
    text: z.string().trim().max(MAX_DOCUMENT_CHARS).nullish(),
  })
  .refine((v) => v.url || v.text, 'url or text is required')

/** Adds a page (`url`, fetched now) or pasted `text`. */
export async function addDocument(db: Db, ws: number, body: object): Promise<{ document: NonNullable<Awaited<ReturnType<typeof documentById>>> } | Fail> {
  const v = documentInputSchema.safeParse(body)
  if (!v.success) return { error: 'invalid_document', errors: issues(v.error) }
  const { url, text } = v.data
  const got = url ? await load(url) : null
  const name = (v.data.name || got?.title || url || text!.split('\n')[0]!).slice(0, 120)
  const row = await db
    .insert(d)
    .values({ workspaceId: ws, name, url: url || null, content: got ? (got.content ?? '') : text!, status: got?.status ?? 'ready', error: got?.error ?? null, fetchedAt: got?.fetchedAt ?? null })
    .returning({ id: d.id })
    .get()
  return { document: (await documentById(db, ws, row!.id))! }
}

/** Fetches a document's URL again. A failure keeps the old text but marks it failed (not used until fixed). */
export async function refreshDocument(db: Db, ws: number, id: number) {
  const row = await documentById(db, ws, id)
  if (!row) return { error: 'not_found' }
  if (!row.url) return { error: 'no_url' }
  const got = await load(row.url)
  await db
    .update(d)
    .set({ status: got.status, error: got.error, fetchedAt: got.fetchedAt, ...(got.content !== null && { content: got.content }) })
    .where(eq(d.id, id))
  return { document: (await documentById(db, ws, id))! }
}

/** Deletes a document and the FAQ suggestions made from it (approved ones stay). */
export async function deleteDocument(db: Db, ws: number, id: number): Promise<boolean> {
  const gone = await db.delete(d).where(and(eq(d.id, id), eq(d.workspaceId, ws))).returning({ id: d.id }).get()
  if (gone) await db.delete(schema.faqs).where(and(eq(schema.faqs.workspaceId, ws), eq(schema.faqs.documentId, id), eq(schema.faqs.status, 'suggested')))
  return Boolean(gone)
}

/** Inserts AI suggestions none of whose phrasings is already a FAQ question or variant (case-insensitive). */
async function addSuggestions(db: Db, ws: number, items: { question: string; variants: string[]; answer: string }[], from: { source: 'conversation' | 'document'; contactId?: number; documentId?: number }) {
  if (!items.length) return 0
  const f = schema.faqs
  const seen = new Set((await db.select({ q: f.question, v: f.variants }).from(f).where(eq(f.workspaceId, ws))).flatMap((r) => [r.q, ...strings(r.v)].map(sameKey)))
  const fresh = items.filter((i) => {
    const keys = phrasings(i).map(sameKey)
    if (keys.some((k) => seen.has(k))) return false
    keys.forEach((k) => seen.add(k))
    return true
  })
  // One statement per row: 10 rows × 11 values in one insert would pass D1's 100 bound parameters per query.
  const stmts = fresh.map((i) => db.insert(f).values({ workspaceId: ws, ...i, variants: JSON.stringify(i.variants), status: 'suggested', source: from.source, contactId: from.contactId ?? null, documentId: from.documentId ?? null }))
  if (stmts.length) await db.batch(stmts as unknown as Parameters<Db['batch']>[0])
  return fresh.length
}

/** FAQ suggestions (≤ 10) from the start of a document. Null when the document does not exist. Throws AI errors. */
export async function generateDocumentFaqs(db: Db, ws: number, ai: AiCaller, documentId: number): Promise<number | null> {
  const row = await db.select({ content: d.content }).from(d).where(and(eq(d.id, documentId), eq(d.workspaceId, ws))).get()
  if (!row) return null
  if (!row.content.trim()) return 0
  return addSuggestions(db, ws, parseFaqSuggestions(await ai(documentFaqPrompt(row.content.slice(0, 12_000))), 10), { source: 'document', documentId })
}

/** Text messages of a contact, oldest first. */
async function recentMessages(db: Db, contactId: number, limit: number) {
  const m = schema.messages
  const rows = await db
    .select({ direction: m.direction, text: m.text })
    .from(m)
    .where(and(eq(m.contactId, contactId), isNotNull(m.text), ne(m.text, '')))
    .orderBy(desc(m.id))
    .limit(limit)
  return rows.reverse()
}

/** FAQ suggestions (≤ 3) from a finished conversation. Throws AI errors. */
export async function suggestFaqs(db: Db, ws: number, ai: AiCaller, contactId: number): Promise<number> {
  const history = await recentMessages(db, contactId, 30)
  if (!history.some((h) => h.direction === 'out')) return 0
  const transcript = history.map((h) => `${h.direction === 'in' ? 'Customer' : 'Business'}: ${h.text}`).join('\n')
  return addSuggestions(db, ws, parseFaqSuggestions(await ai(faqSuggestPrompt(transcript)), 3), { source: 'conversation', contactId })
}

/** Everything the bot may answer from: approved FAQs, ready documents, products in stock. */
// ponytail: loads every document's full text per message; split into a chunk table when documents get large or many.
export async function loadKnowledge(db: Db, ws: number) {
  const f = schema.faqs
  const p = schema.products
  const [faqs, documents, products] = await Promise.all([
    db.select({ id: f.id, question: f.question, variants: f.variants, answer: f.answer }).from(f).where(and(eq(f.workspaceId, ws), eq(f.status, 'approved'))).orderBy(f.id),
    db.select({ id: d.id, name: d.name, content: d.content }).from(d).where(and(eq(d.workspaceId, ws), eq(d.status, 'ready'))).orderBy(d.id),
    db.select().from(p).where(and(eq(p.workspaceId, ws), eq(p.inStock, 1))).orderBy(p.id),
  ])
  return { faqs: faqs.map(parseFaq), documents, products: products.map(parseProduct) }
}

/** Products of the workspace by id, in the order asked (unknown ids are skipped). */
export async function loadProducts(db: Db, ws: number, ids: number[]) {
  const p = schema.products
  if (!ids.length) return []
  const rows = await db.select().from(p).where(and(eq(p.workspaceId, ws), inArray(p.id, ids)))
  return [...new Set(ids)].flatMap((id) => rows.filter((r) => r.id === id)).map(parseProduct)
}

const countIf = (cond: ReturnType<typeof sql>) => sql<number>`coalesce(sum(case when ${cond} then 1 else 0 end), 0)`

export async function knowledgeCounts(db: Db, ws: number) {
  const f = schema.faqs
  const [faqs, documents, products] = await Promise.all([
    db.select({ approved: countIf(sql`${f.status} = 'approved'`), suggested: countIf(sql`${f.status} = 'suggested'`) }).from(f).where(eq(f.workspaceId, ws)).get(),
    db.select({ n: sql<number>`count(*)` }).from(d).where(eq(d.workspaceId, ws)).get(),
    db.select({ n: sql<number>`count(*)` }).from(schema.products).where(eq(schema.products.workspaceId, ws)).get(),
  ])
  return { faqs: faqs?.approved ?? 0, suggested: faqs?.suggested ?? 0, documents: documents?.n ?? 0, products: products?.n ?? 0 }
}

/* ---------- Overview ---------- */

/** Numbers for the overview: whole UTC days up to today (`days` buckets), from the bot_* events. */
export async function botOverview(db: Db, ws: number, days: number, aiConfigured: boolean) {
  const e = schema.events
  const f = schema.faqs
  const today = new Date()
  const first = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1))
  const since = new Date(first).toISOString()
  const inPeriod = and(eq(e.workspaceId, ws), gte(e.createdAt, since))
  const day = sql<string>`substr(${e.createdAt}, 1, 10)`
  const reason = sql<string>`coalesce(json_extract(${e.meta}, '$.reason'), 'other')`
  const [cfg, daily, handled, reasons, topFaqs, topProducts, knowledge] = await Promise.all([
    getBotConfig(db, ws),
    db
      .select({ day, type: e.type, n: sql<number>`count(*)` })
      .from(e)
      .where(and(inPeriod, inArray(e.type, ['bot_reply', 'bot_handoff', 'bot_resolved'])))
      .groupBy(day, e.type),
    // A conversation Soku took: it replied, or it decided to pass it to a person.
    db
      .select({ n: sql<number>`count(distinct ${e.contactId})` })
      .from(e)
      .where(and(inPeriod, inArray(e.type, ['bot_reply', 'bot_handoff'])))
      .get(),
    db
      .select({ reason, count: sql<number>`count(*)` })
      .from(e)
      .where(and(inPeriod, eq(e.type, 'bot_handoff')))
      .groupBy(reason)
      .orderBy(desc(sql`count(*)`)),
    db.select({ id: f.id, question: f.question, uses: f.uses }).from(f).where(and(eq(f.workspaceId, ws), gt(f.uses, 0))).orderBy(desc(f.uses), f.id).limit(5),
    db.all<{ id: number; name: string; count: number }>(sql`
      select p.id as id, p.name as name, count(*) as count
      from events e, json_each(e.meta, '$.productIds') j
      join products p on p.id = j.value and p.workspace_id = ${ws}
      where e.workspace_id = ${ws} and e.type = 'bot_reply' and e.created_at >= ${since}
      group by p.id order by count desc, p.name limit 5`),
    knowledgeCounts(db, ws),
  ])
  const series = Array.from({ length: days }, (_, i) => ({ day: new Date(first + i * 86400_000).toISOString().slice(0, 10), replies: 0, handoffs: 0, resolved: 0 }))
  const byDay = new Map(series.map((p) => [p.day, p]))
  const key = { bot_reply: 'replies', bot_handoff: 'handoffs', bot_resolved: 'resolved' } as const
  const totals = { replies: 0, handoffs: 0, resolved: 0 }
  for (const r of daily) {
    const k = key[r.type as keyof typeof key]
    const p = byDay.get(r.day)
    if (!k || !p) continue
    p[k] += r.n
    totals[k] += r.n
  }
  const n = handled?.n ?? 0
  const rate = (x: number) => (n ? Math.min(100, Math.round((x / n) * 100)) : 0)
  return {
    days,
    enabled: cfg.enabled,
    name: cfg.name,
    aiConfigured,
    handled: n,
    ...totals,
    resolutionRate: rate(totals.resolved),
    handoffRate: rate(totals.handoffs),
    avgTurns: n ? Math.round((totals.replies / n) * 10) / 10 : 0,
    series,
    handoffReasons: reasons,
    topFaqs,
    topProducts,
    knowledge,
  }
}

/* ---------- Running ---------- */

const REASON_LABELS: Record<HandoffReason, string> = {
  customer_request: '相手が担当者を希望',
  missing_knowledge: 'ナレッジにない',
  policy: 'ルールで回答不可',
  max_turns: '回数の上限',
  ai_error: 'AI の失敗',
  other: 'その他',
}

/**
 * Passes a conversation to the team: pauses the bot for the contact, ends its session and sequences, notifies,
 * and sends `message`. With `by` (Soku's decision) it also records a `bot_handoff` event; hand-over keywords pass none.
 */
export async function handoffToHuman(db: Db, ws: number, adapter: ChannelAdapter, contact: ContactRow, replyToken: string | undefined, message: string, by?: { bot: string; reason: HandoffReason }) {
  const name = contact.displayName ?? contact.channelUserId
  await setBotPaused(db, contact.id, true)
  await db.delete(schema.sessions).where(eq(schema.sessions.contactId, contact.id))
  await db.delete(schema.sequenceSubscriptions).where(eq(schema.sequenceSubscriptions.contactId, contact.id))
  // "が担当者を希望" is what the dashboard counts as a hand-over request.
  const text = !by || by.reason === 'customer_request' ? `${name} が担当者を希望しています` : `${by.bot} が ${name} の会話を担当者に渡しました (${REASON_LABELS[by.reason]})`
  await db.insert(schema.notifications).values({ workspaceId: ws, contactId: contact.id, text })
  if (by) await logEvent(db, { workspaceId: ws, type: 'bot_handoff', channel: contact.channel, contactId: contact.id, meta: { reason: by.reason } })
  if (message) {
    const res = await adapter.send(contact.channelUserId, { text: message }, { replyToken })
    await logMessage(db, { contactId: contact.id, direction: 'out', source: 'bot', kind: 'text', text: message, payload: by ? { bot: by.bot } : undefined, error: res.ok ? undefined : res.error })
  }
}

export type BotContext = { db: Db; ws: number; adapter: ChannelAdapter; contact: ContactRow; replyToken?: string; ai?: AiCaller; general: GeneralSettings }

/** Answers one inbound text with Soku. Returns true when Soku handled it (replied or passed it to a person). */
export async function runBot({ db, ws, adapter, contact, replyToken, ai, general }: BotContext, text: string): Promise<boolean> {
  const cfg = await getBotConfig(db, ws)
  if (!cfg.enabled || !ai || !cfg.channels.includes(contact.channel as Channel)) return false
  if (cfg.segmentId !== null) {
    const seg = await loadSegment(db, ws, cfg.segmentId)
    if (!seg || !matchesSegment(seg, contact, await getTags(db, contact.id))) return false
  }
  const handoff = async (reason: HandoffReason) => {
    await handoffToHuman(db, ws, adapter, contact, replyToken, cfg.handoffMessage, { bot: cfg.name, reason })
    return true
  }
  const e = schema.events
  const since = new Date(Date.now() - 86400_000).toISOString()
  const turns = await db
    .select({ n: sql<number>`count(*)` })
    .from(e)
    .where(and(eq(e.workspaceId, ws), eq(e.type, 'bot_reply'), eq(e.contactId, contact.id), gte(e.createdAt, since)))
    .get()
  if ((turns?.n ?? 0) >= cfg.maxTurns) return handoff('max_turns')

  const knowledge = retrieve(text, await loadKnowledge(db, ws))
  let out: BotReply
  try {
    out = parseBotReply(await ai(buildBotPrompt({ cfg, general, contact, knowledge, history: await recentMessages(db, contact.id, 12), channel: contact.channel })))
  } catch (err) {
    const error = errorText(err)
    // ponytail: no AI provider saved means "not running", not a failure to log on every message.
    if (error === 'ai_not_configured') return false
    await logEvent(db, { workspaceId: ws, type: 'error', channel: contact.channel, contactId: contact.id, meta: { op: 'bot', error } })
    return cfg.unknownAction === 'handoff' ? handoff('ai_error') : false
  }
  const used = known(out, knowledge)
  const documentIds = used.documents.map((x) => x.id)
  const reply = async (message: { text: string; cards?: OutboundCard[] }, meta: object, payload: object = {}) => {
    const res = await adapter.send(contact.channelUserId, message, { replyToken })
    await logMessage(db, { contactId: contact.id, direction: 'out', source: 'bot', kind: message.cards ? 'cards' : 'text', text: message.text, payload: { bot: cfg.name, ...payload }, error: res.ok ? undefined : res.error })
    if (Object.keys(meta).length) await logEvent(db, { workspaceId: ws, type: 'bot_reply', channel: contact.channel, contactId: contact.id, meta })
  }

  if (out.action === 'handoff' || (out.action === 'unknown' && cfg.unknownAction === 'handoff')) return handoff(out.reason)
  if (out.action === 'unknown') {
    await reply({ text: cfg.fallbackMessage }, { faqIds: [], productIds: [], documentIds, fallback: true }, { faqIds: [], productIds: [] })
    return true
  }

  const faqIds = used.faqs.map((x) => x.id)
  const products = cfg.recommendProducts ? used.products : []
  const productIds = products.map((x) => x.id)
  const cards = productCards(products, botLang(cfg, general))
  const listed = productText(products.filter((x) => !x.url))
  await reply({ text: [out.reply, listed].filter(Boolean).join('\n\n'), cards: cards.length ? cards : undefined }, { faqIds, productIds, documentIds }, { faqIds, productIds, ...(cards.length && { cards }) })
  if (faqIds.length) await db.update(schema.faqs).set({ uses: sql`${schema.faqs.uses} + 1` }).where(and(eq(schema.faqs.workspaceId, ws), inArray(schema.faqs.id, faqIds)))
  if (out.resolved) {
    await logEvent(db, { workspaceId: ws, type: 'bot_resolved', channel: contact.channel, contactId: contact.id })
    if (cfg.autoClose) await db.update(schema.contacts).set({ status: 'closed', updatedAt: now() }).where(eq(schema.contacts.id, contact.id))
    if (cfg.resolveMessage) await reply({ text: cfg.resolveMessage }, {})
    if (cfg.suggestFaqs) await suggestFaqs(db, ws, ai, contact.id).catch(() => 0)
  }
  return true
}

/** One playground turn: what Soku would do with this conversation. Nothing is sent or logged. Throws AI errors. */
export async function botPlayground(db: Db, ws: number, ai: AiCaller, general: GeneralSettings, messages: AiMessage[], channel?: Channel) {
  const cfg = await getBotConfig(db, ws)
  const query = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const knowledge = retrieve(query, await loadKnowledge(db, ws))
  const history = messages.map((m) => ({ direction: m.role === 'user' ? 'in' : 'out', text: m.content }))
  const raw = await ai(buildBotPrompt({ cfg, general, knowledge, history, channel: channel ?? cfg.channels[0] ?? 'line' }))
  const out = parseBotReply(raw)
  const used = known(out, knowledge)
  const action = out.action === 'unknown' && cfg.unknownAction === 'handoff' ? 'handoff' : out.action
  return {
    reply: action === 'handoff' ? cfg.handoffMessage : action === 'unknown' ? cfg.fallbackMessage : out.reply,
    action,
    resolved: action === 'answer' && out.resolved,
    reason: out.reason,
    faqs: used.faqs.map((f) => ({ id: f.id, question: f.question })),
    products: action === 'answer' && cfg.recommendProducts ? used.products.map((p) => ({ id: p.id, name: p.name })) : [],
    documents: used.documents,
    raw,
  }
}

/** A reply draft for a staff member from the conversation, the knowledge and the persona. Null without messages. Throws AI errors. */
export async function botDraft(db: Db, ws: number, ai: AiCaller, general: GeneralSettings, contact: ContactRow): Promise<string | null> {
  const history = await recentMessages(db, contact.id, 12)
  if (!history.length) return null
  const query = [...history].reverse().find((h) => h.direction === 'in')?.text ?? ''
  const knowledge = retrieve(query, await loadKnowledge(db, ws))
  return (await ai(buildBotPrompt({ cfg: await getBotConfig(db, ws), general, contact, knowledge, history, channel: contact.channel, draft: true }))).trim()
}
