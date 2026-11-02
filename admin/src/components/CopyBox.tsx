import { Button, useToast } from '@channel.io/bezier-react'
import { LinkCopyIcon } from '@channel.io/bezier-icons'
import { useT } from '../lib/i18n'

/** Read-only monospace value (URL, token) with a Copy button; feedback via Bezier Toast. */
export function CopyBox({ value, label }: { value: string; label?: string }) {
  const t = useT()
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.addToast(t('copied'), { preset: 'success' })
    } catch {
      toast.addToast(t('copy_failed'), { preset: 'error' })
    }
  }
  return (
    <div className="copy-box">
      <code className="copy-box__value" aria-label={label}>
        {value}
      </code>
      <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={LinkCopyIcon} text={t('copy')} onClick={copy} />
    </div>
  )
}
