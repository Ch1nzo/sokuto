/** Shapes of the `/api/bot/*` endpoints (src/routes/api.ts). */
import type { Channel } from '@shared/channels/types'

export type BotConfig = {
  enabled: boolean
  name: string
  channels: Channel[]
  persona: string
  guidelines: string[]
  guardrails: string[]
  handoffMessage: string
  unknownAction: 'handoff' | 'fallback'
  fallbackMessage: string
  autoClose: boolean
  resolveMessage: string
  maxTurns: number
  recommendProducts: boolean
  segmentId: number | null
  suggestFaqs: boolean
  language: 'auto' | 'ja' | 'en'
}

/** `counts.faqs` is approved FAQs; `suggested` the ones waiting for review. */
export type KnowledgeCounts = { faqs: number; suggested: number; documents: number; products: number }

export type BotResponse = { config: BotConfig; aiConfigured: boolean; counts: KnowledgeCounts }

export type HandoffReason = 'customer_request' | 'missing_knowledge' | 'policy' | 'max_turns' | 'ai_error' | 'other'

export type Faq = {
  id: number
  question: string
  answer: string
  status: 'approved' | 'suggested'
  source: 'manual' | 'conversation' | 'document'
  documentId: number | null
  contactId: number | null
  uses: number
  createdAt: string
  updatedAt: string
}

export type BotDocument = {
  id: number
  name: string
  url: string | null
  status: 'ready' | 'failed'
  error: string | null
  chars: number
  fetchedAt: string | null
  createdAt: string
}

export type Product = {
  id: number
  name: string
  description: string
  price: number | null
  currency: string
  url: string | null
  imageUrl: string | null
  tags: string[]
  sku: string | null
  inStock: boolean
  createdAt: string
  updatedAt: string
}

export type ProductInput = Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }

export type BotOverview = {
  days: number
  enabled: boolean
  name: string
  aiConfigured: boolean
  handled: number
  replies: number
  handoffs: number
  resolved: number
  resolutionRate: number
  handoffRate: number
  avgTurns: number
  series: { day: string; replies: number; handoffs: number; resolved: number }[]
  handoffReasons: { reason: HandoffReason; count: number }[]
  topFaqs: { id: number; question: string; uses: number }[]
  topProducts: { id: number; name: string; count: number }[]
  knowledge: KnowledgeCounts
}

export type PlaygroundReply = {
  reply: string
  action: 'answer' | 'handoff' | 'unknown'
  resolved: boolean
  reason: HandoffReason | null
  faqs: { id: number; question: string }[]
  products: { id: number; name: string }[]
  documents: { id: number; name: string }[]
  raw: string
}
