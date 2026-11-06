import { useLayoutEffect, useRef, type MouseEvent } from 'react'
import { NavItem } from '@channel.io/bezier-react'
import type { BezierIcon } from '@channel.io/bezier-icons'

export type SubNavItem<T extends string> = { id: T; href: string; label: string; icon: BezierIcon }

/**
 * Left sub-navigation of a page with sections (Settings, Soku): 200px column of NavItems, sticky under the
 * header; at ≤ 860px a row of pill chips that scrolls inside itself (`.subnav` in styles.css).
 * Plain left clicks call `onSelect` (default prevented); modified clicks keep the native link behaviour.
 */
export function SubNav<T extends string>({ items, current, onSelect, label }: { items: SubNavItem<T>[]; current: T; onSelect: (id: T, e: MouseEvent) => void; label: string }) {
  const ref = useRef<HTMLElement>(null)
  // Phone chip row: center the current chip when the row scrolls (no-op on the desktop column).
  useLayoutEffect(() => {
    const nav = ref.current
    const a = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav && a && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += a.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - a.offsetWidth) / 2
  }, [current])
  return (
    <nav className="subnav" aria-label={label} ref={ref}>
      <ul role="menu">
        {items.map((s) => (
          <NavItem
            key={s.id}
            name={s.id}
            href={s.href}
            content={s.label}
            leftContent={s.icon}
            active={s.id === current}
            aria-current={s.id === current ? 'page' : undefined}
            onClick={(e) => {
              if (!e || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              onSelect(s.id, e)
            }}
          />
        ))}
      </ul>
    </nav>
  )
}
