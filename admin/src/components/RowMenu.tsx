import { useRef, useState } from 'react'
import { Button, ListItem, Overlay } from '@channel.io/bezier-react'
import { MoreIcon, type BezierIcon } from '@channel.io/bezier-icons'
import { dropsUp, useDropdownContainer } from './Field'

export type RowMenuItem = { label: string; icon: BezierIcon; onSelect: () => void; danger?: boolean }

/** "…" button with a small menu (role="menu") for a table row; clicks inside never reach the row. */
export function RowMenu({ label, items, disabled }: { label: string; items: RowMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <span className="row-menu" onClick={(e) => e.stopPropagation()}>
      <Button
        ref={buttonRef}
        size="s"
        styleVariant="tertiary"
        colorVariant="monochrome-light"
        leftContent={MoreIcon}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          setUp(dropsUp(e.currentTarget, items.length * 36 + 16))
          setOpen((o) => !o)
        }}
      />
      {/* In the body (not the default fixed layer, which Bezier offsets by the page scroll), so it follows the row. */}
      <Overlay show={open} target={buttonRef.current} container={useDropdownContainer()} position={up ? 'top-right' : 'bottom-right'} marginY={4} onHide={close}>
        {/* The Overlay mounts this after `show`: focus the first item once it exists. */}
        <div ref={(el) => { if (open) el?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }} role="menu" aria-label={label} className="row-menu__list">
          {items.map((item) => (
            <ListItem
              key={item.label}
              role="menuitem"
              size="m"
              variant={item.danger ? 'red' : undefined}
              leftContent={item.icon}
              content={item.label}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            />
          ))}
        </div>
      </Overlay>
    </span>
  )
}
