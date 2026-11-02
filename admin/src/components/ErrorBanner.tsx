import { Banner } from '@channel.io/bezier-react'
import { ErrorTriangleFilledIcon } from '@channel.io/bezier-icons'
import { errorMessage } from '../lib/api'
import { useT } from '../lib/i18n'

type Props = {
  /** An Error / ApiError / string. Non-strings go through `errorMessage()`. */
  error: unknown
  /** When given, appends an inline "Retry" link-button. */
  onRetry?: () => void
}

/** Red Banner for API / validation errors. Keeps line breaks and wraps long tokens (`.error-banner`). */
export function ErrorBanner({ error, onRetry }: Props) {
  const t = useT()
  const text = typeof error === 'string' ? error : errorMessage(error)
  return (
    <Banner
      className="error-banner"
      variant="red"
      icon={ErrorTriangleFilledIcon}
      content={text}
      role="alert"
      hasLink={!!onRetry}
      linkText={t('retry')}
      renderLink={({ content }) => (
        <button type="button" className="banner-link" onClick={onRetry}>
          {content}
        </button>
      )}
    />
  )
}
