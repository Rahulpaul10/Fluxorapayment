import { useCallback, useState } from 'react'

export type ThemeMode = 'dark' | 'light'
const KEY = 'fluxora:theme'

/** The mode index.html already applied before first paint. */
const current = (): ThemeMode => (document.documentElement.dataset.mode === 'light' ? 'light' : 'dark')

/** Light or dark, remembered on this device. The attribute change repaints through CSS variables only: no React re-render of the pages. */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(current)
  const toggle = useCallback(() => {
    const next: ThemeMode = current() === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.mode = next
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#eaeef6' : '#070B1F')
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
    setMode(next)
  }, [])
  return { mode, toggle }
}
