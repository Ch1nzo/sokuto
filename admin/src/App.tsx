import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { Button, Icon, NavItem, SegmentedControl, SegmentedControlItem, Text } from '@channel.io/bezier-react'
import {
  ChannelsListIcon,
  GraphIcon,
  HomeIcon,
  InboxIcon,
  LightningIcon,
  MegaphoneIcon,
  MoonIcon,
  OutIcon,
  PeopleIcon,
  SettingsIcon,
  WeatherSunIcon,
  DesktopIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import { api } from './lib/api'
import { LangContext, initialLang, useLang, useT, type Key, type Lang } from './lib/i18n'
import { useTheme, type ThemePref } from './lib/theme'
import { LoadingState, SokutoMark } from './components'
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

const NAV: { to: string; label: Key; icon: BezierIcon }[] = [
  { to: '/', label: 'nav_dashboard', icon: HomeIcon },
  { to: '/inbox', label: 'nav_inbox', icon: InboxIcon },
  { to: '/flows', label: 'nav_flows', icon: LightningIcon },
  { to: '/contacts', label: 'nav_contacts', icon: PeopleIcon },
  { to: '/broadcasts', label: 'nav_broadcasts', icon: MegaphoneIcon },
  { to: '/reports', label: 'nav_reports', icon: GraphIcon },
  { to: '/channels', label: 'nav_channels', icon: ChannelsListIcon },
  { to: '/settings', label: 'nav_settings', icon: SettingsIcon },
]

/** Plain left click → client-side navigation; modified clicks keep the native link behaviour. */
function useLinkClick() {
  const navigate = useNavigate()
  return (to: string) => (e?: MouseEvent) => {
    if (!e || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
}

/** Toggles `data-fade-start/end` on a horizontal scroller so CSS can fade only the edges that overflow. */
function useOverflowFade<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      el.dataset.fadeStart = String(el.scrollLeft > 1)
      el.dataset.fadeEnd = String(max - el.scrollLeft > 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  return ref
}

function Preferences() {
  const t = useT()
  const { lang, setLang } = useLang()
  const { pref, setPref } = useTheme()
  const themes: [ThemePref, BezierIcon, Key][] = [
    ['light', WeatherSunIcon, 'theme_light'],
    ['dark', MoonIcon, 'theme_dark'],
    ['system', DesktopIcon, 'theme_system'],
  ]
  return (
    <div className="sidebar__prefs">
      <SegmentedControl type="radiogroup" size="xs" value={pref} onValueChange={setPref} aria-label={t('theme')}>
        {themes.map(([value, icon, label]) => (
          <SegmentedControlItem key={value} value={value} title={t(label)} leftContent={<Icon source={icon} size="xxs" />}>
            {t(label)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <SegmentedControl type="radiogroup" size="xs" value={lang} onValueChange={(v: Lang) => setLang(v)} aria-label={t('settings_language')}>
        <SegmentedControlItem value="ja">日本語</SegmentedControlItem>
        <SegmentedControlItem value="en">English</SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const t = useT()
  const location = useLocation()
  const linkClick = useLinkClick()
  const scrollerRef = useOverflowFade<HTMLDivElement>()
  const isActive = (to: string) => !!matchPath({ path: to, end: to === '/' }, location.pathname) || (to !== '/' && location.pathname.startsWith(`${to}/`))

  // Mobile top bar: keep the active entry visible after navigation.
  useEffect(() => {
    scrollerRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [location.pathname, scrollerRef])

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="sidebar__brand" href="/" onClick={linkClick('/')} aria-label={t('appName')}>
          <SokutoMark size={28} />
          <Text typo="17" bold color="txt-black-darkest" className="sidebar__brand-name">
            {t('appName')}
          </Text>
        </a>
        <div className="sidebar__scroller" ref={scrollerRef}>
          <nav aria-label={t('nav_label')} className="sidebar__nav">
            <ul role="menu">
              {NAV.map(({ to, label, icon }) => {
                const active = isActive(to)
                return (
                  <NavItem
                    key={to}
                    name={to}
                    href={to}
                    content={t(label)}
                    leftContent={icon}
                    active={active}
                    aria-current={active ? 'page' : undefined}
                    onClick={linkClick(to)}
                  />
                )
              })}
            </ul>
          </nav>
          <Preferences />
        </div>
        <div className="sidebar__logout">
          <ul role="menu" className="sidebar__logout-full">
            <NavItem
              name="logout"
              href="#logout"
              content={t('logout')}
              leftContent={OutIcon}
              onClick={(e) => {
                e?.preventDefault()
                onLogout()
              }}
            />
          </ul>
          <Button
            className="sidebar__logout-icon"
            styleVariant="tertiary"
            colorVariant="monochrome-dark"
            size="m"
            leftContent={OutIcon}
            aria-label={t('logout')}
            title={t('logout')}
            onClick={onLogout}
          />
        </div>
      </aside>
      <main className="main">
        <div className="main__inner">
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
        </div>
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

  // Radix radio items cannot have an empty value, so "Demo" ('') is mapped to 'demo' for the control only.
  return (
    <div className="dev-data-toggle">
      <SegmentedControl
        type="radiogroup"
        size="xs"
        aria-label="Dev data"
        width={440}
        value={mode || 'demo'}
        onValueChange={(v: string) => select(v === 'demo' ? '' : v)}
      >
        {DEV_DATA_OPTIONS.map(([value, label]) => (
          <SegmentedControlItem key={value || 'demo'} value={value || 'demo'}>
            {label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
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
        <LoadingState />
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
