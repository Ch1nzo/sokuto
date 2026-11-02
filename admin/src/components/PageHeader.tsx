import type { ReactNode } from 'react'
import { Text } from '@channel.io/bezier-react'

type Props = {
  title: ReactNode
  /** Small line under the title (badges, counts, description). */
  description?: ReactNode
  /** Right-aligned buttons; wraps under the title on narrow screens. */
  actions?: ReactNode
}

/** First element of every page. Renders the page's single <h1>. */
export function PageHeader({ title, description, actions }: Props) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <Text as="h1" typo="22" bold color="txt-black-darkest" className="page-header__title">
          {title}
        </Text>
        {description && <div className="page-header__description">{description}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
