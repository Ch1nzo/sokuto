import type { FlowDefinition } from './types'
import type { Channel } from '../channels/types'

export type FlowTemplate = {
  slug: string
  name: { ja: string; en: string }
  description: { ja: string; en: string }
  channel: Channel | 'any'
  definition: FlowDefinition
}

export const TEMPLATES: FlowTemplate[] = [
  {
    slug: 'welcome',
    name: { ja: '友だち追加・初回メッセージのあいさつ', en: 'Welcome new contacts' },
    description: { ja: 'LINE の友だち追加や初めてのメッセージにあいさつし、興味を 1 タップで聞きます。', en: 'Greets on LINE follow or first message and asks what they are interested in.' },
    channel: 'any',
    definition: {
      triggers: [{ type: 'follow' }, { type: 'first_message' }],
      entry: 'm1',
      steps: [
        { id: 'm1', type: 'message', text: '{{name}}さん、はじめまして!\nご興味のあるものを選んでください。', buttons: [{ label: '商品について', next: 'a1' }, { label: '店舗情報', next: 'm3' }] },
        { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'interested' }], next: 'm2' },
        { id: 'm2', type: 'message', text: 'ありがとうございます! 商品一覧はこちらです。\nhttps://example.com/products', next: null },
        { id: 'm3', type: 'message', text: '営業時間は 10:00〜19:00、定休日は水曜日です。', next: null },
      ],
    },
  },
  {
    slug: 'comment-price',
    name: { ja: 'コメント「価格」→ DM で案内', en: 'Comment "price" → DM' },
    description: { ja: '投稿に「価格」「値段」とコメントした人へ DM で価格を送り、電話番号を聞いてタグ付けします。', en: 'Sends the price by DM to anyone who comments "price", asks for a phone number and tags them.' },
    channel: 'any',
    definition: {
      triggers: [{ type: 'comment', keywords: ['価格', '値段', 'price', 'いくら'] }],
      entry: 'c1',
      steps: [
        { id: 'c1', type: 'comment_reply', text: 'DM で価格をお送りしました ✓', next: 'm1' },
        { id: 'm1', type: 'message', text: 'こんにちは {{first_name}} さん! お問い合わせの商品は 18,900 円です。', buttons: [{ label: '注文したい', next: 'q1' }, { label: '詳しく見る', url: 'https://example.com/item' }] },
        { id: 'q1', type: 'question', text: 'ご連絡先の電話番号を教えてください 📞', field: 'phone', next: 'a1' },
        { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'interested' }, { type: 'notify', text: '{{name}} さんが注文を希望 ({{phone}})' }], next: 'm2' },
        { id: 'm2', type: 'message', text: 'ありがとうございます! 担当者からご連絡します。', next: null },
      ],
    },
  },
  {
    slug: 'faq',
    name: { ja: 'よくある質問(営業時間・場所・支払い)', en: 'FAQ keywords' },
    description: { ja: 'キーワードに応じて定型回答を返します。', en: 'Replies to common keywords with canned answers.' },
    channel: 'any',
    definition: {
      triggers: [{ type: 'keyword', keywords: ['営業時間', '何時', 'hours'] }],
      entry: 'm1',
      steps: [{ id: 'm1', type: 'message', text: '営業時間は 10:00〜19:00 です(水曜定休)。', next: null }],
    },
  },
  {
    slug: 'survey-csat',
    name: { ja: '満足度アンケート (1〜5)', en: 'Satisfaction survey (1-5)' },
    description: { ja: '5 段階評価を聞き、2 以下なら担当者に通知します。', en: 'Asks for a 1-5 rating and notifies you when it is 2 or lower.' },
    channel: 'any',
    definition: {
      triggers: [{ type: 'keyword', keywords: ['アンケート', 'survey'], match: 'exact' }, { type: 'ref', ref: 'survey' }],
      entry: 'q1',
      steps: [
        { id: 'q1', type: 'question', text: '本日の対応はいかがでしたか? 1〜5 で評価してください ⭐', field: 'rating', choices: ['1', '2', '3', '4', '5'], next: 'c1' },
        { id: 'c1', type: 'condition', rules: [{ field: 'rating', op: 'lte', value: '2' }], yes: 'a1', no: 'm2' },
        { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'unhappy' }, { type: 'notify', text: '{{name}} さんの評価が {{rating}} です。フォローしてください。' }], next: 'm1' },
        { id: 'm1', type: 'message', text: 'ご意見ありがとうございます。担当者よりご連絡いたします。', next: null },
        { id: 'm2', type: 'message', text: 'ご評価ありがとうございます 💚', next: null },
      ],
    },
  },
  {
    slug: 'order',
    name: { ja: '注文受付', en: 'Take orders' },
    description: { ja: '「注文」と送った人に商品と配送先を聞き、通知します。', en: 'Asks what they want and where to deliver, then notifies you.' },
    channel: 'any',
    definition: {
      triggers: [{ type: 'keyword', keywords: ['注文', 'order'] }],
      entry: 'q1',
      steps: [
        { id: 'q1', type: 'question', text: 'ご希望の商品と数量を教えてください 🛍️', field: 'product', next: 'q2' },
        { id: 'q2', type: 'question', text: 'お届け先の住所を教えてください 🏠', field: 'address', next: 'a1' },
        { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'order' }, { type: 'notify', text: '新しい注文: {{name}} / {{product}} / {{address}}' }], next: 'm1' },
        { id: 'm1', type: 'message', text: 'ご注文ありがとうございます! 内容を確認してご連絡します。', next: null },
      ],
    },
  },
  {
    slug: 'story-mention',
    name: { ja: 'ストーリーでメンションされたらお礼', en: 'Thank story mentions' },
    description: { ja: 'Instagram ストーリーでメンションした人にクーポンを送ります。', en: 'Thanks people who mention you in an Instagram story and sends a code.' },
    channel: 'instagram',
    definition: {
      triggers: [{ type: 'story_mention' }],
      entry: 'm1',
      steps: [
        { id: 'm1', type: 'message', text: 'メンションありがとうございます {{first_name}} さん! 💚 10% オフクーポン: STORY10', next: 'a1' },
        { id: 'a1', type: 'action', actions: [{ type: 'add_tag', tag: 'story' }], next: null },
      ],
    },
  },
]
