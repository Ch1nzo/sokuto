import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useT, type Key } from '../lib/i18n'

type FlowReport = {
  id: string | number
  name: string
  status: string
  channel: string
  started: number
  messagesSent: number
  buttonClicks: number
  inputs: number
  completed: number
  errors: number
}

type DayPoint = { day: string; in: number; out: number; newContacts: number }

type ReportsResponse = { days: number; flows: FlowReport[]; series: DayPoint[] }

type Metric = 'started' | 'messagesSent' | 'buttonClicks' | 'inputs' | 'completed' | 'errors'

const METRICS: [Metric, Key][] = [
  ['started', 'reports_started'],
  ['messagesSent', 'reports_messages'],
  ['buttonClicks', 'reports_clicks'],
  ['inputs', 'reports_inputs'],
  ['completed', 'reports_completed'],
  ['errors', 'reports_errors'],
]

/** Fill missing days so the chart has one bar per calendar day. */
function fillDays(series: DayPoint[], days: number): DayPoint[] {
  const map = new Map(series.map((p) => [p.day, p]))
  const out: DayPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push(map.get(key) ?? { day: key, in: 0, out: 0, newContacts: 0 })
  }
  return out
}

export default function Reports() {
  const t = useT()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ReportsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<ReportsResponse>(`/api/reports?days=${days}`)
      .then((r) => {
        if (!cancelled) {
          setData(r)
          setError(null)
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [days])

  const series = data ? fillDays(data.series, data.days) : []
  const max = Math.max(1, ...series.map((p) => p.in + p.out))
  const totals = METRICS.map(([m]) => (data ? data.flows.reduce((sum, f) => sum + f[m], 0) : 0))
  const sumIn = series.reduce((s, p) => s + p.in, 0)
  const sumOut = series.reduce((s, p) => s + p.out, 0)
  const sumNew = series.reduce((s, p) => s + p.newContacts, 0)

  return (
    <>
      <div className="page-title">
        <h1>{t('reports_title')}</h1>
        <div className="row">
          <label style={{ margin: 0 }}>{t('reports_days')}</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d}d
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!data ? (
        loading && <div className="muted">{t('loading')}</div>
      ) : (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="grid" style={{ marginBottom: 16 }}>
            {[
              [t('reports_in'), sumIn],
              [t('reports_out'), sumOut],
              [t('reports_new'), sumNew],
            ].map(([label, value]) => (
              <div className="stat" key={String(label)}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>{t('reports_daily')}</h2>
            <div className="bar">
              {series.map((p) => (
                <div
                  key={p.day}
                  style={{ height: `${((p.in + p.out) / max) * 100}%`, minHeight: p.in + p.out > 0 ? 2 : 0 }}
                  title={`${p.day}\n${t('reports_in')}: ${p.in}\n${t('reports_out')}: ${p.out}\n${t('reports_new')}: ${p.newContacts}`}
                />
              ))}
            </div>
            <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span>{series[0]?.day}</span>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} />
                {t('reports_in')} + {t('reports_out')} (max {max})
              </span>
              <span>{series[series.length - 1]?.day}</span>
            </div>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <h2>{t('nav_flows')}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('editor_name')}</th>
                  {METRICS.map(([m, key]) => (
                    <th key={m} style={{ textAlign: 'right' }}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.flows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div>{f.name}</div>
                      <div className="row" style={{ gap: 4 }}>
                        <span className={`badge ${f.status === 'live' ? 'live' : 'draft'}`}>{f.status === 'live' ? t('status_live') : t('status_draft')}</span>
                        <span className="badge">{t(`channel_${f.channel}` as Key)}</span>
                      </div>
                    </td>
                    {METRICS.map(([m]) => (
                      <td key={m} style={{ textAlign: 'right', color: m === 'errors' && f[m] > 0 ? 'var(--danger)' : undefined }}>
                        {f[m]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Σ</th>
                  {totals.map((v, i) => (
                    <th key={METRICS[i][0]} style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 600 }}>{v}</th>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
