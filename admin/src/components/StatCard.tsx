import type { ReactNode } from 'react'
import { Text } from '@channel.io/bezier-react'
import { useLang } from '../lib/i18n'
import { formatNumber } from './format'

type Props = {
  label: ReactNode
  /** A number (formatted for the UI locale) or ready-made text such as "99+" / "—". */
  value: number | string
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
      <Text typo="24" bold color="txt-black-darkest" className="stat-card__value">
        {typeof value === 'number' ? formatNumber(lang)(value) : value}
      </Text>
      {hint && (
        <Text typo="12" color="txt-black-dark">
          {hint}
        </Text>
      )}
    </div>
  )
}
