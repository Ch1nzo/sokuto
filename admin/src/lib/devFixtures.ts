/// <reference types="vite/client" />
/**
 * Dev-only worst-case fixtures for the admin UI (break-ui stress test).
 *
 * Loaded only through a dynamic import guarded by `import.meta.env.DEV` (see lib/api.ts and
 * App.tsx), so it is never part of the production bundle. Activate with `?data=worst|empty|one|huge`
 * while running `npm run dev:ui`. Responses are shaped exactly like src/routes/api.ts returns them,
 * and respect the API's own limits (inbox 100, messages 200, contacts page 50, broadcasts 100,
 * overview notifications 10).
 */

import { getWorkspaceId } from './api'

export const DATA_MODES = ['worst', 'empty', 'one', 'huge'] as const
export type DataMode = (typeof DATA_MODES)[number]

function isMode(v: string | null): v is DataMode {
  return v !== null && (DATA_MODES as readonly string[]).includes(v)
}

function modeFromUrl(): DataMode | null {
  const v = new URLSearchParams(window.location.search).get('data')
  return isMode(v) ? v : null
}

// Captured once from the URL at first import, then owned by the toggle. Kept in memory so in-app
// navigation (NavLinks drop the query string) keeps serving the same dataset until the toggle
// re-adds `?data=` to the URL.
let activeMode: DataMode | null = modeFromUrl()

export function getDataMode(): DataMode | null {
  return activeMode
}

export function setDataMode(mode: DataMode | null) {
  activeMode = mode
}

/* ---------- time helpers ---------- */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

/* ---------- realistic values ---------- */

const EMOJI_NAME = '👩🏽‍💻🌸✨💖🐶🍣🎀🌈⭐🍓💫🦄🎉💕🌷🍰🐱🌻💐🎶' // 20 graphemes: LINE's display-name limit, all emoji
const IG_USERNAME_30 = 'aleksandra.wisniewska_ceramics' // 30 chars: Instagram's username limit
const LINE_USER_ID = 'U4af4980629f2a1c3d5e7b9a0c2e4f6a8' // LINE user ids are "U" + 32 hex
const LONG_EMAIL = 'bartholomew.fitzgerald@northwind-industries-holdings.example.com'

// A pasted tracking URL, 2,000 characters, no spaces.
const LONG_URL = (() => {
  const base =
    'https://example.com/campaigns/autumn-2026/landing?utm_source=line&utm_medium=richmenu&utm_campaign=omotesando_reopening&ref='
  let s = base
  let i = 0
  while (s.length < 2000) s += `9f8e7d6c5b4a${(i++).toString(16)}`
  return s.slice(0, 2000)
})()

// Meta Send API error as stored by src/channels/meta.ts (`Meta ${code}: ${message}`), 300 chars.
const META_ERROR = (
  'Meta 10/2018278: (#10) This message is sent outside of allowed window. You can only send messages to a person within 24 hours of their last message unless you use a message tag. ' +
  'Learn more: https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/#standard-messaging-window-and-tags'
).slice(0, 300)

const TAGS_25 = ['customer-feedback-q3-2026', 'line-campaign-autumn-2026', 'needs-human-follow-up-now', 'omotesando-reopening-2026']

const FOURTEEN_TAGS = [
  'vip',
  ...TAGS_25,
  '来店予約済み',
  'クーポン配布済み',
  'instagram-dm',
  'newsletter',
  'q3',
  'urgent',
  'needs-review',
  'リピーター',
  'b2b',
]

// Broadcast body: 1,000 characters (unbounded TEXT column; LINE caps text at 5,000).
const BROADCAST_1000 = (() => {
  const para =
    '🎃ハロウィン限定🎃 いつも Café Lumière 表参道店をご利用いただきありがとうございます。10月31日までの期間中、このメッセージを店頭でご提示いただくと全ドリンクが20%オフになります。混雑が予想されますので、ご予約は https://example.com/reserve?store=omotesando&campaign=halloween-2026 からどうぞ。 '
  let s = ''
  while (s.length < 1000) s += para
  return s.slice(0, 1000)
})()

// When the form's name is blank the backend stores `text.slice(0, 30)` (src/routes/api.ts:410), which
// counts UTF-16 units: an emoji straddling unit 30 is cut in half, leaving a lone surrogate.
const BROADCAST_AUTO_TEXT =
  '本日から3日間限定、全ドリンク20%オフ！ご予約はお早めにどうぞ'.slice(0, 29) + '🎃 ハロウィン当日は仮装でご来店のお客様にクッキーをプレゼント。'
const BROADCAST_AUTO_NAME = BROADCAST_AUTO_TEXT.slice(0, 30)

// Inbox notes: 1,500 characters with line breaks (the API caps notes at 5,000).
const NOTES_1500 = (() => {
  const para =
    '2026/10/12 電話あり: 誕生日ディナーの予約を 11/3 19:00 に変更希望。窓際席、ケーキのプレート文字は「Happy Birthday Ola」。\nAllergies: shellfish, tree nuts — confirmed twice, kitchen informed.\n'
  let s = ''
  while (s.length < 1500) s += para
  return s.slice(0, 1500)
})()

// Segment name at 80 characters (the API allows up to 100).
const SEGMENT_NAME_80 = 'Stammkunden mit Newsletter-Abo, Herbstkampagne 2026 — 表参道店 来店予約済み・クーポン未使用・メール配信希望のお客様'.slice(0, 80)

// Snippet body: 2,000 characters, the API maximum, with paragraphs.
const SNIPPET_2000 = (() => {
  const para =
    'お問い合わせありがとうございます。Café Lumière 表参道店です。ご予約の変更・キャンセルは前日 18:00 まで https://example.com/reserve?store=omotesando から承ります。当日のご連絡はお電話 (03-1234-5678) でお願いいたします。\n\n'
  let s = ''
  while (s.length < 2000) s += para
  return s.slice(0, 2000)
})()

const POOL_NAMES = [
  '佐藤 美咲',
  'Tanaka Hiroshi',
  'Maria Garcia',
  '鈴木一郎',
  'Nguyễn Văn An',
  'Emily Chen',
  'たけし',
  'Kenji',
  'Sophie Martin',
  '山本 さくら',
  'Lukas Müller',
  'Ana Souza',
]

/* ---------- shapes (as returned by src/routes/api.ts) ---------- */

type Channel = 'line' | 'messenger' | 'instagram'

type ContactRow = {
  id: number
  channel: Channel
  channelUserId: string
  displayName: string | null
  avatarUrl: string | null
  username: string | null
  fields: Record<string, string>
  botPaused: number
  botPausedUntil: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  unread: number
  status: 'open' | 'closed'
  notes: string | null
  createdAt: string
  updatedAt: string
  tags: string[]
}

type Rule = { field: string; op: string; value?: string }
type Segment = { id: number; name: string; rules: Rule[]; mode: 'all' | 'any'; createdAt: string }
type Snippet = { id: number; name: string; text: string; createdAt: string }

type MessageRow = {
  id: number
  contactId: number
  direction: 'in' | 'out'
  source: 'user' | 'bot' | 'human' | 'system'
  kind: string
  text: string | null
  payload: Record<string, unknown> | null
  flowId: number | null
  stepId: string | null
  error: string | null
  createdAt: string
}

function channelUserId(channel: Channel, n: number): string {
  if (channel === 'line') return `U${(n * 2654435761).toString(16).padStart(8, '0').repeat(4).slice(0, 32)}`
  return String(7_212_345_678_901_234 + n)
}

function contact(id: number, p: Partial<ContactRow> & { channel: Channel }): ContactRow {
  return {
    id,
    channelUserId: channelUserId(p.channel, id),
    displayName: null,
    avatarUrl: null,
    username: null,
    fields: {},
    botPaused: 0,
    botPausedUntil: null,
    lastInboundAt: ago(id * 37 * MIN),
    lastOutboundAt: null,
    unread: 0,
    status: 'open',
    notes: null,
    createdAt: ago(40 * DAY),
    updatedAt: ago(id * 37 * MIN),
    tags: [],
    ...p,
  }
}

const CHANNELS: Channel[] = ['line', 'messenger', 'instagram']

function poolContact(id: number): ContactRow {
  const channel = CHANNELS[id % 3]!
  const name = POOL_NAMES[id % POOL_NAMES.length]!
  return contact(id, {
    channel,
    displayName: name,
    username: channel === 'instagram' ? `user_${id}` : null,
    fields: id % 4 === 0 ? { phone: `090-${String(1000 + (id % 9000)).padStart(4, '0')}-${String(id).padStart(4, '0')}` } : {},
    tags: id % 5 === 0 ? ['newsletter'] : [],
    unread: id % 7 === 0 ? 2 : 0,
    status: id % 4 === 3 && id % 7 !== 0 ? 'closed' : 'open',
  })
}

/* ---------- worst case ---------- */

function worstCrafted(): ContactRow[] {
  return [
    contact(1, {
      channel: 'line',
      displayName: EMOJI_NAME,
      unread: 999,
      botPaused: 1,
      tags: FOURTEEN_TAGS,
      lastInboundAt: ago(20 * 1000),
      fields: { first_name: EMOJI_NAME, phone: '+81 90-1234-5678', email: LONG_EMAIL },
    }),
    contact(2, {
      channel: 'messenger',
      displayName: 'Aleksandra Wiśniewska-Kowalczyk',
      unread: 1,
      tags: TAGS_25,
      lastInboundAt: ago(5 * MIN),
      notes: '常連さん。\nアレルギー: えび・かに\n担当: 田中',
      fields: { email: LONG_EMAIL, first_name: 'Aleksandra', company: 'Northwind Industries Holdings', plan: 'enterprise', lang: 'pl', city: 'Kraków', source: 'ad-1284', note: 'Prefers email' },
    }),
    contact(3, { channel: 'line', displayName: 'Jo', unread: 1, lastInboundAt: ago(2 * HOUR), tags: ['q3'] }),
    // Profile fetch failed: no name, no username. The UI must fall back to the channel user id.
    contact(4, { channel: 'line', channelUserId: LINE_USER_ID, displayName: null, username: null, lastInboundAt: null, lastOutboundAt: null, createdAt: ago(3 * DAY) }),
    contact(5, {
      channel: 'instagram',
      displayName: null,
      username: IG_USERNAME_30,
      lastInboundAt: ago(3 * DAY),
      tags: ['instagram-dm'],
    }),
    contact(6, { channel: 'messenger', displayName: 'Đặng Thị Ngọc Hân', lastInboundAt: ago(9 * DAY), status: 'closed', notes: NOTES_1500, fields: { phone: '+84 912 345 678' } }),
    contact(7, { channel: 'line', displayName: 'ปิ่นมณี ศรีสุวรรณ์', lastInboundAt: ago(40 * DAY), tags: ['リピーター'] }),
    contact(8, { channel: 'instagram', displayName: 'Christopher Alexander Montgomery III', username: 'chris.montgomery.iii.official', unread: 3 }),
    contact(9, { channel: 'messenger', displayName: 'Ólafur Darri Ólafsson', botPaused: 1 }),
    contact(10, { channel: 'line', displayName: '王秀英', fields: { name: '王秀英', phone: '080-0000-0001' } }),
  ]
}

function worstContacts(): ContactRow[] {
  const crafted = worstCrafted()
  const rest = Array.from({ length: 1284 - crafted.length }, (_, i) => poolContact(crafted.length + 1 + i))
  return [...crafted, ...rest]
}

function worstLastMessage(c: ContactRow): Omit<MessageRow, 'id'> | null {
  const base = { contactId: c.id, flowId: null, stepId: null, error: null }
  switch (c.id) {
    case 1:
      return { ...base, direction: 'in', source: 'user', kind: 'text', text: LONG_URL, payload: { type: 'message' }, createdAt: ago(20 * 1000) }
    case 2:
      // Image only, as logged for LINE: attachment without url, text null.
      return { ...base, direction: 'in', source: 'user', kind: 'image', text: null, payload: { type: 'message', attachments: [{ type: 'image' }] }, createdAt: ago(5 * MIN) }
    case 3:
      return { ...base, direction: 'out', source: 'human', kind: 'text', text: 'ok', payload: null, error: META_ERROR, createdAt: ago(2 * HOUR) }
    case 4:
      return null
    case 6:
      return { ...base, direction: 'in', source: 'user', kind: 'text', text: 'Cho mình hỏi\ncửa hàng mở cửa lúc mấy giờ ạ?', payload: { type: 'message' }, createdAt: ago(9 * DAY) }
    case 7:
      return { ...base, direction: 'out', source: 'bot', kind: 'text', text: 'ขอบคุณที่ติดต่อเรา ปิ่นมณี! เราจะตอบกลับโดยเร็วที่สุด', payload: null, createdAt: ago(40 * DAY) }
    default:
      return { ...base, direction: 'in', source: 'user', kind: 'text', text: 'こんにちは、予約の変更をお願いできますか？', payload: { type: 'message' }, createdAt: c.lastInboundAt ?? ago(DAY) }
  }
}

function worstMessages(contactId: number): MessageRow[] {
  const c = contactId
  const rows: Omit<MessageRow, 'id' | 'contactId' | 'flowId' | 'stepId'>[] = [
    { direction: 'in', source: 'system', kind: 'event', text: 'follow', payload: null, error: null, createdAt: ago(3 * DAY) },
    {
      direction: 'out',
      source: 'bot',
      kind: 'text',
      text: 'ご来店ありがとうございます！ご用件をお選びください。',
      payload: {
        // button labels up to 40 (validate.ts), choices up to 20
        buttons: [
          { label: 'Reservierungsänderung und Stornierungen', payload: 'reserve' },
          { label: 'メニューとアレルギー情報を確認する（英語メニューあり）', payload: 'menu' },
          { label: 'Open the reservation page', url: 'https://example.com/reserve?store=omotesando' },
        ],
        quickReplies: [
          { label: 'Benachrichtigungen', payload: 'n' },
          { label: '担当者と話したい', payload: 'h' },
          { label: 'No', payload: 'no' },
        ],
      },
      error: null,
      createdAt: ago(3 * DAY - MIN),
    },
    { direction: 'in', source: 'user', kind: 'text', text: LONG_URL, payload: { type: 'message' }, error: null, createdAt: ago(2 * DAY) },
    // LINE image: logged with an attachment that has no URL (src/channels/line.ts:47), text null.
    { direction: 'in', source: 'user', kind: 'image', text: null, payload: { type: 'message', attachments: [{ type: 'image' }] }, error: null, createdAt: ago(2 * DAY - 2 * MIN) },
    // Meta image: CDN URL that has since expired.
    {
      direction: 'in',
      source: 'user',
      kind: 'image',
      text: null,
      payload: { type: 'message', attachments: [{ type: 'image', url: 'https://example.com/expired/ig_cdn_9f8e7d6c5b4a_n.jpg?stp=dst-jpg&oh=00_expired' }] },
      error: null,
      createdAt: ago(2 * DAY - 3 * MIN),
    },
    {
      direction: 'in',
      source: 'user',
      kind: 'event',
      text: null,
      payload: { type: 'message', attachments: [{ type: 'file', url: 'https://example.com/files/Q3%20Board%20Deck%20%E2%80%94%20FINAL%20(revised)%20v12%20%5Bapproved%20by%20legal%5D.pdf' }] },
      error: null,
      createdAt: ago(2 * DAY - 4 * MIN),
    },
    { direction: 'in', source: 'user', kind: 'text', text: 'Đặng Thị Ngọc Hân — Cho mình đặt bàn 4 người tối thứ Bảy ạ. ปิ่นมณี ก็ไปด้วยนะคะ', payload: { type: 'message' }, error: null, createdAt: ago(DAY) },
    { direction: 'out', source: 'human', kind: 'text', text: 'Thank you! We have reserved a table for 4 at 19:00 on Saturday.', payload: null, error: META_ERROR, createdAt: ago(DAY - MIN) },
    { direction: 'in', source: 'user', kind: 'text', text: '<script>alert(1)</script> &amp; **bold**', payload: { type: 'message' }, error: null, createdAt: ago(3 * HOUR) },
    {
      direction: 'out',
      source: 'bot',
      kind: 'cards',
      text: 'ハロウィン限定のギフトはこちらです。表参道店限定の詰め合わせもございます。',
      payload: {
        bot: BOT_NAME_30,
        faqIds: [1],
        productIds: [1, 3, 5],
        // OutboundCard limits: title ≤ 40, subtitle ≤ 60 (src/bot.ts productCards)
        cards: [
          { title: fill('Reservierungsänderung Geschenkbox — 季節のフルーツタルト', 40), subtitle: fill('¥0 ギフトに人気の詰め合わせ。季節のフルーツタルトと焼き菓子。', 60), imageUrl: BROKEN_IMAGE, buttons: [{ label: '詳しく見る', url: 'https://example.com/shop/gift' }] },
          { title: '🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣', subtitle: '₩99,999,999', imageUrl: LOCAL_IMAGE, buttons: [{ label: '詳しく見る', url: 'https://example.com/shop/sushi' }] },
          { title: 'Jo', buttons: [{ label: '詳しく見る', url: 'https://example.com/shop/jo' }] },
        ],
      },
      error: null,
      createdAt: ago(2 * HOUR),
    },
    { direction: 'in', source: 'user', kind: 'text', text: '👍', payload: { type: 'message' }, error: null, createdAt: ago(20 * 1000) },
  ]
  return rows.map((r, i) => ({ id: c * 1000 + i + 1, contactId: c, flowId: null, stepId: null, ...r }))
}

function worstBroadcasts() {
  const b = (id: number, p: Record<string, unknown>) => ({
    id,
    name: 'Weekly update',
    channel: 'any',
    tag: null,
    text: 'Short message',
    imageUrl: null,
    status: 'done',
    total: 0,
    sent: 0,
    failed: 0,
    segmentId: null,
    buttons: [],
    messageTag: null,
    clicked: 0,
    scheduledAt: ago(id * DAY),
    createdAt: ago(id * DAY),
    ...p,
  })
  return [
    b(108, { name: BROADCAST_1000.slice(0, 30), text: BROADCAST_1000, tag: TAGS_25[0], status: 'scheduled', scheduledAt: new Date(Date.now() + 3 * DAY).toISOString(), total: 1284, segmentId: 1 }),
    b(107, {
      name: 'Paramètres de confidentialité et de sécurité — rappel',
      channel: 'messenger',
      tag: TAGS_25[1],
      status: 'running',
      total: 1284,
      sent: 642,
      failed: 1,
      clicked: 57,
      messageTag: 'CONFIRMED_EVENT_UPDATE',
      // labels up to 40, at most 3 (validate.ts broadcastButtonsSchema)
      buttons: [
        { label: 'Reservierungsänderung und Stornierungen', url: LONG_URL },
        { label: 'メニューとアレルギー情報を確認する（英語メニューあり）', flowId: 12 },
        { label: 'No', flowId: 3 },
      ],
    }),
    b(106, { name: BROADCAST_AUTO_NAME, text: BROADCAST_AUTO_TEXT, channel: 'line', status: 'done', total: 1, sent: 1, failed: 0 }),
    b(105, { name: 'Jo', channel: 'instagram', tag: 'vip', status: 'canceled', total: 0 }),
    b(104, { name: 'Benachrichtigungseinstellungen', text: LONG_URL.slice(0, 400), status: 'done', total: 1284, sent: 0, failed: 1284 }),
  ]
}

function worstTags() {
  return [
    { tag: 'newsletter', n: 1284 },
    ...TAGS_25.map((tag, i) => ({ tag, n: 1284 - i * 100 })),
    ...FOURTEEN_TAGS.filter((t) => !TAGS_25.includes(t) && t !== 'newsletter').map((tag) => ({ tag, n: 1 })),
  ]
}

function worstSegments(): Segment[] {
  const rules20: Rule[] = [
    ...FOURTEEN_TAGS.slice(0, 10).map((value) => ({ field: 'tag', op: 'has_tag', value })),
    { field: 'email', op: 'is_set' },
    { field: 'phone', op: 'is_empty' },
    { field: 'city', op: 'equals', value: 'Kraków' },
    { field: 'company', op: 'contains', value: 'Northwind Industries Holdings' },
    { field: 'days_since_last_inbound', op: 'lte', value: '30' },
    { field: 'days_since_created', op: 'gte', value: '365' },
    { field: 'channel', op: 'not_equals', value: 'line' },
    { field: 'tag', op: 'not_has_tag', value: 'urgent' },
    { field: 'source', op: 'not_equals', value: 'ad-1284' },
    { field: 'last_input', op: 'contains', value: 'Stornierung' },
  ]
  return [
    { id: 1, name: SEGMENT_NAME_80, rules: rules20, mode: 'any', createdAt: ago(30 * DAY) },
    { id: 2, name: 'VIP', rules: [{ field: 'tag', op: 'has_tag', value: 'vip' }], mode: 'all', createdAt: ago(10 * DAY) },
    { id: 3, name: '東京在住・未購入', rules: [{ field: 'city', op: 'equals', value: '東京' }, { field: 'purchased', op: 'is_empty' }], mode: 'all', createdAt: ago(DAY) },
  ]
}

function worstSnippets(): Snippet[] {
  return [
    // name at the 60-character limit, body at the 2,000-character limit
    { id: 1, name: 'ご予約の変更・キャンセル方法のご案内 (表参道店・渋谷店・オンライン予約共通、前日 18:00 まで受付、当日はお電話で)'.slice(0, 60), text: SNIPPET_2000, createdAt: ago(20 * DAY) },
    { id: 2, name: '営業時間', text: '営業時間は 11:00〜22:00 (L.O. 21:30) です。\n定休日: 火曜日', createdAt: ago(5 * DAY) },
    { id: 3, name: 'Link', text: LONG_URL.slice(0, 400), createdAt: ago(HOUR) },
  ]
}

// Contact 1 is enrolled in two sequences: a long name due in days, a short one due in minutes.
function worstSequences(contactId: number) {
  if (contactId !== 1) return []
  return [
    { id: 1, flowId: 21, name: 'Onboarding — 7-day welcome series for new LINE friends (Herbstkampagne 2026)', stepId: 'm3', resumeAt: new Date(Date.now() + 6 * DAY).toISOString() },
    { id: 2, flowId: 22, name: 'Jo', stepId: null, resumeAt: new Date(Date.now() + 5 * MIN).toISOString() },
  ]
}

function worstOverview() {
  const n = (id: number, contactId: number | null, text: string, ms: number) => ({ id, contactId, text, read: 0, createdAt: ago(ms) })
  // 25 unread in the table; the API returns only the newest 10 (src/routes/api.ts:35).
  return {
    general: { botName: 'Café Lumière 表参道店 公式アカウント サポートボット', paused: true },
    channels: ['line', 'messenger', 'instagram'],
    stats: { contacts: 1284, newContacts7d: 1, messagesIn7d: 48213, messagesOut7d: 0, flowsLive: 1, events30d: {} },
    notifications: [
      n(125, 4, `${LINE_USER_ID} が担当者を希望しています`, 20 * 1000),
      n(124, 1, `${EMOJI_NAME} が担当者を希望しています`, 4 * MIN),
      n(123, 2, 'Aleksandra Wiśniewska-Kowalczyk が自動化「Reservierungsänderung und Stornierungen — Herbstkampagne 2026」に反応しました', HOUR),
      n(122, 5, `@${IG_USERNAME_30} が担当者を希望しています`, 2 * HOUR),
      n(121, null, `Broadcast failed for 1284 contacts: ${META_ERROR}`, 5 * HOUR),
      n(120, 6, 'Đặng Thị Ngọc Hân が担当者を希望しています', DAY),
      n(119, 7, 'ปิ่นมณี ศรีสุวรรณ์ が担当者を希望しています', 2 * DAY),
      n(118, 3, 'Jo が担当者を希望しています', 3 * DAY),
      n(117, 8, 'Christopher Alexander Montgomery III が担当者を希望しています', 8 * DAY),
      n(116, 10, '王秀英 が担当者を希望しています', 30 * DAY),
    ],
  }
}

// 12 workspaces; names up to the API's 60-character limit (src/routes/api.ts workspaceName), mixed scripts and
// lengths. In `worst` the default workspace (id 1) was renamed to the longest name, so the shell shows it.
const LONG_WORKSPACE_NAME = 'Café Lumière 表参道店 (Omotesando) — Reservations, Takeout & Events'.slice(0, 60)
const WORKSPACE_NAMES = [
  'Jo',
  '渋谷店',
  '🍣 寿司 Bar 銀座',
  'Aleksandra Wiśniewska-Kowalczyk Ceramics',
  'Northwind Industries Holdings — EMEA Support',
  'B',
  'ปิ่นมณี สาขาสยาม',
  'Đặng Thị Ngọc Hân Spa',
  'Staging (do not use)',
  'test',
  'Default',
]

function workspacesFixture(mode: DataMode) {
  // `empty` / `one` still have Default: workspace 1 always exists and cannot be deleted.
  const all =
    mode === 'worst'
      ? [
          { id: 1, name: LONG_WORKSPACE_NAME, createdAt: ago(400 * DAY) },
          ...WORKSPACE_NAMES.map((name, i) => ({ id: i + 2, name, createdAt: ago((300 - i * 25) * DAY) })),
        ]
      : [{ id: 1, name: 'Default', createdAt: ago(400 * DAY) }]
  const id = Number(getWorkspaceId())
  return { workspaces: all, current: all.some((w) => w.id === id) ? id : 1 }
}

/* ---------- flows / reports ---------- */

type FlowRow = {
  id: number
  workspaceId: number
  name: string
  channel: Channel | 'any'
  status: 'live' | 'draft'
  kind: 'flow' | 'sequence'
  definition: { triggers: Record<string, unknown>[]; entry: string | null; steps: unknown[] }
  createdAt: string
  updatedAt: string
  runs30d: number
}

function flowRow(id: number, p: Partial<FlowRow>): FlowRow {
  return {
    id,
    workspaceId: 1,
    name: '営業時間の案内',
    channel: 'any',
    status: 'live',
    kind: 'flow',
    definition: { triggers: [{ type: 'keyword', keywords: ['営業時間'] }], entry: null, steps: [] },
    createdAt: ago(60 * DAY),
    updatedAt: ago(id * 5 * HOUR),
    runs30d: 0,
    ...p,
  }
}

const KEYWORDS_20 = ['予約', 'よやく', 'reservation', 'Reservierung', 'booking', '席', 'テーブル', '人数', '変更', 'キャンセル', 'cancel', 'Stornierung', '時間', '営業時間', 'open', 'hours', '駐車場', 'parking', 'アレルギー', 'allergy']

// Flow names are unbounded (PUT /api/flows/:id only trims); 120 characters is a pasted campaign title.
function worstFlows(): FlowRow[] {
  const crafted: FlowRow[] = [
    flowRow(1, {
      name: 'Reservierungsänderung und Stornierungen — Herbstkampagne 2026 (表参道店・渋谷店 共通、LINE と Instagram の両方で受付、担当者に引き継ぎ)'.slice(0, 120),
      definition: { triggers: [{ type: 'keyword', keywords: KEYWORDS_20 }, { type: 'postback', payload: 'reserve' }, { type: 'ref', ref: 'autumn-2026-omotesando-richmenu' }], entry: 'm1', steps: [] },
      runs30d: 48213,
      updatedAt: ago(20 * 1000),
    }),
    flowRow(2, { name: 'Onboarding — 7-day welcome series for new LINE friends (Herbstkampagne 2026)', kind: 'sequence', channel: 'line', definition: { triggers: [], entry: 'm1', steps: [] }, runs30d: 1284 }),
    flowRow(3, { name: 'Jo', status: 'draft', definition: { triggers: [], entry: null, steps: [] }, updatedAt: ago(3 * DAY) }),
    flowRow(4, { name: 'ปิ่นมณี สาขาสยาม — ตอบกลับอัตโนมัติ', channel: 'instagram', definition: { triggers: [{ type: 'comment', keywords: ['ราคา', 'price'] }, { type: 'story_mention' }], entry: 'm1', steps: [] }, runs30d: 1 }),
    flowRow(5, { name: 'AI 応答 (営業時間外)', channel: 'messenger', definition: { triggers: [{ type: 'intent', description: 'Fragt nach Öffnungszeiten, Reservierungen oder Allergien und möchte eine schnelle Antwort ohne Wartezeit' }], entry: 'a1', steps: [] }, runs30d: 999_999 }),
    flowRow(6, { name: '友だち追加', channel: 'line', definition: { triggers: [{ type: 'follow' }], entry: 'm1', steps: [] }, runs30d: 7 }),
    flowRow(7, { name: 'Fallback', definition: { triggers: [{ type: 'any_message', cooldownHours: 720 }], entry: 'm1', steps: [] }, status: 'draft' }),
    flowRow(8, { name: 'Re-engagement — 30 Tage inaktiv', kind: 'sequence', status: 'draft', definition: { triggers: [], entry: null, steps: [] } }),
  ]
  const rest = Array.from({ length: 30 - crafted.length }, (_, i) =>
    flowRow(crafted.length + 1 + i, {
      name: `${POOL_NAMES[i % POOL_NAMES.length]} さん向けフォロー #${i + 1}`,
      channel: (['any', ...CHANNELS] as const)[i % 4],
      status: i % 3 === 0 ? 'draft' : 'live',
      kind: i % 5 === 0 ? 'sequence' : 'flow',
      definition: { triggers: i % 5 === 0 ? [] : [{ type: 'keyword', keywords: [`キーワード${i + 1}`] }], entry: null, steps: [] },
      runs30d: (i * 137) % 900,
    }),
  )
  return [...crafted, ...rest]
}

function reportsFor(flows: FlowRow[], days: number, scale: number) {
  const perFlow = flows.map((f, i) => {
    const started = f.runs30d ? Math.round(f.runs30d * scale) : 0
    return {
      id: f.id,
      name: f.name,
      status: f.status,
      channel: f.channel,
      started,
      messagesSent: started * 3,
      buttonClicks: Math.round(started * 0.4),
      inputs: Math.round(started * 0.2),
      completed: Math.round(started * 0.7),
      errors: i % 4 === 1 ? Math.round(started * 0.01) + 1 : 0,
    }
  })
  const today = new Date()
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)))
    // A quiet week, one campaign spike, and gaps (days with no row are filled in by the page).
    const n = i % 9 === 4 ? 0 : Math.round((i === days - 3 ? 40 : 1 + (i % 7)) * 120 * scale)
    return { day: d.toISOString().slice(0, 10), in: n, out: Math.round(n * 1.6), newContacts: Math.round(n / 40) }
  }).filter((p) => p.in > 0)
  return { days, flows: perFlow, series }
}

/* ---------- empty / one / huge ---------- */

function oneContact(): ContactRow {
  return contact(1, { channel: 'line', displayName: '佐藤 美咲', unread: 1, tags: ['vip'], fields: { phone: '090-1234-5678' }, lastInboundAt: ago(MIN * 2) })
}

function hugeContacts(): ContactRow[] {
  return Array.from({ length: 25_000 }, (_, i) => poolContact(i + 1))
}

function hugeFlows(): FlowRow[] {
  return Array.from({ length: 300 }, (_, i) =>
    flowRow(i + 1, { name: `自動化 ${i + 1}`, status: i % 4 === 0 ? 'draft' : 'live', kind: i % 10 === 0 ? 'sequence' : 'flow', runs30d: 25_000 - i * 50 }),
  )
}

function hugeMessages(contactId: number): MessageRow[] {
  return Array.from({ length: 200 }, (_, i) => ({
    id: contactId * 1000 + i + 1,
    contactId,
    direction: i % 2 === 0 ? 'in' : 'out',
    source: i % 2 === 0 ? 'user' : i % 6 === 1 ? 'human' : 'bot',
    kind: 'text',
    text: i % 2 === 0 ? `質問 ${i + 1}: 営業時間を教えてください。` : `回答 ${i + 1}: 11:00〜22:00 です。`,
    payload: null,
    flowId: null,
    stepId: null,
    error: null,
    createdAt: ago((200 - i) * 7 * MIN),
  }))
}

/* ---------- dashboard (GET /api/dashboard?days=) ---------- */

type DashPoint = { day: string; in: number; out: number; bot: number; human: number; newContacts: number }
type DashFlow = { id: number; name: string; kind: string; status: string; started: number; completed: number; errors: number; buttonClicks: number }
type DashRest = {
  channels: { channel: string; contacts: number; messagesIn: number }[]
  conversations: { open: number; closed: number; paused: number; unread: number }
  flows: DashFlow[]
  broadcasts: { count: number; total: number; sent: number; failed: number; clicked: number }
  handoffs: number
}

/** 90 UTC days ending today (index 89), oldest first, like the API's buckets. */
function dashSeries(point: (i: number) => Omit<DashPoint, 'day'>): DashPoint[] {
  const now = new Date()
  return Array.from({ length: 90 }, (_, i) => ({
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 89 + i)).toISOString().slice(0, 10),
    ...point(i),
  }))
}

/** The last `days` of a 90-day series plus the rest; `rest` gets the series and the period's share of 90 days. */
function dashboardFixture(days: number, full: DashPoint[], rest: (series: DashPoint[], share: number) => DashRest) {
  const series = full.slice(-days)
  const sum = (k: 'bot' | 'human') => series.reduce((s, p) => s + p[k], 0)
  return { days, series, replies: { bot: sum('bot'), human: sum('human') }, ...rest(series, days / 90) }
}

const sumIn = (series: DashPoint[]) => series.reduce((s, p) => s + p.in, 0)
const ZERO_DAY = { in: 0, out: 0, bot: 0, human: 0, newContacts: 0 }

// Spiky: whole days at zero, one 48,213-message day two days ago (inside every period), a single human reply.
const WORST_SERIES = dashSeries((i) => {
  if (i === 87) return { in: 48_213, out: 0, bot: 0, human: 0, newContacts: 1 }
  if (i % 7 === 3 || i % 11 === 0) return ZERO_DAY
  const out = (i * 53) % 90
  const human = i === 60 ? 1 : 0
  return { in: (i * 37) % 140, out: out + human, bot: out, human, newContacts: (i * 11) % 7 }
})

function worstDashboard(days: number) {
  return dashboardFixture(days, WORST_SERIES, (series) => ({
    // One channel dwarfs another; Messenger has no contacts (the API omits it).
    channels: [
      { channel: 'line', contacts: 1283, messagesIn: Math.max(0, sumIn(series) - 2) },
      { channel: 'instagram', contacts: 1, messagesIn: Math.min(2, sumIn(series)) },
    ],
    conversations: { open: 0, closed: 0, paused: 1284, unread: 999 },
    flows: [
      { id: 21, name: 'Onboarding — 7-day welcome series for new LINE friends (Herbstkampagne 2026)', kind: 'sequence', status: 'live', started: 48_213, completed: 48_213, errors: 0, buttonClicks: 0 },
      {
        id: 12,
        name: 'Reservierungsänderung und Stornierungen — Herbstkampagne 2026 表参道店・渋谷店・オンライン予約 共通の受付フロー (2026年10月改訂版)',
        kind: 'flow',
        status: 'live',
        started: 1284,
        completed: 3,
        errors: 999,
        buttonClicks: 1284,
      },
      { id: 3, name: 'Jo', kind: 'flow', status: 'draft', started: 1, completed: 4, errors: 0, buttonClicks: 0 }, // completed > started
      { id: 4, name: '🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣', kind: 'flow', status: 'live', started: 7, completed: 0, errors: 7, buttonClicks: 0 },
      { id: 5, name: 'ปิ่นมณี สาขาสยาม — ตอบกลับอัตโนมัติ', kind: 'flow', status: 'live', started: 0, completed: 0, errors: 3, buttonClicks: 0 }, // started 0
      { id: 6, name: LONG_URL.slice(0, 120), kind: 'flow', status: 'draft', started: 0, completed: 0, errors: 0, buttonClicks: 5 },
    ],
    // Sums of worstBroadcasts(): mostly failed.
    broadcasts: { count: 5, total: 3853, sent: 643, failed: 1285, clicked: 57 },
    handoffs: 1284,
  }))
}

function emptyDashboard(days: number) {
  return dashboardFixture(days, dashSeries(() => ZERO_DAY), () => ({
    channels: [],
    conversations: { open: 0, closed: 0, paused: 0, unread: 0 },
    flows: [],
    broadcasts: { count: 0, total: 0, sent: 0, failed: 0, clicked: 0 },
    handoffs: 0,
  }))
}

function oneDashboard(days: number) {
  return dashboardFixture(days, dashSeries((i) => (i === 89 ? { in: 1, out: 1, bot: 1, human: 0, newContacts: 1 } : ZERO_DAY)), () => ({
    channels: [{ channel: 'line', contacts: 1, messagesIn: 1 }],
    conversations: { open: 1, closed: 0, paused: 0, unread: 1 },
    flows: [{ id: 1, name: 'ようこそ', kind: 'flow', status: 'live', started: 1, completed: 1, errors: 0, buttonClicks: 0 }],
    // Same numbers as the `one` broadcast (sent + failed exceed total).
    broadcasts: { count: 1, total: 1, sent: 1, failed: 1, clicked: 1 },
    handoffs: 1,
  }))
}

// Weekly rhythm (quiet weekends) on a slow wave, ~2,600 messages in per day, 12 % of replies by a person.
const HUGE_SERIES = dashSeries((i) => {
  const wave = 1 + 0.25 * Math.sin(i / 9)
  const week = (i + 4) % 7 >= 5 ? 0.7 : 1
  const inn = Math.round(2600 * wave * week + ((i * 97) % 400))
  const out = Math.round(inn * 1.35)
  const human = Math.round(out * 0.12)
  return { in: inn, out, bot: out - human, human, newContacts: Math.round(180 * wave * week + ((i * 31) % 60)) }
})

const HUGE_FLOWS: [string, string, number, number, number][] = [
  // name, kind, started in 90 days, completion rate, errors in 90 days
  ['ようこそ (友だち追加)', 'flow', 41_200, 0.82, 12],
  ['予約の受付', 'flow', 18_400, 0.64, 0],
  ['営業時間・アクセス', 'flow', 9_850, 0.91, 85],
  ['Instagram コメント自動返信', 'flow', 6_120, 0.47, 3],
  ['クーポン配布', 'flow', 3_400, 0.73, 0],
  ['新規のお客様 7 日間フォロー', 'sequence', 1_980, 0.88, 1],
  ['アンケート (来店後)', 'flow', 870, 0.35, 40],
  ['FAQ: 配送について', 'flow', 240, 0.96, 0],
]

function hugeDashboard(days: number) {
  return dashboardFixture(days, HUGE_SERIES, (series, share) => {
    const received = sumIn(series)
    const n = Math.max(1, Math.round(13 * share)) // weekly broadcasts
    return {
      channels: [
        { channel: 'line', contacts: 15_250, messagesIn: Math.round(received * 0.61) },
        { channel: 'messenger', contacts: 6_120, messagesIn: Math.round(received * 0.24) },
        { channel: 'instagram', contacts: 3_630, messagesIn: received - Math.round(received * 0.61) - Math.round(received * 0.24) },
      ],
      conversations: { open: 2_431, closed: 22_257, paused: 312, unread: 1_284 },
      flows: HUGE_FLOWS.map(([name, kind, started, rate, errors], i) => {
        const s = Math.round(started * share)
        return { id: 100 + i, name, kind, status: 'live', started: s, completed: Math.round(s * rate), errors: Math.round(errors * share), buttonClicks: Math.round(s * 0.4) }
      }),
      broadcasts: { count: n, total: n * 25_000, sent: n * 24_870, failed: n * 130, clicked: n * 3_210 },
      handoffs: Math.round(980 * share),
    }
  })
}

/* ---------- Soku (GET /api/bot, /overview, /faqs, /documents, /products) ---------- */

/** `para` repeated and cut to exactly `n` characters. */
const fill = (para: string, n: number) => para.repeat(Math.ceil(n / para.length)).slice(0, n)

// Loads in dev (served by Vite), so the image path is exercised next to the 404 one.
const LOCAL_IMAGE = `${window.location.origin}/favicon.svg`
const BROKEN_IMAGE = 'https://example.com/images/products/missing-404.jpg'
const BOT_NAME_30 = 'Café Lumière 表参道店 予約とメニューの案内係 Soku'.slice(0, 30)

const BOT_DEFAULTS = {
  enabled: false,
  name: 'Soku',
  channels: ['line', 'messenger', 'instagram'],
  persona: '',
  guidelines: [] as string[],
  guardrails: [] as string[],
  handoffMessage: '担当者におつなぎします。少々お待ちください。',
  unknownAction: 'handoff',
  fallbackMessage: '申し訳ありません、その内容にはお答えできません。担当者が必要な場合は「担当者」と送ってください。',
  autoClose: true,
  resolveMessage: '',
  maxTurns: 10,
  recommendProducts: true,
  segmentId: null as number | null,
  suggestFaqs: false,
  language: 'auto',
}

type BotFaq = { id: number; question: string; variants: string[]; answer: string; status: 'approved' | 'suggested'; source: 'manual' | 'conversation' | 'document'; documentId: number | null; contactId: number | null; uses: number; createdAt: string; updatedAt: string }
type BotDoc = { id: number; name: string; url: string | null; status: 'ready' | 'failed'; error: string | null; chars: number; fetchedAt: string | null; createdAt: string }
type BotProduct = { id: number; name: string; description: string; price: number | null; currency: string; url: string | null; imageUrl: string | null; tags: string[]; sku: string | null; inStock: boolean; createdAt: string; updatedAt: string }

const faq = (id: number, p: Partial<BotFaq>): BotFaq => ({
  id,
  question: '営業時間を教えてください',
  variants: [],
  answer: '11:00〜22:00 (L.O. 21:30) です。火曜日は定休日です。',
  status: 'approved',
  source: 'manual',
  documentId: null,
  contactId: null,
  uses: 0,
  createdAt: ago(30 * DAY),
  updatedAt: ago(id * 3 * HOUR),
  ...p,
})

const doc = (id: number, p: Partial<BotDoc>): BotDoc => ({ id, name: 'アクセス', url: 'https://example.com/access', status: 'ready', error: null, chars: 1840, fetchedAt: ago(id * DAY), createdAt: ago(40 * DAY), ...p })

const product = (id: number, p: Partial<BotProduct>): BotProduct => ({
  id,
  name: 'ハウスブレンド 200g',
  description: '深煎りのハウスブレンド。チョコレートのような甘さとナッツの香り。',
  price: 1280,
  currency: 'JPY',
  url: 'https://example.com/shop/house-blend',
  imageUrl: LOCAL_IMAGE,
  tags: ['coffee', 'beans'],
  sku: `CL-${String(id).padStart(4, '0')}`,
  inStock: true,
  createdAt: ago(60 * DAY),
  updatedAt: ago(id * 5 * HOUR),
  ...p,
})

const QUESTION_500 = fill('ハロウィン期間中 (10/24〜10/31) の予約で、4 名以上・アレルギー対応 (えび・かに・ナッツ) ・個室希望・キャンセル料の扱い・駐車場の有無について、Reservierungsänderung und Stornierungen も含めて教えてください。🎃 ', 500)
/** The maximum: 10 other phrasings of 500 characters each. */
const VARIANTS_10x500 = Array.from({ length: 10 }, (_, i) => fill(`言い換え ${i + 1}: ${QUESTION_500}`, 500))
const ANSWER_4000 = fill('ご予約ありがとうございます。4 名以上のご予約は https://example.com/reserve?store=omotesando&party=4 から承ります。アレルギー対応はスタッフにお申し付けください。個室は 6 名まで、キャンセル料は前日 50%・当日 100% です。駐車場はございませんので近隣のコインパーキングをご利用ください。\n\n', 4000)

function worstFaqs(): BotFaq[] {
  const crafted = [
    faq(1, { question: QUESTION_500, variants: VARIANTS_10x500, answer: ANSWER_4000, uses: 48_213, updatedAt: ago(20 * 1000) }),
    faq(2, { question: '🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰？', variants: ['🎂？', '🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁🧁？'], answer: '🎂', source: 'conversation', contactId: 1, uses: 1 }),
    faq(3, { question: 'Link?', answer: LONG_URL.slice(0, 2000), source: 'document', documentId: 1, uses: 999 }),
    faq(4, { question: '?', variants: ['??'], answer: '—', uses: 0 }),
    faq(5, { question: 'Đặng Thị Ngọc Hân hỏi: cửa hàng có chỗ đậu xe không ạ? ปิ่นมณี ก็อยากรู้เหมือนกัน', answer: 'Không có chỗ đậu xe. ไม่มีที่จอดรถค่ะ', source: 'conversation', uses: 12 }),
  ]
  const approved = Array.from({ length: 30 - crafted.length }, (_, i) =>
    faq(crafted.length + 1 + i, { question: `${POOL_NAMES[i % POOL_NAMES.length]} さんからのよくある質問 #${i + 1}: テイクアウトはできますか？`, answer: 'はい、全メニューでテイクアウトできます。', uses: (i * 37) % 200, source: (['manual', 'conversation', 'document'] as const)[i % 3] }),
  )
  const suggested = [
    faq(101, { status: 'suggested', source: 'conversation', contactId: 2, question: QUESTION_500, variants: VARIANTS_10x500, answer: ANSWER_4000.slice(0, 1200), updatedAt: ago(5 * MIN) }),
    faq(102, { status: 'suggested', source: 'document', documentId: 1, question: 'Wi-Fi はありますか？', variants: ['ネットは使えますか？', 'Do you have Wi-Fi?', 'Wi-Fi のパスワードは？'], answer: 'はい、無料 Wi-Fi をご利用いただけます。パスワードは店内に掲示しています。', updatedAt: ago(HOUR) }),
    faq(103, { status: 'suggested', source: 'document', documentId: 1, question: 'ペット同伴は可能ですか？', answer: 'テラス席のみ小型犬の同伴が可能です。', updatedAt: ago(HOUR) }),
    faq(104, { status: 'suggested', source: 'conversation', contactId: 3, question: 'Jo', answer: LONG_URL.slice(0, 600), updatedAt: ago(DAY) }),
    faq(105, { status: 'suggested', source: 'conversation', contactId: 6, question: 'Cho mình hỏi cửa hàng mở cửa lúc mấy giờ ạ?', answer: '11:00〜22:00 です。', updatedAt: ago(2 * DAY) }),
  ]
  return [...suggested, ...crafted, ...approved]
}

function hugeFaqs(): BotFaq[] {
  return Array.from({ length: 1000 }, (_, i) =>
    faq(i + 1, { question: `よくある質問 ${i + 1}: ${['営業時間', '予約', '駐車場', 'アレルギー', '支払い方法'][i % 5]}について`, answer: `回答 ${i + 1}: 詳しくは店舗までお問い合わせください。`, status: i % 20 === 0 ? 'suggested' : 'approved', uses: (i * 7919) % 5000 }),
  )
}

const DOC_ERROR = `fetch_failed: ${META_ERROR}`.slice(0, 300)

function worstDocs(): BotDoc[] {
  return [
    doc(1, { name: 'Reservierungsänderung und Stornierungen — Herbstkampagne 2026 (表参道店・渋谷店 共通、LINE と Instagram の両方で受付) 予約ポリシー全文'.slice(0, 120), url: LONG_URL.slice(0, 200), chars: 200_000, fetchedAt: ago(20 * 1000) }),
    doc(2, { name: 'Menu PDF', url: 'https://example.com/files/menu-autumn-2026.pdf', status: 'failed', error: 'unsupported_content_type: application/pdf', chars: 0, fetchedAt: ago(HOUR) }),
    doc(3, { name: 'Old site', url: 'https://old.example.com/access', status: 'failed', error: DOC_ERROR, chars: 0, fetchedAt: ago(3 * DAY) }),
    doc(4, { name: 'FAQ', url: null, chars: 1, fetchedAt: null, createdAt: ago(10 * DAY) }),
    doc(5, { name: '🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣', url: 'https://example.com/sushi', chars: 48_213 }),
    doc(6, { name: 'ปิ่นมณี สาขาสยาม — ข้อมูลร้าน', url: 'https://example.com/th/siam', chars: 999 }),
  ]
}

const TAGS_20 = Array.from({ length: 20 }, (_, i) => fill(`tag${i + 1}-autumn-campaign-omotesando`, 30))

function worstProducts(): BotProduct[] {
  return [
    product(1, { name: fill('Reservierungsänderung Geschenkbox — 季節のフルーツタルトと焼き菓子の詰め合わせ (12 個入り、表参道店限定) ', 100), description: fill('ギフトに人気の詰め合わせ。', 1000), price: 0, tags: TAGS_20, sku: fill('CL-GIFT-AUTUMN-2026-OMOTESANDO-LIMITED-EDITION-', 64), imageUrl: BROKEN_IMAGE }),
    product(2, { name: 'Jo', price: null, currency: 'JPY', tags: [], sku: null, url: null, imageUrl: null, description: '' }),
    product(3, { name: '🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣', price: 99_999_999, currency: 'KRW', inStock: false, tags: ['寿司', 'limited'] }),
    product(4, { name: 'Single origin — Ethiopia Yirgacheffe', price: 18, currency: 'USD', tags: ['coffee', 'beans', 'single-origin', 'light-roast'] }),
    product(5, { name: 'Đặng Thị Ngọc Hân Spa voucher', price: 45, currency: 'EUR', url: LONG_URL.slice(0, 300), imageUrl: BROKEN_IMAGE }),
    product(6, { name: 'ปิ่นมณี ชุดของขวัญ', price: 3200, inStock: false, imageUrl: null }),
    product(7, { name: 'ハウスブレンド 200g' }),
    product(8, { name: 'ドリップバッグ 10 個入り', price: 1500, tags: ['coffee'] }),
  ]
}

function hugeProducts(): BotProduct[] {
  return Array.from({ length: 1000 }, (_, i) =>
    product(i + 1, { name: `商品 ${String(i + 1).padStart(4, '0')}`, price: 300 + ((i * 137) % 9000), imageUrl: i % 3 === 0 ? LOCAL_IMAGE : null, tags: [['coffee', 'tea', 'sweets', 'gift'][i % 4]!], inStock: i % 9 !== 0 }),
  )
}

const WORST_KNOWLEDGE = { faqs: 30, suggested: 5, documents: 6, products: 8 }
const HUGE_KNOWLEDGE = { faqs: 950, suggested: 50, documents: 300, products: 1000 }

function botFixture(mode: DataMode) {
  switch (mode) {
    case 'worst':
      return {
        aiConfigured: true,
        counts: WORST_KNOWLEDGE,
        config: {
          ...BOT_DEFAULTS,
          enabled: true,
          name: BOT_NAME_30,
          channels: ['line', 'instagram'],
          persona: fill('あなたは表参道のカフェ「Café Lumière」の案内係です。営業時間・予約・メニュー・アレルギーについて、丁寧かつ簡潔に答えます。 ', 2000),
          guidelines: Array.from({ length: 20 }, (_, i) => fill(`${i + 1}. 3 文以内で答え、予約やメニューの URL は https://example.com/reserve?store=omotesando&campaign=autumn-2026 のように省略せずに案内する。`, 200)),
          guardrails: Array.from({ length: 20 }, (_, i) => fill(`${i + 1}. 返金・値引き・在庫の確約をしない。Never promise refunds, discounts or stock. `, 200)),
          handoffMessage: fill('担当者におつなぎします。少々お待ちください。 ', 500),
          unknownAction: 'fallback',
          fallbackMessage: fill('申し訳ありません、その内容にはお答えできません。 ', 500),
          resolveMessage: fill('ご利用ありがとうございました。 ', 500),
          maxTurns: 50,
          segmentId: 1,
          suggestFaqs: true,
        },
      }
    case 'empty':
      return { aiConfigured: false, counts: { faqs: 0, suggested: 0, documents: 0, products: 0 }, config: BOT_DEFAULTS }
    case 'one':
      return {
        aiConfigured: true,
        counts: { faqs: 1, suggested: 0, documents: 1, products: 1 },
        config: { ...BOT_DEFAULTS, persona: '表参道のカフェの案内係です。', guidelines: ['短く答える'], guardrails: ['返金を約束しない'] },
      }
    case 'huge':
      return { aiConfigured: true, counts: HUGE_KNOWLEDGE, config: { ...BOT_DEFAULTS, enabled: true } }
  }
}

function botOverview(mode: DataMode, days: number) {
  const bot = botFixture(mode)
  const now = new Date()
  const series = (point: (i: number) => { replies: number; handoffs: number; resolved: number }) =>
    Array.from({ length: days }, (_, i) => ({ day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1 - i))).toISOString().slice(0, 10), ...point(i) }))
  const totals = (s: { replies: number; handoffs: number; resolved: number }[]) => ({
    replies: s.reduce((n, p) => n + p.replies, 0),
    handoffs: s.reduce((n, p) => n + p.handoffs, 0),
    resolved: s.reduce((n, p) => n + p.resolved, 0),
  })
  const base = { days, enabled: bot.config.enabled, name: bot.config.name, aiConfigured: bot.aiConfigured, knowledge: bot.counts }
  if (mode === 'empty') {
    const s = series(() => ({ replies: 0, handoffs: 0, resolved: 0 }))
    return { ...base, handled: 0, replies: 0, handoffs: 0, resolved: 0, resolutionRate: 0, handoffRate: 0, avgTurns: 0, series: s, handoffReasons: [], topFaqs: [], topProducts: [] }
  }
  if (mode === 'one') {
    const s = series((i) => (i === days - 1 ? { replies: 1, handoffs: 0, resolved: 1 } : { replies: 0, handoffs: 0, resolved: 0 }))
    return { ...base, handled: 1, replies: 1, handoffs: 0, resolved: 1, resolutionRate: 100, handoffRate: 0, avgTurns: 1, series: s, handoffReasons: [], topFaqs: [{ id: 1, question: '営業時間を教えてください', uses: 1 }], topProducts: [{ id: 1, name: 'ハウスブレンド 200g', count: 1 }] }
  }
  if (mode === 'worst') {
    // One 48,213-reply spike two days ago, quiet zero days, almost nothing resolved.
    const s = series((i) => (i === days - 3 ? { replies: 48_213, handoffs: 1_200, resolved: 0 } : i % 4 === 1 ? { replies: 0, handoffs: 0, resolved: 0 } : { replies: (i * 7) % 40, handoffs: i % 3, resolved: i === days - 1 ? 3 : 0 }))
    const sum = totals(s)
    return {
      ...base,
      handled: 1284,
      ...sum,
      resolutionRate: 0,
      handoffRate: 100,
      avgTurns: Math.round((sum.replies / 1284) * 10) / 10,
      series: s,
      handoffReasons: [
        { reason: 'missing_knowledge', count: Math.max(0, sum.handoffs - 290) },
        { reason: 'customer_request', count: 200 },
        { reason: 'max_turns', count: 50 },
        { reason: 'policy', count: 20 },
        { reason: 'ai_error', count: 19 },
        { reason: 'other', count: 1 },
      ],
      topFaqs: [
        { id: 1, question: QUESTION_500, uses: 48_213 },
        { id: 3, question: 'Link?', uses: 999 },
        { id: 2, question: '🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰🍰？', uses: 1 },
        { id: 5, question: 'Đặng Thị Ngọc Hân hỏi: cửa hàng có chỗ đậu xe không ạ?', uses: 1 },
        { id: 4, question: '?', uses: 0 },
      ],
      topProducts: worstProducts()
        .slice(0, 5)
        .map((p, i) => ({ id: p.id, name: p.name, count: [12_840, 999, 12, 1, 1][i]! })),
    }
  }
  const s = series((i) => {
    const r = Math.round(1800 * (1 + 0.3 * Math.sin(i / 5)))
    return { replies: r, handoffs: Math.round(r * 0.06), resolved: Math.round(r * 0.18) }
  })
  const sum = totals(s)
  const handled = Math.round(sum.replies / 3.2)
  return {
    ...base,
    handled,
    ...sum,
    resolutionRate: Math.round((sum.resolved / handled) * 100),
    handoffRate: Math.round((sum.handoffs / handled) * 100),
    avgTurns: 3.2,
    series: s,
    handoffReasons: [
      { reason: 'customer_request', count: Math.round(sum.handoffs * 0.5) },
      { reason: 'missing_knowledge', count: Math.round(sum.handoffs * 0.3) },
      { reason: 'max_turns', count: sum.handoffs - Math.round(sum.handoffs * 0.5) - Math.round(sum.handoffs * 0.3) },
    ],
    topFaqs: hugeFaqs()
      .slice(0, 5)
      .map((f, i) => ({ id: f.id, question: f.question, uses: 25_000 - i * 3_000 })),
    topProducts: hugeProducts()
      .slice(0, 5)
      .map((p, i) => ({ id: p.id, name: p.name, count: 4_000 - i * 500 })),
  }
}

const BOT_LISTS: Record<DataMode, { faqs: () => BotFaq[]; docs: () => BotDoc[]; products: () => BotProduct[] }> = {
  worst: { faqs: worstFaqs, docs: worstDocs, products: worstProducts },
  empty: { faqs: () => [], docs: () => [], products: () => [] },
  one: { faqs: () => [faq(1, { uses: 1 })], docs: () => [doc(1, {})], products: () => [product(1, {})] },
  huge: {
    faqs: hugeFaqs,
    docs: () => Array.from({ length: 300 }, (_, i) => doc(i + 1, { name: `ページ ${i + 1}`, url: `https://example.com/pages/${i + 1}`, status: i % 25 === 0 ? 'failed' : 'ready', error: i % 25 === 0 ? 'fetch_failed: 404' : null, chars: (i * 7919) % 200_000 })),
    products: hugeProducts,
  },
}

/** GET /api/bot* fixtures, or undefined for other paths. */
function botRoute(mode: DataMode, p: string, q: URLSearchParams): unknown {
  if (p === '/api/bot') return botFixture(mode)
  if (p === '/api/bot/overview') return botOverview(mode, Math.min(90, Math.max(1, Math.trunc(Number(q.get('days'))) || 30)))
  if (p === '/api/bot/faqs') {
    const status = q.get('status') ?? 'all'
    return { faqs: BOT_LISTS[mode].faqs().filter((f) => status === 'all' || f.status === status) }
  }
  if (p === '/api/bot/documents') return { documents: BOT_LISTS[mode].docs() }
  if (p === '/api/bot/products') {
    const term = q.get('q')?.toLowerCase()
    const rows = BOT_LISTS[mode].products().filter((x) => !term || [x.name, x.sku ?? '', ...x.tags].some((v) => v.toLowerCase().includes(term)))
    return { products: rows.sort((a, b) => a.name.localeCompare(b.name)) }
  }
  return undefined
}

/* ---------- routing ---------- */

type Dataset = {
  contacts: () => ContactRow[]
  lastMessage: (c: ContactRow) => Omit<MessageRow, 'id'> | null
  messages: (contactId: number) => MessageRow[]
  overview: () => unknown
  broadcasts: () => unknown[]
  tags: () => { tag: string; n: number }[]
  segments: () => Segment[]
  snippets: () => Snippet[]
  sequences: (contactId: number) => unknown[]
  flows: () => FlowRow[]
  reports: (days: number) => unknown
  dashboard: (days: number) => unknown
}

const genericLast = (c: ContactRow): Omit<MessageRow, 'id'> => ({
  contactId: c.id,
  direction: 'in',
  source: 'user',
  kind: 'text',
  text: '営業時間を教えてください',
  payload: { type: 'message' },
  flowId: null,
  stepId: null,
  error: null,
  createdAt: c.lastInboundAt ?? ago(DAY),
})

const DATASETS: Record<DataMode, Dataset> = {
  worst: {
    contacts: worstContacts,
    lastMessage: worstLastMessage,
    messages: worstMessages,
    overview: worstOverview,
    broadcasts: worstBroadcasts,
    tags: worstTags,
    segments: worstSegments,
    snippets: worstSnippets,
    sequences: worstSequences,
    flows: worstFlows,
    reports: (days) => reportsFor(worstFlows(), days, days / 30),
    dashboard: worstDashboard,
  },
  empty: {
    contacts: () => [],
    lastMessage: () => null,
    messages: () => [],
    overview: () => ({
      general: { botName: 'Sokutō', paused: false },
      channels: [],
      stats: { contacts: 0, newContacts7d: 0, messagesIn7d: 0, messagesOut7d: 0, flowsLive: 0, events30d: {} },
      notifications: [],
    }),
    broadcasts: () => [],
    tags: () => [],
    segments: () => [],
    snippets: () => [],
    sequences: () => [],
    flows: () => [],
    reports: (days) => ({ days, flows: [], series: [] }),
    dashboard: emptyDashboard,
  },
  one: {
    contacts: () => [oneContact()],
    lastMessage: genericLast,
    messages: (id) => [
      { id: 1, contactId: id, direction: 'in', source: 'user', kind: 'text', text: '営業時間を教えてください', payload: { type: 'message' }, flowId: null, stepId: null, error: null, createdAt: ago(2 * MIN) },
    ],
    overview: () => ({
      general: { botName: 'Sokutō', paused: false },
      channels: ['line'],
      stats: { contacts: 1, newContacts7d: 1, messagesIn7d: 1, messagesOut7d: 1, flowsLive: 1, events30d: {} },
      notifications: [{ id: 1, contactId: 1, text: '佐藤 美咲 が担当者を希望しています', read: 0, createdAt: ago(MIN) }],
    }),
    broadcasts: () => [
      { id: 1, name: 'お知らせ', channel: 'line', tag: 'vip', text: '本日は臨時休業です。', imageUrl: null, status: 'done', total: 1, sent: 1, failed: 1, segmentId: null, buttons: [{ label: '予約する', url: 'https://example.com/reserve' }], messageTag: null, clicked: 1, scheduledAt: ago(HOUR), createdAt: ago(HOUR) },
    ],
    tags: () => [{ tag: 'vip', n: 1 }],
    segments: () => [{ id: 1, name: 'VIP', rules: [{ field: 'tag', op: 'has_tag', value: 'vip' }], mode: 'all', createdAt: ago(DAY) }],
    snippets: () => [{ id: 1, name: '営業時間', text: '営業時間は 11:00〜22:00 です。', createdAt: ago(DAY) }],
    sequences: () => [],
    flows: () => [flowRow(1, { runs30d: 1 })],
    reports: (days) => ({
      days,
      flows: [{ id: 1, name: '営業時間の案内', status: 'live', channel: 'any', started: 1, messagesSent: 1, buttonClicks: 1, inputs: 0, completed: 1, errors: 0 }],
      series: [{ day: new Date().toISOString().slice(0, 10), in: 1, out: 1, newContacts: 1 }],
    }),
    dashboard: oneDashboard,
  },
  huge: {
    contacts: hugeContacts,
    lastMessage: genericLast,
    messages: hugeMessages,
    overview: () => ({
      general: { botName: 'Sokutō', paused: false },
      channels: ['line', 'messenger', 'instagram'],
      stats: { contacts: 25_000, newContacts7d: 1_284, messagesIn7d: 184_233, messagesOut7d: 1_002_417, flowsLive: 48, events30d: {} },
      notifications: Array.from({ length: 10 }, (_, i) => ({ id: 1000 - i, contactId: i + 1, text: `${POOL_NAMES[i % POOL_NAMES.length]} が担当者を希望しています`, read: 0, createdAt: ago(i * HOUR) })),
    }),
    broadcasts: () =>
      Array.from({ length: 100 }, (_, i) => ({
        id: 1000 - i,
        name: `週次のお知らせ #${1000 - i}`,
        channel: CHANNELS[i % 3],
        tag: i % 3 === 0 ? 'newsletter' : null,
        text: '今週のおすすめメニューをご紹介します。',
        imageUrl: null,
        status: i === 0 ? 'scheduled' : 'done',
        total: 25_000,
        sent: 24_870,
        failed: 130,
        segmentId: i % 4 === 1 ? (i % 200) + 1 : null,
        buttons: [],
        messageTag: null,
        clicked: 3_210,
        scheduledAt: ago(i * 7 * DAY),
        createdAt: ago(i * 7 * DAY),
      })),
    tags: () => Array.from({ length: 1000 }, (_, i) => ({ tag: `segment-${String(i + 1).padStart(4, '0')}`, n: 1000 - i })),
    segments: () =>
      Array.from({ length: 200 }, (_, i) => ({
        id: i + 1,
        name: `セグメント ${i + 1}`,
        rules: [{ field: 'tag', op: 'has_tag', value: i % 2 === 0 ? 'newsletter' : `segment-${String(i + 1).padStart(4, '0')}` }],
        mode: 'all',
        createdAt: ago(i * HOUR),
      })),
    snippets: () => Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `定型文 ${i + 1}`, text: `いつもありがとうございます。定型文 ${i + 1} の本文です。`, createdAt: ago(i * HOUR) })),
    sequences: () => [],
    flows: hugeFlows,
    reports: (days) => reportsFor(hugeFlows(), days, (days / 30) * 50),
    dashboard: hugeDashboard,
  },
}

const cache = new Map<DataMode, ContactRow[]>()
function contactsFor(mode: DataMode): ContactRow[] {
  let rows = cache.get(mode)
  if (!rows) {
    rows = DATASETS[mode].contacts()
    cache.set(mode, rows)
  }
  return rows
}

function withoutTags(c: ContactRow): Omit<ContactRow, 'tags'> {
  const { tags: _tags, ...rest } = c
  return rest
}

/**
 * Returns the fixture for a GET request path, or `undefined` to let the request hit the network
 * (no active mode, or an endpoint without a fixture).
 */
export function devFixture(path: string): unknown {
  const mode = activeMode
  if (!mode) return undefined
  const ds = DATASETS[mode]
  const url = new URL(path, window.location.origin)
  const p = url.pathname
  const q = url.searchParams

  if (p === '/api/auth/status') return { setupRequired: false, authenticated: true }

  if (p === '/api/inbox') {
    const filter = q.get('filter') ?? 'all'
    const rows = contactsFor(mode)
      .filter((c) =>
        filter === 'paused' ? c.botPaused === 1 : filter === 'unread' ? c.unread > 0 : filter === 'open' || filter === 'closed' ? c.status === filter : true,
      )
      .slice(0, 100) // api.ts: .limit(100)
    return { conversations: rows.map((c) => ({ contact: withoutTags(c), lastMessage: lastMessageFor(ds, c) })) }
  }

  let m = p.match(/^\/api\/inbox\/(\d+)\/messages$/)
  if (m) return { messages: ds.messages(Number(m[1])) }

  if (p === '/api/contacts') {
    const size = 50 // api.ts: const size = 50
    const page = Math.max(1, Number(q.get('page') ?? '1'))
    const term = q.get('q')?.toLowerCase()
    const tag = q.get('tag')
    const channel = q.get('channel')
    // Visual stand-in for the server's matchRules scan: keeps contacts carrying any of the segment's has_tag values.
    const segment = q.get('segment') ? ds.segments().find((s) => s.id === Number(q.get('segment'))) : undefined
    const segmentTags = segment?.rules.filter((r) => r.op === 'has_tag').map((r) => r.value)
    const rows = contactsFor(mode).filter(
      (c) =>
        (!term || [c.displayName, c.username, JSON.stringify(c.fields)].some((v) => v?.toLowerCase().includes(term))) &&
        (!tag || c.tags.includes(tag)) &&
        (!channel || c.channel === channel) &&
        (!segmentTags || segmentTags.some((t) => t !== undefined && c.tags.includes(t))),
    )
    return { contacts: rows.slice((page - 1) * size, page * size), total: rows.length, page, size }
  }

  m = p.match(/^\/api\/contacts\/(\d+)$/)
  if (m) {
    const id = Number(m[1])
    const found = contactsFor(mode).find((c) => c.id === id) ?? contact(id, { channel: 'line', lastInboundAt: null })
    return { contact: found, session: null, sequences: ds.sequences(id) }
  }

  if (p === '/api/workspaces') return mode === 'huge' ? undefined : workspacesFixture(mode)
  if (p === '/api/overview') return ds.overview()
  if (p === '/api/dashboard') return ds.dashboard(Math.min(90, Math.max(1, Math.trunc(Number(q.get('days'))) || 30))) // api.ts clamp
  if (p === '/api/broadcasts') return { broadcasts: ds.broadcasts() }
  if (p === '/api/tags') return { tags: ds.tags() }
  if (p === '/api/segments') return { segments: ds.segments() }
  if (p === '/api/snippets') return { snippets: ds.snippets() }
  if (p === '/api/flows') return { flows: ds.flows() }
  if (p === '/api/reports') return ds.reports(Math.min(90, Math.max(1, Number(q.get('days') ?? '30'))))
  if (p.startsWith('/api/bot')) return botRoute(mode, p, q)

  return undefined
}

function lastMessageFor(ds: Dataset, c: ContactRow) {
  const lm = ds.lastMessage(c)
  return lm ? { id: c.id * 1000, ...lm } : null
}
