import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { Button, ListItem, Overlay, type ButtonProps } from '@channel.io/bezier-react'
import type { BezierIcon } from '@channel.io/bezier-icons'
import { dropsUp, useDropdownContainer } from './Field'

export type MenuButtonItem = { key: string; label: string; icon?: BezierIcon; onSelect: () => void; danger?: boolean; disabled?: boolean }

type Props = {
  /** Accessible name of the button and the menu. Also the visible text unless `text` is given or `iconOnly`. */
  label: string
  text?: string
  icon?: BezierIcon
  iconOnly?: boolean
  items: MenuButtonItem[]
  disabled?: boolean
  size?: ButtonProps['size']
  styleVariant?: ButtonProps['styleVariant']
  colorVariant?: ButtonProps['colorVariant']
  rightContent?: ButtonProps['rightContent']
  /** Which edge of the button the menu lines up with. */
  align?: 'left' | 'right'
  className?: string
  title?: string
}

/**
 * A button that opens a small menu (role="menu" of ListItems): arrow keys / Home / End move between items,
 * Escape or a click outside closes it and focus returns to the button. Opens upward when there is no room below.
 * Generalises RowMenu (which stays as is for table rows).
 */
export function MenuButton({ label, text, icon, iconOnly, items, disabled, size = 'm', styleVariant = 'secondary', colorVariant = 'monochrome-dark', rightContent, align = 'left', className, title }: Props) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const container = useDropdownContainer()

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  // The Overlay mounts the list after `show`: focus the first enabled item once it exists (stable ref, mount only).
  const listRef = useCallback((el: HTMLDivElement | null) => {
    el?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
    if (!all.length) return
    const i = all.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'ArrowDown' ? all[(i + 1) % all.length] : e.key === 'ArrowUp' ? all[(i - 1 + all.length) % all.length] : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  const visibleText = iconOnly ? undefined : (text ?? label)

  return (
    <span className={['menu-button', className].filter(Boolean).join(' ')}>
      <Button
        ref={buttonRef}
        size={size}
        styleVariant={styleVariant}
        colorVariant={colorVariant}
        leftContent={icon}
        rightContent={iconOnly ? undefined : rightContent}
        text={visibleText}
        aria-label={visibleText === label ? undefined : label}
        title={title ?? (iconOnly ? label : undefined)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          setUp(dropsUp(e.currentTarget, items.length * 36 + 16))
          setOpen((o) => !o)
        }}
      />
      <Overlay show={open} target={buttonRef.current} container={container} position={`${up ? 'top' : 'bottom'}-${align}`} marginY={4} keepInContainer onHide={close}>
        <div ref={listRef} role="menu" aria-label={label} className="menu-button__list menu-pop" style={{ transformOrigin: `${up ? 'bottom' : 'top'} ${align}` }} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <ListItem
              key={item.key}
              role="menuitem"
              size="m"
              variant={item.danger ? 'red' : undefined}
              leftContent={item.icon}
              content={item.label}
              disabled={item.disabled}
              onClick={() => {
                close()
                item.onSelect()
              }}
            />
          ))}
        </div>
      </Overlay>
    </span>
  )
}
