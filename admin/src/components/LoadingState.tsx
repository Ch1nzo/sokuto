import { Spinner, VisuallyHidden } from '@channel.io/bezier-react'
import { useT } from '../lib/i18n'

/** Centered spinner for a page or card that is waiting for its first response. */
export function LoadingState({ compact }: { compact?: boolean }) {
  const t = useT()
  return (
    <div className={compact ? 'loading-state loading-state--compact' : 'loading-state'} role="status" aria-live="polite">
      <Spinner size="m" color="txt-black-dark" />
      <VisuallyHidden><span>{t('loading')}</span></VisuallyHidden>
    </div>
  )
}
