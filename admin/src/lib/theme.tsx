import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppProvider, ToastProvider, type ThemeName } from '@channel.io/bezier-react'

/** User preference. `system` follows `prefers-color-scheme`. Stored in localStorage `sokuto:theme`. */
export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'sokuto:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

type ThemeContextValue = { pref: ThemePref; themeName: ThemeName; setPref: (p: ThemePref) => void }

const ThemeContext = createContext<ThemeContextValue>({ pref: 'system', themeName: 'light', setPref: () => {} })

export function useTheme() {
  return useContext(ThemeContext)
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

/**
 * Root provider: Bezier `AppProvider` (sets `data-bezier-theme` on <html>, which switches every
 * Bezier CSS variable) + `ToastProvider` (required by `useToast`) + our theme preference context.
 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [isSystemDark, setSystemDark] = useState(systemDark)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p)
    try {
      localStorage.setItem(STORAGE_KEY, p)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const themeName: ThemeName = pref === 'system' ? (isSystemDark ? 'dark' : 'light') : pref

  // Native form controls / scrollbars follow the resolved theme, not the OS.
  useEffect(() => {
    document.documentElement.style.colorScheme = themeName
  }, [themeName])

  const value = useMemo(() => ({ pref, themeName, setPref }), [pref, themeName, setPref])

  return (
    <ThemeContext.Provider value={value}>
      <AppProvider themeName={themeName}>
        <ToastProvider>{children}</ToastProvider>
      </AppProvider>
    </ThemeContext.Provider>
  )
}
