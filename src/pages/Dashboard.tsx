import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Landmark } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useValuedBalances } from '@/hooks/useValuedBalances'
import { useHistoryRows } from '@/hooks/useHistoryRows'
import { useArcWallet } from '@/hooks/useWallet'
import { fmtUsd } from '@/lib/format'
import { USDC } from '@/lib/tokens'
import { prefetchView } from '@/lib/viewLoaders'
import type { View } from '@/lib/router'
import { Card, ExplorerLink, Notice } from '@/components/ui'
import { WalletIdentity } from '@/components/WalletIdentity'
import { AssetCard } from '@/components/AssetCard'
import { ArcNetworkCard, GasInsight } from '@/components/ArcStatusCards'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { ExploreArc } from '@/components/ExploreArc'
import { ARC_CHAIN_ID, explorerAddress } from '@/config/networks'
import { ConnectPanel } from '@/components/Gate'
import { Wordmark } from '@/components/Logo'

const ACTIONS: { view: View; label: string; icon: typeof ArrowUpRight }[] = [
  { view: 'send', label: 'Send', icon: ArrowUpRight },
  { view: 'receive', label: 'Receive', icon: ArrowDownToLine },
  { view: 'swap', label: 'Swap', icon: ArrowLeftRight },
  { view: 'bridge', label: 'Bridge', icon: Landmark },
]

function Landing() {
  return (
    <div className="mx-auto max-w-md space-y-6 pt-4 text-center">
      <Wordmark size={40} className="mx-auto" />
      <div>
        <h1 className="text-balance font-display text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">One Wallet. Every Possibility.</h1>
        <p className="mt-3 text-pretty text-sm text-slate-400">Send, receive, swap and bridge USDC on Arc. Real balances and real transactions. Your keys never leave your wallet.</p>
      </div>
      <div className="text-left">
        <ConnectPanel />
      </div>
      <p className="text-xs text-slate-500">Arc mainnet moves real funds. Transactions cannot be reversed.</p>
    </div>
  )
}

export function Dashboard({ navigate }: { navigate: (v: View, search?: string) => void }) {
  const { isConnected, address } = useAccount()
  const { onArc, switchToArc } = useArcWallet()
  const { rows: assets, total, unpriced, unreadable, loading, pricesLoading, refetch: refetchBalances } = useValuedBalances()
  const { rows, transfers } = useHistoryRows()

  if (!isConnected || !address) return <Landing />

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {!onArc && (
        <Notice tone="warn" action={<button className="btn-ghost !min-h-[44px]" onClick={() => void switchToArc()}>Switch to Arc</button>}>
          Your wallet is not on Arc mainnet. Balances below are Arc balances.
        </Notice>
      )}

      {/* The balance is the one dominant object: wallet identity above it, nothing between it and the actions below */}
      <section className="surface-hero soft-glow rounded-3xl p-4 sm:p-5" aria-label="Wallet balance">
        <WalletIdentity address={address} />
        <div className="mt-5 pb-1 text-center">
          <p className="label">Total balance</p>
          <p className="mt-1.5 break-words font-display text-5xl font-bold tracking-[-0.04em] text-white tabular sm:text-6xl" data-testid="total-balance">
            {loading ? <span className="skeleton inline-block h-12 w-48 align-middle" aria-busy="true" aria-label="Loading balance" /> : unreadable ? <>—</> : <>${fmtUsd(total, USDC.decimals)}</>}
          </p>
          <p className="mt-1 text-xs text-slate-400">USDC value of your Arc assets</p>
          {unreadable && (
            <p className="mt-1 text-xs text-amber-200" role="status">
              Some balances could not be read right now (the network is busy). Trying again automatically.{' '}
              <button className="min-h-[44px] px-1 font-semibold underline" onClick={() => void refetchBalances()}>
                Retry now
              </button>
            </p>
          )}
          {unpriced.length > 0 && <p className="mt-1 text-xs text-amber-200">No live price for {unpriced.map((u) => u.token.symbol).join(', ')}. Held, but not in the total.</p>}
        </div>
      </section>

      {/* Four actions, one style */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {ACTIONS.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            type="button"
            onClick={() => navigate(view)}
            onPointerEnter={() => prefetchView(view)}
            onTouchStart={() => prefetchView(view)}
            className="glass tap lift flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 text-xs font-semibold text-white sm:text-sm"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--a)]/15 text-[var(--a)]">
              <Icon size={18} />
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* Assets */}
      <section aria-labelledby="assets-title">
        <h2 id="assets-title" className="label mb-2 px-1">
          Assets
        </h2>
        <ul className="space-y-2.5">
          {assets.map((r) => (
            <AssetCard key={r.token.address} row={r} pricesLoading={pricesLoading} navigate={navigate} />
          ))}
        </ul>
      </section>

      {/* Network and gas: both read from Arc */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ArcNetworkCard />
        <GasInsight rows={rows} />
      </div>

      {/* Recent activity */}
      <Card className="!p-3 sm:!p-4">
        <div className="flex items-center justify-between px-1 pb-1">
          <h2 className="label">Recent activity</h2>
          <button className="-my-2 min-h-[44px] px-1 text-sm font-medium text-[var(--a)] hover:brightness-125" onClick={() => navigate('history')}>
            View all
          </button>
        </div>
        <ActivityTimeline rows={rows} loading={transfers.isLoading} limit={5} onOpenTx={(hash, chainId) => navigate('tx', `?hash=${hash}&chain=${chainId}`)} empty="No activity in the recent blocks scanned. Older history is on the History page." />
        <div className="border-t border-white/5 px-1 pt-1">
          <ExplorerLink href={explorerAddress(ARC_CHAIN_ID, address)}>View on Arc Explorer</ExplorerLink>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <button className="glass lift rounded-2xl p-4 text-left" onClick={() => navigate('analytics')}>
          <p className="label">Portfolio</p>
          <p className="mt-1 font-display text-base font-semibold text-white">Analytics</p>
          <p className="mt-0.5 text-xs text-slate-400">Counts, volume, fees</p>
        </button>
        <button className="glass lift rounded-2xl p-4 text-left" onClick={() => navigate('bridges')}>
          <p className="label">CCTP</p>
          <p className="mt-1 font-display text-base font-semibold text-white">Bridge history</p>
          <p className="mt-0.5 text-xs text-slate-400">Verified transfers</p>
        </button>
      </div>

      <ExploreArc navigate={navigate} />
    </div>
  )
}
