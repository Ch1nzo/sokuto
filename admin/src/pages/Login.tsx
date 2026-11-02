import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'

export default function Login({ setupRequired, onDone }: { setupRequired: boolean; onDone: () => void }) {
  const t = useT()
  const { lang, setLang } = useLang()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (setupRequired && password !== confirm) return setError(t('password_mismatch'))
    setBusy(true)
    try {
      await api.post(setupRequired ? '/api/auth/setup' : '/api/auth/login', { password })
      onDone()
    } catch (err) {
      setError(setupRequired ? errorMessage(err) : t('login_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>{setupRequired ? t('setup_title') : t('login_title')}</h1>
          <select value={lang} onChange={(e) => setLang(e.target.value as 'ja' | 'en')} style={{ width: 'auto' }}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
        {setupRequired && <p className="muted small">{t('setup_lead')}</p>}
        <form onSubmit={submit}>
          <label>{t('password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus minLength={8} required />
          {setupRequired && (
            <>
              <label>{t('password_confirm')}</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </>
          )}
          {error && <div className="alert error">{error}</div>}
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={busy} type="submit">
              {setupRequired ? t('create') : t('login')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
