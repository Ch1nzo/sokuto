import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useLang, useT, type Lang } from '../lib/i18n'

type General = {
  botName: string
  language: Lang
  timezone: string
  paused: boolean
  handoffKeywords: string[]
  handoffReply: string
}

type SettingsResponse = { general: General; mcp: { configured: boolean; url: string } }

type Msg = { kind: 'ok' | 'error'; text: string } | null

function CopyBox({ value, multiline = false }: { value: string; multiline?: boolean }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {multiline ? (
        <pre className="code-box mono" style={{ flex: 1, margin: 0, whiteSpace: 'pre-wrap' }}>{value}</pre>
      ) : (
        <code className="code-box" style={{ flex: 1 }}>{value}</code>
      )}
      <button
        className="btn small"
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
      >
        {done ? t('channels_copied') : t('channels_copy')}
      </button>
    </div>
  )
}

export default function Settings() {
  const t = useT()
  const { setLang } = useLang()
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<{ botName: string; language: Lang; paused: boolean; keywords: string; handoffReply: string } | null>(null)
  const [generalMsg, setGeneralMsg] = useState<Msg>(null)
  const [mcpMsg, setMcpMsg] = useState<Msg>(null)
  const [pwMsg, setPwMsg] = useState<Msg>(null)
  const [token, setToken] = useState<{ token: string; url: string } | null>(null)
  const [pw, setPw] = useState({ current: '', password: '' })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const r = await api.get<SettingsResponse>('/api/settings')
      setData(r)
      setForm({
        botName: r.general.botName,
        language: r.general.language,
        paused: r.general.paused,
        keywords: r.general.handoffKeywords.join(', '),
        handoffReply: r.general.handoffReply,
      })
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loadError && !data) return <div className="alert error">{loadError}</div>
  if (!data || !form) return <div className="muted">{t('loading')}</div>

  const saveGeneral = async () => {
    setBusy(true)
    setGeneralMsg(null)
    try {
      const r = await api.put<{ general: General }>('/api/settings', {
        botName: form.botName,
        language: form.language,
        paused: form.paused,
        handoffKeywords: form.keywords
          .split(/[,、]/)
          .map((s) => s.trim())
          .filter(Boolean),
        handoffReply: form.handoffReply,
      })
      setData({ ...data, general: r.general })
      setLang(r.general.language)
      setGeneralMsg({ kind: 'ok', text: t('saved') })
    } catch (err) {
      setGeneralMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const rotate = async () => {
    if (data.mcp.configured && !confirm(`${t('settings_mcp_regenerate')}?`)) return
    setBusy(true)
    setMcpMsg(null)
    try {
      const r = await api.post<{ token: string; url: string }>('/api/settings/mcp/rotate')
      setToken(r)
      setData({ ...data, mcp: { configured: true, url: r.url } })
    } catch (err) {
      setMcpMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!confirm(t('confirmDelete'))) return
    setBusy(true)
    setMcpMsg(null)
    try {
      await api.delete('/api/settings/mcp')
      setToken(null)
      setData({ ...data, mcp: { ...data.mcp, configured: false } })
    } catch (err) {
      setMcpMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async () => {
    setBusy(true)
    setPwMsg(null)
    try {
      await api.post('/api/auth/password', pw)
      setPw({ current: '', password: '' })
      setPwMsg({ kind: 'ok', text: t('saved') })
    } catch (err) {
      setPwMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const mcpUrl = token?.url ?? data.mcp.url
  const jsonSnippet = token
    ? JSON.stringify({ mcpServers: { flowmaker: { url: mcpUrl, headers: { Authorization: `Bearer ${token.token}` } } } }, null, 2)
    : ''
  const cliSnippet = token ? `claude mcp add --transport http flowmaker ${mcpUrl} --header "Authorization: Bearer ${token.token}"` : ''

  return (
    <>
      <div className="page-title">
        <h1>{t('settings_title')}</h1>
      </div>

      <div className="card">
        <h2>{t('settings_general')}</h2>
        {generalMsg && <div className={`alert ${generalMsg.kind}`}>{generalMsg.text}</div>}
        <div className="inline-fields">
          <div>
            <label>{t('settings_bot_name')}</label>
            <input value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value })} />
          </div>
          <div>
            <label>{t('settings_language')}</label>
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value === 'en' ? 'en' : 'ja' })}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <label className="row" style={{ color: 'var(--text)', marginTop: 12 }}>
          <input type="checkbox" checked={form.paused} onChange={(e) => setForm({ ...form, paused: e.target.checked })} style={{ width: 'auto' }} />
          {t('settings_paused')}
        </label>
        <label>{t('settings_handoff_keywords')}</label>
        <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
        <label>{t('settings_handoff_reply')}</label>
        <textarea value={form.handoffReply} onChange={(e) => setForm({ ...form, handoffReply: e.target.value })} />
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy} onClick={() => void saveGeneral()}>
            {t('save')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('settings_mcp')}</h2>
          <span className={`badge ${data.mcp.configured ? 'live' : 'draft'}`}>
            {data.mcp.configured ? t('settings_mcp_configured') : t('settings_mcp_not_configured')}
          </span>
        </div>
        <div className="small muted">{t('settings_mcp_lead')}</div>
        {mcpMsg && <div className={`alert ${mcpMsg.kind}`}>{mcpMsg.text}</div>}
        <label>{t('settings_mcp_url')}</label>
        <CopyBox value={mcpUrl} />
        {token && (
          <>
            <label>{t('settings_mcp_token')}</label>
            <CopyBox value={token.token} />
            <div className="alert info small">{t('settings_mcp_how')}</div>
            <label>Claude Desktop / JSON</label>
            <CopyBox value={jsonSnippet} multiline />
            <label>Claude Code</label>
            <CopyBox value={cliSnippet} multiline />
          </>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy} onClick={() => void rotate()}>
            {data.mcp.configured ? t('settings_mcp_regenerate') : t('settings_mcp_generate')}
          </button>
          {data.mcp.configured && (
            <button className="btn danger" disabled={busy} onClick={() => void revoke()}>
              {t('settings_mcp_revoke')}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>{t('settings_password')}</h2>
        {pwMsg && <div className={`alert ${pwMsg.kind}`}>{pwMsg.text}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void changePassword()
          }}
        >
          <div className="inline-fields">
            <div>
              <label>{t('settings_current_password')}</label>
              <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div>
              <label>{t('settings_new_password')}</label>
              <input type="password" autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" type="submit" disabled={busy || !pw.current || pw.password.length < 8}>
              {t('save')}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
