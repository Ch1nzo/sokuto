import { Button, useToast } from '@channel.io/bezier-react'
import { LinkCopyIcon } from '@channel.io/bezier-icons'
import { useT } from '../lib/i18n'

/** `copy(text)` writes to the clipboard and confirms with a toast ("コピーしました" / an error). */
export function useCopy() {
  const t = useT()
  const toast = useToast()
  return async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.addToast(t('copied'), { preset: 'success' })
    } catch {
      toast.addToast(t('copy_failed'), { preset: 'error' })
    }
  }
}

/** Read-only monospace value (URL, token) with a Copy button; feedback via Bezier Toast. */
export function CopyBox({ value, label }: { value: string; label?: string }) {
  const t = useT()
  const copy = useCopy()
  return (
    <div className="copy-box">
      <code className="copy-box__value" aria-label={label}>
        {value}
      </code>
      <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={LinkCopyIcon} text={t('copy')} onClick={() => void copy(value)} />
    </div>
  )
}
