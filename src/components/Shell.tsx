import { memo, type ReactNode } from 'react'
import clsx from 'clsx'
import type { View } from '@/lib/router'
import { ViewContext, VIEW_THEMES } from '@/lib/theme'
import { Header } from './Header'
import { Wordmark } from './Logo'
import { ConnectionStatus } from './ConnectionStatus'
import { BackButton } from './BackButton'
import { NetworkBanner } from './NetworkBanner'
import { prefetchView } from '@/lib/viewLoaders'

/** The desktop sidebar's pages (phones use the dashboard's quick actions). History opens from the dashboard; Pay still opens from a /pay link. */
const NAV: View[] = ['send', 'receive', 'swap', 'bridge', 'explore']

const NavButton = memo(function NavButton({ view, active, onClick }: { view: View; active: boolean; onClick: (v: View) => void }) {
  const t = VIEW_THEMES[view]
  const Icon = t.icon
  return (
    <button
      onClick={() => onClick(view)}
      // Start loading the page as soon as the user shows intent, so the click lands on a page that is ready.
      onPointerEnter={() => prefetchView(view)}
      onFocus={() => prefetchView(view)}
      onTouchStart={() => prefetchView(view)}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex items-center rounded-2xl font-semibold transition-colors',
        'min-h-[48px] w-full gap-3 px-3 text-sm',
        active ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon size={18} className={active ? 'text-[var(--a)]' : undefined} />
      <span>{t.label}</span>
    </button>
  )
})

export function Shell({ view, navigate, children }: { view: View; navigate: (v: View) => void; children: ReactNode }) {
  return (
    <ViewContext.Provider value={view}>
      <div className="min-h-dvh">
        <div className="lg:flex">
          {/* Desktop sidebar */}
          <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col justify-between border-r border-white/5 bg-navy-900 p-5 lg:flex">
            <div>
              <button onClick={() => navigate('dashboard')} className="mb-8 mt-1 px-1" aria-label="FLUXORA home">
                <Wordmark size={34} />
              </button>
              <nav className="flex flex-col gap-1" aria-label="Main">
                {NAV.map((v) => (
                  <NavButton key={v} view={v} active={v === view} onClick={navigate} />
                ))}
              </nav>
            </div>
            <ConnectionStatus variant="card" />
          </aside>

          <div className="min-w-0 flex-1">
            <Header onHome={() => navigate('dashboard')} onSettings={() => navigate('settings')} settingsActive={view === 'settings'} />
            <main className="mx-auto w-full max-w-5xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4 lg:px-8 lg:pb-16 lg:pt-6">
              <NetworkBanner />
              {view !== 'dashboard' && <BackButton navigate={navigate} />}
              {children}
            </main>
          </div>
        </div>
      </div>
    </ViewContext.Provider>
  )
}
