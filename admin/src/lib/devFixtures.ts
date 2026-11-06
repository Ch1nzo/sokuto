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

/* ---------- empty / one / huge ---------- */

function oneContact(): ContactRow {
  return contact(1, { channel: 'line', displayName: '佐藤 美咲', unread: 1, tags: ['vip'], fields: { phone: '090-1234-5678' }, lastInboundAt: ago(MIN * 2) })
}

function hugeContacts(): ContactRow[] {
  return Array.from({ length: 25_000 }, (_, i) => poolContact(i + 1))
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

  if (p === '/api/overview') return ds.overview()
  if (p === '/api/broadcasts') return { broadcasts: ds.broadcasts() }
  if (p === '/api/tags') return { tags: ds.tags() }
  if (p === '/api/segments') return { segments: ds.segments() }
  if (p === '/api/snippets') return { snippets: ds.snippets() }

  return undefined
}

function lastMessageFor(ds: Dataset, c: ContactRow) {
  const lm = ds.lastMessage(c)
  return lm ? { id: c.id * 1000, ...lm } : null
}
