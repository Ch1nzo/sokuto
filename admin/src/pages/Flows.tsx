import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
import type { FlowRecord } from '@shared/flows/types'
import type { FlowTemplate } from '@shared/flows/templates'

type FlowListItem = FlowRecord & { runs30d: number }

export default function Flows() {
  const t = useT()
  const { lang } = useLang()
  const navigate = useNavigate()
  const [flows, setFlows] = useState<FlowListItem[] | null>(null)
  const [templates, setTemplates] = useState<FlowTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.get<{ flows: FlowListItem[] }>('/api/flows').then((r) => setFlows(r.flows))
    void api.get<{ templates: FlowTemplate[] }>('/api/templates').then((r) => setTemplates(r.templates))
  }, [])

  const create = async (body: Record<string, unknown>) => {
    setError('')
    try {
      const r = await api.post<{ flow: FlowRecord }>('/api/flows', body)
      navigate(`/flows/${r.flow.id}`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>{t('flows_title')}</h1>
        <div className="row">
          <button className="btn" onClick={() => setShowTemplates((s) => !s)}>{t('flows_from_template')}</button>
          <button className="btn primary" onClick={() => create({ name: t('flows_blank') })}>{t('flows_new')}</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {showTemplates && (
        <div className="card">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {templates.map((tp) => (
              <div className="list-item" key={tp.slug}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{tp.name[lang]}</strong>
                  <span className="badge">{t(`channel_${tp.channel}` as 'channel_any')}</span>
                </div>
                <div className="small muted" style={{ margin: '6px 0' }}>{tp.description[lang]}</div>
                <button className="btn small primary" onClick={() => create({ template: tp.slug })}>{t('create')}</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!flows ? (
        <div className="muted">{t('loading')}</div>
      ) : flows.length === 0 ? (
        <div className="card muted">{t('flows_empty')}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>{t('editor_name')}</th><th>{t('editor_channel')}</th><th>{t('editor_triggers')}</th><th>{t('flows_runs')}</th><th></th></tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => navigate(`/flows/${f.id}`)}>
                  <td><strong>{f.name}</strong></td>
                  <td>{t(`channel_${f.channel}` as 'channel_any')}</td>
                  <td className="small muted">{f.definition.triggers.map((tr) => t(`trigger_${tr.type}` as 'trigger_keyword')).join(', ') || '—'}</td>
                  <td>{f.runs30d}</td>
                  <td><span className={`badge ${f.status}`}>{f.status === 'live' ? t('status_live') : t('status_draft')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
