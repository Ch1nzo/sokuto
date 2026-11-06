import { describe, it, expect } from 'vitest'
import {
  buildBotPrompt,
  chunk,
  documentFaqPrompt,
  faqSuggestPrompt,
  htmlToText,
  MAX_CSV_ROWS,
  parseBotReply,
  parseFaqSuggestions,
  parseProductsCsv,
  productCards,
  productText,
  retrieve,
  terms,
  type Knowledge,
  type Product,
} from '../src/bot'
import { botConfigSchema, DEFAULT_BOT, DEFAULT_GENERAL, type BotConfig } from '../src/settings'
import { renderLineMessages } from '../src/channels/line'
import { renderMetaMessages } from '../src/channels/meta'

const product = (id: number, over: Partial<Product> = {}): Product => ({
  id,
  workspaceId: 1,
  name: `Product ${id}`,
  description: '',
  price: null,
  currency: 'JPY',
  url: `https://shop.example/p/${id}`,
  imageUrl: null,
  tags: [],
  sku: null,
  inStock: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

const cfg = (over: Partial<BotConfig> = {}): BotConfig => ({ ...DEFAULT_BOT, enabled: true, ...over })

describe('terms', () => {
  it('keeps latin words of 2+ characters, lower-cased', () => {
    expect([...terms('Do you ship to Osaka? I want it')]).toEqual(['do', 'you', 'ship', 'to', 'osaka', 'want', 'it'])
  })

  it('makes 2-grams of Japanese runs (kana prolonged sound mark included)', () => {
    const t = terms('営業時間とコーヒー')
    for (const g of ['営業', '業時', '時間', '間と', 'とコ', 'コー', 'ーヒ', 'ヒー']) expect(t.has(g)).toBe(true)
    expect(t.has('コ')).toBe(false)
  })

  it('normalizes with NFKC (full-width latin, half-width kana)', () => {
    const t = terms('ＷｉＦｉ ｺｰﾋｰ')
    expect(t.has('wifi')).toBe(true)
    expect(t.has('コー')).toBe(true)
  })

  it('keeps a lone kanji', () => {
    expect([...terms('水?')]).toEqual(['水'])
  })
})

describe('chunk', () => {
  it('cuts between paragraphs and splits long ones', () => {
    expect(chunk('aaa\nbbb\nccc', 7)).toEqual(['aaa\nbbb', 'ccc'])
    expect(chunk('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
    expect(chunk('\n\n', 10)).toEqual([])
  })
})

describe('retrieve', () => {
  const big = (id: number, question: string) => ({ id, question, answer: 'x'.repeat(1500) })

  it('keeps every approved FAQ while they are small', () => {
    const faqs = [
      { id: 1, question: '営業時間は?', answer: '10 時から 19 時です' },
      { id: 2, question: '駐車場はありますか', answer: 'ありません' },
    ]
    expect(retrieve('送料はいくら', { faqs, documents: [], products: [] }).faqs).toEqual(faqs)
  })

  it('ranks large FAQ sets by matching terms and drops zero scores', () => {
    const faqs = [big(1, '駐車場はありますか'), big(2, '営業時間を教えて'), big(3, '営業日と営業時間'), big(4, 'Wi-Fi はありますか'), big(5, 'Pet friendly?')]
    const out = retrieve('営業時間は何時から?', { faqs, documents: [], products: [] }, { faqs: 6, chunks: 4, products: 5 })
    expect(out.faqs.map((f) => f.id)).toEqual([2, 3])
  })

  it('returns document chunks with their document', () => {
    const content = `${'当店の歴史について。'.repeat(150)}\n返品は到着後 7 日以内に受け付けます。`
    const out = retrieve('返品できますか', { faqs: [], documents: [{ id: 9, name: 'ご利用ガイド', content }], products: [] })
    expect(out.chunks).toHaveLength(1)
    expect(out.chunks[0]).toMatchObject({ documentId: 9, name: 'ご利用ガイド' })
    expect(out.chunks[0]!.text).toContain('返品は到着後')
  })

  it('matches products by name, description and tags, best first, within the limit', () => {
    const products = [product(1, { name: 'エチオピア', tags: ['コーヒー豆'] }), product(2, { name: 'コーヒー豆 ブラジル', description: '深煎りのコーヒー豆' }), product(3, { name: 'マグカップ' })]
    const out = retrieve('おすすめのコーヒー豆', { faqs: [], documents: [], products }, { faqs: 6, chunks: 4, products: 1 })
    expect(out.products.map((p) => p.id)).toEqual([2])
  })
})

describe('buildBotPrompt', () => {
  const knowledge: Knowledge = {
    faqs: [{ id: 1, question: '営業時間は?', answer: '10 時〜19 時' }],
    chunks: [{ documentId: 4, name: 'ガイド', text: '返品は 7 日以内' }],
    products: [product(2, { name: 'ブレンド', price: 1200, description: '定番', tags: ['coffee', 'beans'] })],
  }
  const config = cfg({ name: 'Soku', persona: '表参道のカフェ「ハル」の案内係', guidelines: ['2 文以内で答える'], guardrails: ['返金の約束をしない'] })

  it('writes the persona, guidelines, guardrails, knowledge and output format', () => {
    const req = buildBotPrompt({ cfg: config, general: DEFAULT_GENERAL, contact: { displayName: '山田' }, knowledge, history: [{ direction: 'in', text: 'こんにちは' }], channel: 'line' })
    expect(req.system).toContain('You are Soku, the support assistant of this business, chatting on LINE')
    expect(req.system).toContain('## Persona\n表参道のカフェ「ハル」の案内係')
    expect(req.system).toContain('## Response guidelines\n- 2 文以内で答える')
    expect(req.system).toContain('## Rules\n- 返金の約束をしない')
    expect(req.system).toContain('use action "unknown"')
    expect(req.system).toContain('[F1] Q: 営業時間は? A: 10 時〜19 時')
    expect(req.system).toContain('[D4 ガイド] 返品は 7 日以内')
    expect(req.system).toMatch(/\[P2\] ブレンド — .1,200 — 定番 — coffee, beans/)
    expect(req.system).toContain('Name: "山田"')
    expect(req.system).toContain('"action": "answer"|"handoff"|"unknown"')
    expect(req.system).toContain("Reply in the customer's language.")
    expect(req.maxTokens).toBe(600)
  })

  it('never includes bot variables', () => {
    const req = buildBotPrompt({ cfg: config, general: { ...DEFAULT_GENERAL, botFields: { secret: 'S3CRET' } }, knowledge, history: [{ direction: 'in', text: 'hi' }], channel: 'line' })
    expect(req.system).not.toContain('S3CRET')
  })

  it('turns history into user / assistant turns, keeps the last 12 with text and opens with the customer', () => {
    const history = [
      { direction: 'out', text: 'Welcome!' },
      ...Array.from({ length: 14 }, (_, i) => ({ direction: i % 2 ? 'out' : 'in', text: `m${i}` })),
      { direction: 'in', text: null },
      { direction: 'in', text: 'last question' },
    ]
    const req = buildBotPrompt({ cfg: config, general: DEFAULT_GENERAL, knowledge, history, channel: 'instagram' })
    expect(req.messages[0]!.role).toBe('user')
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'last question' })
    expect(req.messages.length).toBeLessThanOrEqual(12)
    expect(req.messages.find((m) => m.content === 'm5')?.role).toBe('assistant')
    expect(req.system).toContain('chatting on Instagram')
  })

  it('follows a fixed language', () => {
    const req = buildBotPrompt({ cfg: cfg({ language: 'en' }), general: DEFAULT_GENERAL, knowledge, history: [{ direction: 'in', text: 'やあ' }], channel: 'line' })
    expect(req.system).toContain('Always reply in English.')
  })

  it('writes a plain-text draft from the transcript in draft mode', () => {
    const req = buildBotPrompt({ cfg: config, general: DEFAULT_GENERAL, knowledge, history: [{ direction: 'in', text: '駐車場は?' }, { direction: 'out', text: '確認します' }], channel: 'line', draft: true })
    expect(req.system).toContain('reply drafts')
    expect(req.system).toContain('no JSON')
    expect(req.messages).toEqual([{ role: 'user', content: 'Conversation so far:\nCustomer: 駐車場は?\nBusiness: 確認します\n\nWrite the next reply from the business.' }])
  })
})

describe('parseBotReply', () => {
  it('reads plain and fenced JSON', () => {
    expect(parseBotReply('{"reply":"10 時からです","action":"answer","resolved":false,"faqIds":[1],"productIds":[],"reason":"other"}')).toEqual({
      reply: '10 時からです',
      action: 'answer',
      resolved: false,
      faqIds: [1],
      productIds: [],
      reason: 'other',
    })
    expect(parseBotReply('```json\n{"reply":"Bye!","action":"answer","resolved":true}\n```')).toMatchObject({ reply: 'Bye!', action: 'answer', resolved: true })
  })

  it('reads hand-overs and their reason', () => {
    expect(parseBotReply('{"reply":"","action":"handoff","reason":"customer_request"}')).toMatchObject({ action: 'handoff', reason: 'customer_request' })
    expect(parseBotReply('{"reply":"","action":"handoff","reason":"angry"}')).toMatchObject({ action: 'handoff', reason: 'other' })
  })

  it('sends plain text as an answer', () => {
    expect(parseBotReply('  営業は 10 時からです  ')).toEqual({ reply: '営業は 10 時からです', action: 'answer', resolved: false, faqIds: [], productIds: [], reason: 'other' })
  })

  it('treats an empty answer and cut-off JSON as unknown', () => {
    expect(parseBotReply('{"reply":"  ","action":"answer"}')).toMatchObject({ action: 'unknown', reason: 'missing_knowledge' })
    expect(parseBotReply('')).toMatchObject({ reply: '', action: 'unknown' })
    expect(parseBotReply('{"reply": "営業時間は 10 時から')).toMatchObject({ reply: '', action: 'unknown' })
  })

  it('keeps only positive integer ids, once', () => {
    expect(parseBotReply('{"reply":"ok","faqIds":[1,"2",1.5,-3,1,4],"productIds":"7"}')).toMatchObject({ faqIds: [1, 4], productIds: [] })
  })
})

describe('productCards', () => {
  const list = [
    product(1, { name: 'あ'.repeat(50), price: 1200, description: '浅煎りの豆。'.repeat(20), imageUrl: 'https://img.example/1.jpg' }),
    product(2, { url: null }),
    product(3, { name: 'Mug', imageUrl: 'https://img.example/3.jpg' }),
  ]

  it('makes cards only for products with a URL, truncated, with a link button', () => {
    const cards = productCards(list)
    expect(cards).toHaveLength(2)
    expect(cards[0]!.title).toHaveLength(40)
    expect(cards[0]!.subtitle).toHaveLength(60)
    expect(cards[0]!.subtitle).toMatch(/^.1,200 浅煎りの豆。/)
    expect(cards[0]!.imageUrl).toBe('https://img.example/1.jpg')
    expect(cards[0]!.buttons).toEqual([{ label: '詳しく見る', url: 'https://shop.example/p/1' }])
    expect(cards[1]!.subtitle).toBeUndefined()
    expect(productCards(list, 'en')[0]!.buttons[0]!.label).toBe('View')
  })

  it('drops all images unless every card has an https one (LINE needs the same layout)', () => {
    expect(productCards([list[0]!, product(4)]).every((c) => c.imageUrl === undefined)).toBe(true)
    expect(productCards([product(5, { imageUrl: 'http://img.example/5.jpg' })])[0]!.imageUrl).toBeUndefined()
  })

  it('sends at most 10 cards', () => {
    expect(productCards(Array.from({ length: 12 }, (_, i) => product(i + 1)))).toHaveLength(10)
  })

  it('renders as a LINE carousel and a Meta generic template after the text', () => {
    const msg = { text: 'おすすめです', cards: productCards(list) }
    const line = renderLineMessages(msg)
    expect(line.map((m) => m.type)).toEqual(['text', 'template'])
    expect((line[1]!.template as { type: string }).type).toBe('carousel')
    const meta = renderMetaMessages(msg, 'messenger')
    expect(meta[0]).toEqual({ text: 'おすすめです' })
    expect(meta[1]).toMatchObject({ attachment: { type: 'template', payload: { template_type: 'generic' } } })
  })

  it('lists products as text', () => {
    expect(productText([product(2, { name: 'Gift box', price: 3000 }), product(6, { name: 'Sticker' })])).toMatch(/^・Gift box .3,000\n・Sticker$/)
  })
})

describe('htmlToText', () => {
  it('drops scripts, styles, navigation, header, footer and comments, keeps the title', () => {
    const html = `<!doctype html><html><head><title>Access &amp; Hours</title><style>p{color:red}</style></head>
      <body><header>Logo</header><nav><a href="/">Home</a></nav><!-- hidden -->
      <main><h1>営業時間</h1><p>平日 10:00&ndash;19:00<br>土日&nbsp;11:00 &lt;祝日は休み&gt;</p>
      <p>&quot;Wi-Fi&quot; &#39;free&#39; &#x2615; &#9749;</p><script>alert(1)</script><noscript>enable js</noscript></main>
      <footer>© shop</footer></body></html>`
    const out = htmlToText(html)
    expect(out.title).toBe('Access & Hours')
    expect(out.text).toBe('営業時間\n平日 10:00&ndash;19:00\n土日 11:00 <祝日は休み>\n"Wi-Fi" \'free\' ☕ ☕')
  })
})

describe('parseProductsCsv', () => {
  it('reads quoted commas, line breaks and quotes, tags and inStock', () => {
    const csv = '\uFEFFname,description,price,currency,url,imageUrl,tags,sku,inStock\r\n"Blend, house","Smooth\n""daily"" coffee","1,200",jpy,https://shop.example/b,,coffee|beans;gift,B-1,false\r\nMug,,,,,,,,\r\n'
    const { rows, errors, columns } = parseProductsCsv(csv)
    expect(errors).toEqual([])
    expect(columns).toEqual(['name', 'description', 'price', 'currency', 'url', 'imageUrl', 'tags', 'sku', 'inStock'])
    expect(rows[0]).toEqual({ name: 'Blend, house', description: 'Smooth\n"daily" coffee', price: 1200, currency: 'jpy', url: 'https://shop.example/b', imageUrl: null, tags: ['coffee', 'beans', 'gift'], sku: 'B-1', inStock: false })
    expect(rows[1]).toMatchObject({ name: 'Mug', price: null, currency: 'JPY', tags: [], sku: null, inStock: true })
  })

  it('reports invalid rows with their line and keeps the rest', () => {
    const { rows, errors, columns } = parseProductsCsv('name,Price,url,inStock,note\nOK,100,,\n,100,,\nBad price,abc,,\nBad url,1,ftp://x,\nBad stock,1,,maybe\n')
    expect(columns).toEqual(['name', 'price', 'url', 'inStock'])
    expect(rows.map((r) => r.name)).toEqual(['OK'])
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6])
    expect(errors[0]!.error).toContain('name')
    expect(errors[3]!.error).toContain('inStock')
  })

  it('needs a name column', () => {
    expect(parseProductsCsv('title,price\nA,1')).toEqual({ rows: [], errors: [{ line: 1, error: 'the header row needs a name column' }], columns: ['price'] })
    expect(parseProductsCsv('').errors).toHaveLength(1)
  })

  it(`imports at most ${MAX_CSV_ROWS} rows`, () => {
    const csv = ['name', ...Array.from({ length: MAX_CSV_ROWS + 3 }, (_, i) => `P${i + 1}`)].join('\n')
    const { rows, errors } = parseProductsCsv(csv)
    expect(rows).toHaveLength(MAX_CSV_ROWS)
    expect(errors).toEqual([{ line: MAX_CSV_ROWS + 2, error: expect.stringContaining('at most 500 rows') }])
  })
})

describe('FAQ suggestions', () => {
  it('parses a fenced JSON array, skips incomplete items and caps the count', () => {
    const raw = 'Here you go:\n```json\n[{"question":"駐車場は?","answer":"ありません"},{"question":"","answer":"x"},{"question":"Q2","answer":"A2"},{"question":"Q3","answer":"A3"},{"question":"Q4","answer":"A4"}]\n```'
    expect(parseFaqSuggestions(raw)).toEqual([
      { question: '駐車場は?', answer: 'ありません' },
      { question: 'Q2', answer: 'A2' },
      { question: 'Q3', answer: 'A3' },
    ])
    expect(parseFaqSuggestions(raw, 10)).toHaveLength(4)
  })

  it('returns nothing for non-arrays', () => {
    expect(parseFaqSuggestions('none')).toEqual([])
    expect(parseFaqSuggestions('[not json]')).toEqual([])
    expect(parseFaqSuggestions('[]')).toEqual([])
  })

  it('asks for at most 3 (conversation) or 10 (document) pairs', () => {
    expect(faqSuggestPrompt('Customer: hi').system).toContain('up to 3')
    expect(documentFaqPrompt('text').system).toContain('up to 10')
  })
})

describe('botConfigSchema', () => {
  it('has defaults that validate', () => {
    expect(botConfigSchema.parse(DEFAULT_BOT)).toEqual(DEFAULT_BOT)
    expect(DEFAULT_BOT).toMatchObject({ enabled: false, name: 'Soku', unknownAction: 'handoff', maxTurns: 10, autoClose: true, recommendProducts: true, segmentId: null, language: 'auto' })
  })

  it('enforces limits and enums', () => {
    const bad = (over: object) => botConfigSchema.safeParse({ ...DEFAULT_BOT, ...over }).success
    expect(bad({ name: 'x'.repeat(31) })).toBe(false)
    expect(bad({ name: '  ' })).toBe(false)
    expect(bad({ maxTurns: 0 })).toBe(false)
    expect(bad({ maxTurns: 51 })).toBe(false)
    expect(bad({ unknownAction: 'ignore' })).toBe(false)
    expect(bad({ language: 'fr' })).toBe(false)
    expect(bad({ channels: ['sms'] })).toBe(false)
    expect(bad({ guidelines: Array.from({ length: 21 }, () => 'x') })).toBe(false)
    expect(bad({ guardrails: ['x'.repeat(201)] })).toBe(false)
    expect(bad({ persona: 'x'.repeat(2001) })).toBe(false)
  })

  it('drops blank rule lines', () => {
    expect(botConfigSchema.parse({ ...DEFAULT_BOT, guidelines: ['短く', '  ', ''] }).guidelines).toEqual(['短く'])
  })

  it('validates a partial update without filling in defaults', () => {
    expect(botConfigSchema.partial().parse({ enabled: true })).toEqual({ enabled: true })
  })
})
