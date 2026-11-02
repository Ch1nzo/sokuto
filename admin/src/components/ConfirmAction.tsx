import {
  Button,
  ButtonGroup,
  ConfirmModal,
  ConfirmModalClose,
  ConfirmModalContent,
  ConfirmModalFooter,
  ConfirmModalHeader,
} from '@channel.io/bezier-react'
import { useT } from '../lib/i18n'

type Props = {
  show: boolean
  onHide: () => void
  /** Called when the confirm button is pressed; the modal closes first. */
  onConfirm: () => void
  title: string
  description?: string
  confirmText: string
  /** Red confirm button (default) for destructive actions; blue otherwise. */
  destructive?: boolean
}

/** Controlled Bezier ConfirmModal with Cancel / Confirm buttons (replacement for window.confirm). */
export function ConfirmAction({ show, onHide, onConfirm, title, description, confirmText, destructive = true }: Props) {
  const t = useT()
  return (
    <ConfirmModal show={show} onHide={onHide}>
      <ConfirmModalContent width="min(420px, 100vw)">
        <ConfirmModalHeader title={title} description={description} />
        <ConfirmModalFooter
          rightContent={
            <ButtonGroup>
              <ConfirmModalClose>
                <Button styleVariant="secondary" colorVariant="monochrome-light" text={t('cancel')} />
              </ConfirmModalClose>
              <ConfirmModalClose>
                <Button colorVariant={destructive ? 'red' : 'blue'} text={confirmText} onClick={onConfirm} />
              </ConfirmModalClose>
            </ButtonGroup>
          }
        />
      </ConfirmModalContent>
    </ConfirmModal>
  )
}
