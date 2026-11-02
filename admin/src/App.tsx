import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from './lib/api'
import { LangContext, initialLang, useT, type Lang } from './lib/i18n'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Channels from './pages/Channels'
import Flows from './pages/Flows'
import FlowEditor from './pages/FlowEditor'
import Inbox from './pages/Inbox'
import Contacts from './pages/Contacts'
import Broadcasts from './pages/Broadcasts'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

type AuthState = { loading: boolean; setupRequired: boolean; authenticated: boolean }

function Shell({ onLogout }: { onLogout: () => void }) {
  const t = useT()
  const nav = [
    ['/', t('nav_dashboard')],
    ['/inbox', t('nav_inbox')],
    ['/flows', t('nav_flows')],
    ['/contacts', t('nav_contacts')],
    ['/broadcasts', t('nav_broadcasts')],
    ['/reports', t('nav_reports')],
    ['/channels', t('nav_channels')],
    ['/settings', t('nav_settings')],
  ] as const
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">{t('appName')}</div>
        {nav.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
        <div className="spacer" />
        <a href="#" onClick={(e) => (e.preventDefault(), onLogout())}>
          {t('logout')}
        </a>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inbox/:id" element={<Inbox />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/flows/:id" element={<FlowEditor />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/broadcasts" element={<Broadcasts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [auth, setAuth] = useState<AuthState>({ loading: true, setupRequired: false, authenticated: false })
  const navigate = useNavigate()

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem('fm:lang', l)
    } catch {
      /* ignore */
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<{ setupRequired: boolean; authenticated: boolean }>('/api/auth/status')
      setAuth({ loading: false, ...s })
    } catch {
      setAuth({ loading: false, setupRequired: false, authenticated: false })
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onUnauthorized = () => setAuth((a) => ({ ...a, authenticated: false }))
    window.addEventListener('fm:unauthorized', onUnauthorized)
    return () => window.removeEventListener('fm:unauthorized', onUnauthorized)
  }, [refresh])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const logout = async () => {
    await api.post('/api/auth/logout')
    setAuth((a) => ({ ...a, authenticated: false }))
    navigate('/')
  }

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {auth.loading ? (
        <div className="center muted">…</div>
      ) : !auth.authenticated ? (
        <Login setupRequired={auth.setupRequired} onDone={refresh} />
      ) : (
        <Shell onLogout={logout} />
      )}
    </LangContext.Provider>
  )
}
