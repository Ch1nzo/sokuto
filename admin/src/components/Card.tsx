import type { ReactNode } from 'react'
import { Text } from '@channel.io/bezier-react'

type Props = {
  /** Section heading (rendered as <h2>). */
  title?: ReactNode
  /** Right side of the heading row (small buttons, hints). */
  actions?: ReactNode
  /** Remove inner padding, e.g. for a full-bleed DataTable or a ListItem list. */
  flush?: boolean
  className?: string
  children?: ReactNode
}

/** Bordered surface used for every content section on a page. Cards stack with a 16px gap (`.stack`). */
export function Card({ title, actions, flush, className, children }: Props) {
  return (
    <section className={['card', flush ? 'card--flush' : '', className ?? ''].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div className="card__header">
          {title && (
            <Text as="h2" typo="16" bold color="txt-black-darkest">
              {title}
            </Text>
          )}
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
