import { Moon, Sun } from 'lucide-react'
import { useThemeMode } from '@/hooks/useThemeMode'

/** Light / dark switch for the top bar. */
export function ThemeToggle() {
  const { mode, toggle } = useThemeMode()
  const next = mode === 'light' ? 'dark' : 'light'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="glass flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl text-slate-300 transition-colors hover:text-white"
    >
      {mode === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}
