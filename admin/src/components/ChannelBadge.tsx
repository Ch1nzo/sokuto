import { Badge, Icon, type BadgeSize, type BadgeVariant } from '@channel.io/bezier-react'
import { ChatBubbleFilledIcon, InstagramIcon, LineIcon, type BezierIcon } from '@channel.io/bezier-icons'
import { useT, type Key } from '../lib/i18n'

const CHANNELS: Record<string, { key: Key; variant: BadgeVariant; icon: BezierIcon }> = {
  line: { key: 'channel_line', variant: 'green', icon: LineIcon },
  messenger: { key: 'channel_messenger', variant: 'blue', icon: ChatBubbleFilledIcon },
  instagram: { key: 'channel_instagram', variant: 'pink', icon: InstagramIcon },
}

/** Localized channel label. Unknown values render as a neutral badge with the raw value. */
export function ChannelBadge({ channel, size = 's' }: { channel: string; size?: BadgeSize }) {
  const t = useT()
  const c = CHANNELS[channel]
  if (!c) return <Badge size={size} variant="default">{channel === 'any' ? t('channel_any') : channel}</Badge>
  return (
    <Badge size={size} variant={c.variant} icon={c.icon}>
      {t(c.key)}
    </Badge>
  )
}

/** For places that need plain text (titles, CSV): the localized channel name. */
export function useChannelLabel() {
  const t = useT()
  return (channel: string) => (CHANNELS[channel] ? t(CHANNELS[channel].key) : channel)
}

/** Round channel mark for the corner of an avatar; labelled for screen readers. Nothing for unknown channels. */
export function ChannelDot({ channel }: { channel: string }) {
  const t = useT()
  const c = CHANNELS[channel]
  if (!c) return null
  return (
    <span className={`channel-dot channel-dot--${channel}`} role="img" aria-label={t(c.key)} title={t(c.key)}>
      <Icon source={c.icon} size="xxs" />
    </span>
  )
}
