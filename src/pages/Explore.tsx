import { ArrowRight, ShieldAlert } from 'lucide-react'
import { useAccount } from 'wagmi'
import type { View } from '@/lib/router'
import { ConnectPanel } from '@/components/Gate'
import { Overview } from '@/components/explore/Overview'
import { NetworkInfo } from '@/components/explore/NetworkInfo'
import { Ecosystem } from '@/components/explore/Ecosystem'
import { DeveloperHub } from '@/components/explore/DeveloperHub'
import { LatestNews } from '@/components/explore/LatestNews'
import { ArcRings } from '@/components/explore/ArcRings'

const SECTIONS = [
  { id: 'overview', label: 'What is Arc' },
  { id: 'network', label: 'Network' },
  { id: 'ecosystem', label: 'Ecosystem' },
  { id: 'developers', label: 'Developers' },
  { id: 'latest', label: 'Latest' },
] as const

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })

/**
 * Explore Arc: the network, who builds on it, the developer docs and the latest posts, all from Arc's own sources.
 * It is the home page while no wallet is connected; the wallet connects from the top bar on every page.
 */
export function Explore({ navigate }: { navigate: (v: View, search?: string) => void }) {
  const { isConnected } = useAccount()
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section className="surface-hero soft-glow relative overflow-hidden rounded-3xl p-5 sm:p-8" aria-labelledby="explore-h">
        <ArcRings className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 opacity-70 sm:-right-8 sm:h-96 sm:w-96" />
        <div className="relative max-w-xl">
          <p className="label">Explore Arc</p>
          <h1 id="explore-h" className="mt-2 text-balance font-display text-3xl font-bold tracking-[-0.03em] text-white sm:text-5xl">Everything about Arc, in one wallet.</h1>
          <p className="mt-3 text-pretty text-sm text-slate-300 sm:text-base">
            Learn what Arc is, check the network live, discover who builds on it and read the latest from Arc. Everything here comes from Arc's own sites, and each piece says whether it is live or a saved copy.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {isConnected ? (
              <button type="button" className="btn-primary !min-h-[48px] gap-2" onClick={() => navigate('dashboard')}>
                Open my wallet <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <p className="text-sm text-slate-300">Connect a wallet any time with the button in the top right corner.</p>
            )}
          </div>
        </div>
      </section>

      {!isConnected && (
        <section className="glass rounded-3xl p-4 sm:p-5" aria-label="Connect a wallet">
          <h2 className="font-display text-lg font-semibold text-white">Connect to use your wallet</h2>
          <p className="mb-3 mt-1 text-sm text-slate-400">Send, receive, swap and bridge USDC on Arc with real balances and real transactions. Your keys never leave your wallet.</p>
          <ConnectPanel />
          <p className="mt-3 flex items-start gap-2 text-xs text-slate-400"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" /> Arc mainnet moves real funds. Transactions cannot be reversed.</p>
        </section>
      )}

      <nav aria-label="Sections of this page" className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => jump(s.id)} className="min-h-[40px] shrink-0 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10">
            {s.label}
          </button>
        ))}
      </nav>

      <Overview />
      <NetworkInfo />
      <Ecosystem />
      <DeveloperHub />
      <LatestNews />
    </div>
  )
}
