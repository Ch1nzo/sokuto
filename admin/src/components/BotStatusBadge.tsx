import { Badge, type BadgeSize } from '@channel.io/bezier-react'
import { useT } from '../lib/i18n'

/** `on` = the bot answers automatically; `off` = paused / a human is handling the conversation. */
export function BotStatusBadge({ on, size = 's' }: { on: boolean; size?: BadgeSize }) {
  const t = useT()
  return (
    <Badge size={size} variant={on ? 'green' : 'orange'}>
      {on ? t('bot_status_on') : t('bot_status_off')}
    </Badge>
  )
}
