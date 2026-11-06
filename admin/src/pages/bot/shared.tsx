import { createContext, useContext, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Text, Switch } from '@channel.io/bezier-react'
import { BookEditingIcon, BookIcon, GraphIcon, PlayIcon, ShoppingIcon } from '@channel.io/bezier-icons'
import { useT, type Key, type Lang } from '../../lib/i18n'
import { PageHeader, SubNav, formatNumber } from '../../components'
import type { BotResponse, HandoffReason } from './types'

export type Section = 'overview' | 'rules' | 'knowledge' | 'products' | 'playground'

const SECTIONS: { id: Section; href: string; label: Key; icon: typeof GraphIcon }[] = [
  { id: 'overview', href: '/bot', label: 'bot_nav_overview', icon: GraphIcon },
  { id: 'rules', href: '/bot/rules', label: 'bot_nav_rules', icon: BookEditingIcon },
  { id: 'knowledge', href: '/bot/knowledge', label: 'bot_nav_knowledge', icon: BookIcon },
  { id: 'products', href: '/bot/products', label: 'bot_nav_products', icon: ShoppingIcon },
  { id: 'playground', href: '/bot/playground', label: 'bot_nav_playground', icon: PlayIcon },
]

/** GET /api/bot, loaded once by pages/Bot.tsx and shared by every Soku screen (name, AI status, counts). */
export type BotState = {
  bot: BotResponse | null
  error: unknown
  reload: () => Promise<void>
  setBot: (bot: BotResponse) => void
}

export const BotContext = createContext<BotState>({ bot: null, error: null, reload: async () => {}, setBot: () => {} })

export const useBot = () => useContext(BotContext)

/** Name shown in titles before GET /api/bot answers (and the API default). */
export const DEFAULT_BOT_NAME = 'Soku'

/** Page frame of a Soku screen: header band ("Soku · 概要") + left sub-navigation + content. */
export function BotFrame({ section, actions, children }: { section: Section; actions?: ReactNode; children: ReactNode }) {
  const t = useT()
  const navigate = useNavigate()
  const { bot } = useBot()
  const current = SECTIONS.find((s) => s.id === section)!
  return (
    <div className="stack">
      <PageHeader title={`${bot?.config.name || DEFAULT_BOT_NAME} · ${t(current.label)}`} actions={actions} />
      <div className="bot-layout">
        <SubNav
          label={t('bot_sections')}
          items={SECTIONS.map((s) => ({ id: s.id, href: s.href, label: t(s.label), icon: s.icon }))}
          current={section}
          onSelect={(id) => navigate(SECTIONS.find((s) => s.id === id)!.href)}
        />
        <div className="bot-content">{children}</div>
      </div>
    </div>
  )
}

/** Bordered row: label + help on the left, Switch on the right (the label toggles it). */
export function SwitchRow({ id, label, help, checked, onChange }: { id: string; label: string; help?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="bot-switch">
      <label className="bot-switch__text" htmlFor={id}>
        <Text as="span" typo="14" bold color="txt-black-darkest">
          {label}
        </Text>
        {help && (
          <Text as="span" typo="13" color="txt-black-dark">
            {help}
          </Text>
        )}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

const REASONS: HandoffReason[] = ['customer_request', 'missing_knowledge', 'policy', 'max_turns', 'ai_error', 'other']

/** Label of a hand-off reason; unknown values read as "other". */
export function useReasonLabel() {
  const t = useT()
  return (reason: string | null | undefined) => t(`bot_reason_${REASONS.includes(reason as HandoffReason) ? reason : 'other'}` as Key)
}

/** "¥1,280" in the UI language; unknown currency codes fall back to "1,280 XYZ"; null → "—". */
export function formatPrice(lang: Lang, price: number | null, currency: string): string {
  if (price === null) return '—'
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(price)
  } catch {
    return `${formatNumber(lang)(price)} ${currency}`
  }
}

export const CURRENCIES = ['JPY', 'USD', 'EUR', 'KRW'] as const
