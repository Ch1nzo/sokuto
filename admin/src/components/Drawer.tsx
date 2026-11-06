import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button, Modal, ModalBody, ModalClose, ModalContent, ModalHeader } from '@channel.io/bezier-react'
import { CancelIcon } from '@channel.io/bezier-icons'
import { useT } from '../lib/i18n'

type Props = {
  show: boolean
  onHide: () => void
  title: string
  description?: string
  children: ReactNode
  /** Pinned under the scrolling body (submit button, totals). */
  footer?: ReactNode
  /** Desktop width in px (full width on narrow screens). */
  width?: number
  /** ≤ 860px: a bottom sheet instead of a full-width drawer. */
  sheetOnMobile?: boolean
}

/**
 * Right-hand drawer. A Bezier Modal pinned to the right edge rather than a native <dialog>: the top layer
 * would make Bezier dropdowns and toasts (portaled to <body>) inert and hidden behind it. Radix gives the
 * focus trap, Esc and scrim click; the slide is the `.sheet` motion (styles.css `.drawer`).
 */
/**
 * Close (×) for a Bezier ModalContent: `showCloseIcon` renders an icon button without an accessible name.
 * Put it last inside ModalContent (opening focuses the first field, not ×) and give the ModalHeader
 * `className="modal-head"` so a long title never runs under it.
 */
export function ModalCloseButton() {
  const t = useT()
  return (
    <ModalClose>
      <Button className="modal-close" styleVariant="tertiary" colorVariant="monochrome-dark" size="m" leftContent={CancelIcon} aria-label={t('close')} />
    </ModalClose>
  )
}

export function Drawer({ show, onHide, title, description, children, footer, width = 420, sheetOnMobile }: Props) {
  // Radix only returns focus to a Dialog.Trigger; we open from plain buttons, so remember the opener ourselves.
  // Layout effect: runs before Radix moves focus into the drawer (a passive effect).
  const opener = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (show) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      return
    }
    const el = opener.current
    opener.current = null
    if (el) setTimeout(() => el.isConnected && el.focus(), 0)
  }, [show])

  return (
    <Modal show={show} onHide={onHide}>
      <ModalContent
        className={sheetOnMobile ? 'drawer drawer--sheet' : 'drawer'}
        width={`min(${width}px, 100vw)`}
        height="100%"
        collisionPadding={0}
        // Without a description, tell Radix there is none (it warns otherwise).
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <ModalHeader className="modal-head" title={title} description={description} />
        <ModalBody className="drawer__body">{children}</ModalBody>
        {footer && <div className="drawer__footer">{footer}</div>}
        <ModalCloseButton />
      </ModalContent>
    </Modal>
  )
}
