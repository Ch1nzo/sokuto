import type { ReactNode } from 'react'
import { Icon, Text } from '@channel.io/bezier-react'
import type { BezierIcon } from '@channel.io/bezier-icons'

type Props = {
  icon: BezierIcon
  title: ReactNode
  description?: ReactNode
  /** Usually a single primary <Button>. */
  action?: ReactNode
  /** Smaller padding, for use inside a Card. */
  compact?: boolean
}

export function EmptyState({ icon, title, description, action, compact }: Props) {
  return (
    <div className={compact ? 'empty-state empty-state--compact' : 'empty-state'}>
      <div className="empty-state__icon">
        <Icon source={icon} size="l" color="txt-black-dark" />
      </div>
      <Text typo="15" bold color="txt-black-darker" align="center">
        {title}
      </Text>
      {description && (
        <Text typo="13" color="txt-black-dark" align="center">
          {description}
        </Text>
      )}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  )
}
