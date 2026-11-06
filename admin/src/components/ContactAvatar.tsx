import { Avatar, Icon } from '@channel.io/bezier-react'
import { PersonIcon } from '@channel.io/bezier-icons'
import { ChannelDot } from './ChannelBadge'

type Source = { id: number; channel?: string; displayName: string | null; username?: string | null; avatarUrl?: string | null }

const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

function firstGrapheme(s: string): string {
  if (graphemes) return graphemes.segment(s)[Symbol.iterator]().next().value?.segment ?? ''
  return Array.from(s)[0] ?? ''
}

/** "Maria Garcia" → "MG", "佐藤 美咲" → "佐", "👩🏽‍💻🌸" → "👩🏽‍💻" (whole grapheme cluster), "@aleks" → "A". */
export function initials(name: string): string {
  const words = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const a = firstGrapheme(words[0])
  const b = words.length > 1 ? firstGrapheme(words[1]) : ''
  const latin = /^[A-Za-z]$/
  return (latin.test(a) && latin.test(b) ? a + b : a).toUpperCase()
}

/**
 * Contact picture: the profile image, else initials on a tint chosen by id (Bezier Avatar only renders images).
 * With a known `channel`, a small channel mark sits on the bottom-right corner (Channel.io's messenger badge).
 */
export function ContactAvatar({ contact, size = 36 }: { contact: Source; size?: 24 | 36 }) {
  const name = contact.displayName || contact.username || ''
  const text = initials(name)
  return (
    <span className={`c-avatar c-avatar--${size}`}>
      {contact.avatarUrl ? (
        <Avatar avatarUrl={contact.avatarUrl} name={name || String(contact.id)} size={String(size) as '24' | '36'} aria-hidden="true" />
      ) : (
        <span className={`c-avatar__face c-avatar__face--${contact.id % 6}`} aria-hidden="true">
          {text ? <span className="c-avatar__text">{text}</span> : <Icon source={PersonIcon} size={size === 24 ? 'xs' : 's'} />}
        </span>
      )}
      {contact.channel && size === 36 && <ChannelDot channel={contact.channel} />}
    </span>
  )
}
