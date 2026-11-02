import { Text } from '@channel.io/bezier-react'
import { useChannelLabel } from './ChannelBadge'
import { middleTruncate } from './format'

export type ContactNameSource = {
  id?: number
  channel?: string
  displayName: string | null
  username?: string | null
  channelUserId?: string | null
}

type Props = {
  contact: ContactNameSource
  /** Text size; default '14'. */
  typo?: '12' | '13' | '14' | '15' | '16' | '18' | '22'
  bold?: boolean
}

/** Plain-text name for titles / aria labels, same fallback order as <ContactName>. */
export function contactDisplayName(c: ContactNameSource, channelLabel?: string): string {
  if (c.displayName) return c.displayName
  if (c.username) return `@${c.username}`
  if (c.channelUserId) return `${channelLabel ?? c.channel ?? ''} ${c.channelUserId}`.trim()
  return c.id !== undefined ? `#${c.id}` : ''
}

/**
 * displayName → `@username` → "<channel> U4af49…e4f6a8" (mono, middle-truncated, full id in title) → `#id`.
 * Single line, ellipsis on overflow: give the parent a width (min-width: 0 in flex rows).
 */
export function ContactName({ contact: c, typo = '14', bold }: Props) {
  const channelLabel = useChannelLabel()
  if (c.displayName || c.username) {
    const name = c.displayName || `@${c.username}`
    return (
      <Text typo={typo} bold={bold} truncated title={name} className="contact-name">
        {name}
      </Text>
    )
  }
  if (c.channelUserId) {
    return (
      <Text typo={typo} bold={bold} truncated title={c.channelUserId} className="contact-name">
        <span className="contact-name__channel">{c.channel ? channelLabel(c.channel) : ''}</span>{' '}
        <span className="mono">{middleTruncate(c.channelUserId)}</span>
      </Text>
    )
  }
  return (
    <Text typo={typo} bold={bold} color="txt-black-dark" className="contact-name">
      {c.id !== undefined ? `#${c.id}` : '—'}
    </Text>
  )
}
