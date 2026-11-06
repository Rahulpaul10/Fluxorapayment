import { useMemo } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Landmark } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useTokenBalances, useTokenPrices } from '@/hooks/useBalances'
import { useHistoryRows } from '@/hooks/useHistoryRows'
import { useArcWallet } from '@/hooks/useWallet'
import { fmtToken, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { USDC } from '@/lib/tokens'
import { explorerTx } from '@/config/networks'
import { prefetchView } from '@/lib/viewLoaders'
import type { View } from '@/lib/router'
import { Card, CopyButton, ExplorerLink, Notice, Spinner, TokenIcon } from '@/components/ui'
import { ConnectPanel } from '@/components/Gate'
import { Wordmark } from '@/components/Logo'
import { HistoryKindBadge } from '@/components/HistoryKindBadge'

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

export function Dashboard({ navigate }: { navigate: (v: View) => void }) {
  const { isConnected, address } = useAccount()
  const { onArc, switchToArc } = useArcWallet()
  const balances = useTokenBalances()
  const prices = useTokenPrices()
  const { rows, transfers } = useHistoryRows()

  const valued = useMemo(
    () =>
      balances.rows.map((r) => {
        const price = prices.data?.[r.token.symbol]
        // value in 6-decimal USDC base units; unknown price => unknown value (never guessed)
        const value = r.raw === undefined || price === undefined || price === null ? null : (r.raw * price) / 10n ** BigInt(r.token.decimals)
        return { ...r, value }
      }),
    [balances.rows, prices.data],
  )

  const total = valued.reduce((sum, r) => sum + (r.value ?? 0n), 0n)
  const unpriced = valued.filter((r) => r.raw !== undefined && r.raw > 0n && r.value === null)
  const loading = balances.isLoading || prices.isLoading

  if (!isConnected || !address) return <Landing />

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {!onArc && (
        <Notice tone="warn" action={<button className="btn-ghost !min-h-[36px]" onClick={() => void switchToArc()}>Switch to Arc</button>}>
          Your wallet is not on Arc mainnet. Balances below are Arc balances.
        </Notice>
      )}

      {/* Balance: the one dominant object */}
      <section className="py-4 text-center">
        <p className="label">Total balance</p>
        <p className="mt-2 break-words font-display text-5xl font-bold tracking-[-0.04em] text-white tabular sm:text-6xl">
          {loading ? <span className="skeleton inline-block h-12 w-48 align-middle" aria-busy="true" aria-label="Loading balance" /> : <>${fmtUsd(total, USDC.decimals)}</>}
        </p>
        <div className="mt-3 inline-flex items-center gap-1 text-sm text-slate-400">
          <span className="font-mono">{shortAddr(address)}</span>
          <CopyButton value={address} label="Copy" className="!min-h-[36px] !border-0 !bg-transparent !px-2" />
        </div>
        {unpriced.length > 0 && <p className="mt-1 text-xs text-amber-200">No live price for {unpriced.map((u) => u.token.symbol).join(', ')}. Held, but not in the total.</p>}
      </section>

      {/* Four actions: Send is the primary one */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {ACTIONS.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            onClick={() => navigate(view)}
            onPointerEnter={() => prefetchView(view)}
            onTouchStart={() => prefetchView(view)}
            className={
              view === 'send'
                ? 'btn-primary !min-h-[76px] flex-col !gap-1.5 !rounded-2xl !px-1 text-xs sm:text-sm'
                : 'glass lift flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 text-xs font-semibold text-white sm:text-sm'
            }
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>

      {/* Assets */}
      <Card className="!p-2 sm:!p-3">
        <h2 className="label px-3 pb-1 pt-2">Assets</h2>
        <ul className="divide-y divide-white/5">
          {valued.map((r) => (
            <li key={r.token.address} className="flex min-h-[64px] items-center gap-3 px-3 py-2">
              <TokenIcon token={r.token} size={36} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{r.token.symbol}</p>
                <p className="truncate text-xs text-slate-400">{r.token.name}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular text-white">{r.raw === undefined ? '—' : fmtToken(r.raw, r.token.decimals, 4)}</p>
                <p className="text-xs tabular text-slate-400">
                  {prices.isLoading || r.raw === undefined ? <span className="skeleton inline-block h-3 w-14 align-middle" aria-busy="true" /> : r.value === null ? (r.raw === 0n ? '$0.00' : 'No live price') : `$${fmtUsd(r.value, USDC.decimals)}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Recent activity */}
      <Card className="!p-2 sm:!p-3">
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h2 className="label">Recent activity</h2>
          <button className="-my-2 min-h-[44px] px-1 text-sm font-medium text-[var(--a)] hover:brightness-125" onClick={() => navigate('history')}>
            View all
          </button>
        </div>
        {transfers.isLoading ? (
          <p className="flex items-center gap-2 px-3 py-6 text-sm text-slate-400"><Spinner /> Reading recent blocks…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">No activity in the recent blocks scanned. Older history is on the History page.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.slice(0, 5).map((r) => (
              <li key={r.key} className="flex min-h-[56px] items-center gap-3 px-3 py-2">
                <HistoryKindBadge kind={r.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{r.summary}</p>
                  <p className="text-xs text-slate-400">{timeAgo(r.timestamp)}</p>
                </div>
                {r.hash && <ExplorerLink href={explorerTx(r.chainId, r.hash)}>Tx</ExplorerLink>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
