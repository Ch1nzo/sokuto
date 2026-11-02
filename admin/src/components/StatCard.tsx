import type { ReactNode } from 'react'
import { Text } from '@channel.io/bezier-react'
import { useLang } from '../lib/i18n'
import { formatNumber } from './format'

type Props = {
  label: ReactNode
  value: number
  /** Optional line under the number. */
  hint?: ReactNode
}

/** KPI tile. Put several in `.stat-grid`. Numbers use the UI locale and tabular figures. */
export function StatCard({ label, value, hint }: Props) {
  const { lang } = useLang()
  return (
    <div className="stat-card">
      <Text typo="13" color="txt-black-darker" truncated={2}>
        {label}
      </Text>
      <Text typo="30" bold color="txt-black-darkest" className="stat-card__value">
        {formatNumber(lang)(value)}
      </Text>
      {hint && (
        <Text typo="12" color="txt-black-dark">
          {hint}
        </Text>
      )}
    </div>
  )
}
