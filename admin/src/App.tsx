import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ContextType, type MouseEvent, type ReactNode } from 'react'
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { Button, Icon, NavItem, SegmentedControl, SegmentedControlItem, Text } from '@channel.io/bezier-react'
import {
  AiIcon,
  CancelIcon,
  ChannelsListIcon,
  DesktopIcon,
  GraphIcon,
  InboxIcon,
  LightningIcon,
  MegaphoneIcon,
  MenuIcon,
  MoonIcon,
  OutIcon,
  PeopleIcon,
  SettingsIcon,
  WeatherSunIcon,
  type BezierIcon,
} from '@channel.io/bezier-icons'
import { api, getWorkspaceId } from './lib/api'
import { LangContext, initialLang, useLang, useT, type Key, type Lang } from './lib/i18n'
import { useTheme, type ThemePref } from './lib/theme'
import { WorkspaceContext, countLabel, type Workspace } from './lib/workspace'
import { RealtimeClient, RealtimeContext } from './lib/realtime'
import { LoadingState, SokutoMark, WorkspaceSwitcher } from './components'
import Login from './pages/Login'

// Pages behind the login are split into their own chunks (each page imports its own CSS).
// Login stays eager: it is the first screen for a signed-out user.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Channels = lazy(() => import('./pages/Channels'))
const Flows = lazy(() => import('./pages/Flows'))
const FlowEditor = lazy(() => import('./pages/FlowEditor'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Contacts = lazy(() => import('./pages/Contacts'))
const Broadcasts = lazy(() => import('./pages/Broadcasts'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Bot = lazy(() => import('./pages/Bot'))

type AuthState = { loading: boolean; setupRequired: boolean; authenticated: boolean }

/** Channel.io order: the inbox is the workhorse, so it comes first. Home (dashboard) is the brand link. */
const NAV: { to: string; label: Key; icon: BezierIcon }[] = [
  { to: '/inbox', label: 'nav_inbox', icon: InboxIcon },
  { to: '/contacts', label: 'nav_contacts', icon: PeopleIcon },
  { to: '/flows', label: 'nav_flows', icon: LightningIcon },
  { to: '/bot', label: 'nav_bot', icon: AiIcon },
  { to: '/broadcasts', label: 'nav_broadcasts', icon: MegaphoneIcon },
  { to: '/reports', label: 'nav_reports', icon: GraphIcon },
  { to: '/channels', label: 'nav_channels', icon: ChannelsListIcon },
  { to: '/settings', label: 'nav_settings', icon: SettingsIcon },
]

/** Counts for the nav badge and tab title: realtime events drive them; this poll is only the safety net. */
const COUNTS_POLL_MS = 60_000
/** `admin/index.html`'s title; `Sokutō (N)` while N conversations are open. */
const BASE_TITLE = 'Sokutō'

type InboxCounts = { open: number; unread: number }

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

/** Theme + language. Compact in the sidebar footer; labeled and full width in the mobile menu sheet. */
function Preferences({ labeled }: { labeled?: boolean }) {
  const t = useT()
  const { lang, setLang } = useLang()
  const { pref, setPref } = useTheme()
  const size = labeled ? 'm' : 'xs'
  const themes: [ThemePref, BezierIcon, Key][] = [
    ['light', WeatherSunIcon, 'theme_light'],
    ['dark', MoonIcon, 'theme_dark'],
    ['system', DesktopIcon, 'theme_system'],
  ]
  const theme = (
    <SegmentedControl type="radiogroup" size={size} width="100%" value={pref} onValueChange={setPref} aria-label={t('theme')}>
      {themes.map(([value, icon, label]) => (
        <SegmentedControlItem key={value} value={value} title={t(label)} leftContent={<Icon source={icon} size={labeled ? 'xs' : 'xxs'} />}>
          {t(label)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
  const language = (
    <SegmentedControl type="radiogroup" size={size} width="100%" value={lang} onValueChange={(v: Lang) => setLang(v)} aria-label={t('settings_language')}>
      <SegmentedControlItem value="ja">日本語</SegmentedControlItem>
      <SegmentedControlItem value="en">English</SegmentedControlItem>
    </SegmentedControl>
  )
  if (!labeled) {
    return (
      <div className="prefs">
        {theme}
        {language}
      </div>
    )
  }
  return (
    <div className="prefs prefs--labeled">
      <div className="prefs__field">
        <Text as="div" typo="13" bold color="txt-black-darker">
          {t('theme')}
        </Text>
        {theme}
      </div>
      <div className="prefs__field">
        <Text as="div" typo="13" bold color="txt-black-darker">
          {t('settings_language')}
        </Text>
        {language}
      </div>
    </div>
  )
}

/**
 * Mobile menu (preferences + sign out) as a bottom sheet. Native <dialog>: focus trap, Esc and the
 * inert background come from the platform; the scrim is the dialog itself, the panel slides up.
 */
function MenuSheet({ open, onClose, onLogout }: { open: boolean; onClose: () => void; onLogout: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="sheet" aria-labelledby="menu-sheet-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet__panel">
        <div className="sheet__head">
          <Text as="h2" id="menu-sheet-title" typo="16" bold color="txt-black-darkest">
            {t('nav_menu')}
          </Text>
          <Button styleVariant="tertiary" colorVariant="monochrome-dark" size="m" leftContent={CancelIcon} aria-label={t('close')} onClick={onClose} />
        </div>
        <Preferences labeled />
        <Button className="sheet__logout" styleVariant="secondary" colorVariant="monochrome-dark" size="l" leftContent={OutIcon} text={t('logout')} onClick={onLogout} />
      </div>
    </dialog>
  )
}

/** What every page behind the login can read: the workspaces (+ unread count) and the realtime inbox events. */
function ShellContext({ workspace, realtime, children }: { workspace: ContextType<typeof WorkspaceContext>; realtime: ContextType<typeof RealtimeContext>; children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      <RealtimeContext.Provider value={realtime}>{children}</RealtimeContext.Provider>
    </WorkspaceContext.Provider>
  )
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const t = useT()
  const location = useLocation()
  const linkClick = useLinkClick()
  const scrollerRef = useOverflowFade<HTMLDivElement>()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsError, setWsError] = useState<unknown>(null)
  const [counts, setCounts] = useState<InboxCounts | null>(null)
  const unread = counts?.unread ?? null
  const [connected, setConnected] = useState(false)
  const [client, setClient] = useState<RealtimeClient | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const isActive = (to: string) => !!matchPath({ path: to, end: to === '/' }, location.pathname) || (to !== '/' && location.pathname.startsWith(`${to}/`))

  const reload = useCallback(async () => {
    try {
      setWorkspaces((await api.get<{ workspaces: Workspace[] }>('/api/workspaces')).workspaces)
      setWsError(null)
    } catch (err) {
      // The switcher shows its placeholder; Settings › Workspaces shows the error with a retry.
      setWsError(err)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadCounts = useCallback(() => api.get<InboxCounts>('/api/inbox/counts').then(setCounts, () => undefined), [])

  // One realtime connection per tab, for this tab's workspace (switching workspaces reloads the page).
  const workspaceId = getWorkspaceId()
  useEffect(() => {
    const c = new RealtimeClient(workspaceId, setConnected)
    c.start()
    setClient(c)
    return () => {
      c.stop()
      setClient(null)
    }
  }, [workspaceId])

  // After every navigation (opening a conversation marks it read), on every inbox event (debounced), and on a
  // slow poll that also runs in background tabs, so the title stays right while the tab is not looked at.
  useEffect(() => {
    void loadCounts()
  }, [loadCounts, location.pathname])

  useEffect(() => {
    if (!client) return
    let timer: number | undefined
    const off = client.subscribe(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void loadCounts(), 250)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [client, loadCounts])

  useEffect(() => {
    const id = window.setInterval(() => void loadCounts(), COUNTS_POLL_MS)
    return () => window.clearInterval(id)
  }, [loadCounts])

  const open = counts?.open ?? 0
  useEffect(() => {
    document.title = open > 0 ? `${BASE_TITLE} (${open})` : BASE_TITLE
  }, [open])
  useEffect(() => () => void (document.title = BASE_TITLE), [])

  // Mobile nav row: keep the active entry visible after navigation and whenever the row or its content
  // changes width (web font swap, the unread badge appearing, a page scrollbar appearing).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    // Centers it by setting scrollLeft: scrollIntoView() would also move Chrome's sequential focus starting
    // point, so the first Tab would skip the skip link, brand, switcher and nav.
    const reveal = () => {
      const a = el.querySelector<HTMLElement>('[aria-current="page"]')
      if (a) el.scrollLeft += a.getBoundingClientRect().left - el.getBoundingClientRect().left - (el.clientWidth - a.offsetWidth) / 2
    }
    const ro = new ResizeObserver(reveal)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [location.pathname, scrollerRef])

  const current = workspaces.find((w) => String(w.id) === getWorkspaceId())
  const ctx = useMemo(() => ({ workspaces, current, unread, error: wsError, reload }), [workspaces, current, unread, wsError, reload])
  const realtime = useMemo(() => ({ subscribe: client ? client.subscribe : () => () => {}, connected }), [client, connected])
  const home = location.pathname === '/'

  return (
    <ShellContext workspace={ctx} realtime={realtime}>
      {/* Focuses <main> without touching the URL hash (Settings keeps its section there). */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        {t('skip_to_main')}
      </a>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__top">
            <a className="sidebar__brand" href="/" onClick={linkClick('/')} aria-current={home ? 'page' : undefined} title={t('nav_home')}>
              <SokutoMark size={24} />
              <Text typo="15" bold color="txt-black-darkest" className="sidebar__brand-name" translate="no">
                {t('appName')}
              </Text>
              <span className="visually-hidden">{t('nav_home')}</span>
            </a>
            <WorkspaceSwitcher />
            <Button
              className="sidebar__menu"
              styleVariant="tertiary"
              colorVariant="monochrome-dark"
              size="m"
              leftContent={MenuIcon}
              aria-label={t('nav_menu')}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            />
          </div>
          <div className="sidebar__scroller" ref={scrollerRef}>
            <nav aria-label={t('nav_label')} className="sidebar__nav">
              <ul role="menu">
                {NAV.map(({ to, label, icon }) => {
                  const active = isActive(to)
                  const count = to === '/inbox' ? (unread ?? 0) : 0
                  return (
                    <NavItem
                      key={to}
                      name={to}
                      href={to}
                      content={t(label)}
                      leftContent={icon}
                      active={active}
                      aria-current={active ? 'page' : undefined}
                      rightContent={
                        count > 0 ? (
                          <span className="nav-count">
                            <span aria-hidden="true">{countLabel(count)}</span>
                            <span className="visually-hidden">{t('nav_unread_count').replace('{n}', countLabel(count))}</span>
                          </span>
                        ) : undefined
                      }
                      onClick={linkClick(to)}
                    />
                  )
                })}
              </ul>
            </nav>
          </div>
          <div className="sidebar__footer">
            <Preferences />
            <ul role="menu" className="sidebar__logout">
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
          </div>
        </aside>
        <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} onLogout={onLogout} />
        <main className="main" id="main" tabIndex={-1}>
          <div className="main__inner">
            <Suspense fallback={<LoadingState />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/inbox/:id" element={<Inbox />} />
                <Route path="/flows" element={<Flows />} />
                <Route path="/flows/:id" element={<FlowEditor />} />
                <Route path="/bot/*" element={<Bot />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/broadcasts" element={<Broadcasts />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/channels" element={<Channels />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </ShellContext>
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
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true })
  }, [location.pathname, location.search, location.hash, mode, navigate])

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
