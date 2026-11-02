import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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

const DEV_DATA_OPTIONS = [
  ['', 'Demo'],
  ['worst', 'Worst case'],
  ['empty', 'Empty'],
  ['one', 'One'],
  ['huge', '1,000 rows'],
] as const

/** Dev-only dataset switch (break-ui). Never rendered in production: see the DEV guard below. */
function DevDataToggle({ onChange }: { onChange: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(() => new URLSearchParams(location.search).get('data') ?? '')

  // NavLinks drop the query string; put `?data=` back so a reload keeps the dataset.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if ((params.get('data') ?? '') === mode) return
    if (mode) params.set('data', mode)
    else params.delete('data')
    const search = params.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }, [location.pathname, location.search, mode, navigate])

  const select = (next: string) => {
    void import('./lib/devFixtures').then((m) => {
      m.setDataMode(next ? (next as (typeof m.DATA_MODES)[number]) : null)
      setMode(next)
      onChange()
    })
  }

  return (
    <div
      role="radiogroup"
      aria-label="Dev data"
      style={{
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        gap: 2,
        padding: 3,
        background: '#e5e7eb',
        borderRadius: 999,
        font: '12px/1 system-ui, sans-serif',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        maxWidth: 'calc(100vw - 16px)',
        overflowX: 'auto',
      }}
    >
      {DEV_DATA_OPTIONS.map(([value, label]) => (
        <button
          key={value}
          role="radio"
          aria-checked={mode === value}
          onClick={() => select(value)}
          style={{
            border: 0,
            borderRadius: 999,
            padding: '6px 10px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            color: '#111827',
            background: mode === value ? '#ffffff' : 'transparent',
            boxShadow: mode === value ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [auth, setAuth] = useState<AuthState>({ loading: true, setupRequired: false, authenticated: false })
  const [devDataKey, setDevDataKey] = useState(0)
  const navigate = useNavigate()

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem('sokuto:lang', l)
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
    window.addEventListener('sokuto:unauthorized', onUnauthorized)
    return () => window.removeEventListener('sokuto:unauthorized', onUnauthorized)
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
        <Shell key={devDataKey} onLogout={logout} />
      )}
      {import.meta.env.DEV && (
        <DevDataToggle
          onChange={() => {
            setDevDataKey((k) => k + 1)
            void refresh()
          }}
        />
      )}
    </LangContext.Provider>
  )
}
