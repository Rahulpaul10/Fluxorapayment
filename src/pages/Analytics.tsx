import { useAccount } from 'wagmi'
import type { View } from '@/lib/router'
import { fmtToken, fmtUsd } from '@/lib/format'
import { shareBps } from '@/lib/portfolioStats'
import { usePortfolioStats } from '@/hooks/usePortfolioStats'
import { ArcGate } from '@/components/Gate'
import { Card, PageTitle, TokenIcon } from '@/components/ui'

function Stat({ label, value, hint, loading, testId }: { label: string; value: string; hint: string; loading?: boolean; testId: string }) {
  return (
    <Card className="!p-4">
      <p className="label">{label}</p>
      {loading ? <div className="skeleton mt-2 h-7 w-24" aria-busy="true" /> : <p className="mt-1 break-words font-display text-2xl font-bold text-white tabular" data-testid={testId}>{value}</p>}
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </Card>
  )
}

/** Portfolio numbers, each labelled with exactly where it comes from. */
export function Analytics({ navigate }: { navigate: (view: View, search?: string) => void }) {
  const { isConnected } = useAccount()
  return (
    <>
      <PageTitle title="Portfolio & analytics" subtitle="Numbers read from Arc for your wallet. Each card says what it covers." />
      {isConnected ? <Body navigate={navigate} /> : <ArcGate feature="Analytics"><span /></ArcGate>}
    </>
  )
}

function Body({ navigate }: { navigate: (v: View, s?: string) => void }) {
  const s = usePortfolioStats()
  const hours = s.scannedBlocks === undefined ? undefined : (Number(s.scannedBlocks) * 0.5) / 3600
  const windowText = hours === undefined ? 'the recent blocks read so far' : `the last ~${hours.toFixed(1)} hours of blocks read`
  const { rows, total } = s.balances
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat testId="stat-sent-all" label="Transactions sent" value={s.sentAllTime === undefined ? '—' : s.sentAllTime.toLocaleString()} hint="All time, from your account's nonce" loading={s.nonceLoading} />
        <Stat testId="stat-window-count" label="Confirmed activity" value={s.window.count.toLocaleString()} hint={`Transfers in ${windowText}`} loading={s.transfersLoading} />
        <Stat testId="stat-volume" label="Transfer volume" value={fmtUsd(s.window.volume, 6)} hint={`Sent and received, in ${windowText}${s.window.unpricedLegs ? ` (${s.window.unpricedLegs} without a live price excluded)` : ''}`} loading={s.transfersLoading} />
        <Stat testId="stat-fees" label="Network fees paid" value={`${fmtToken(s.fees.total, 6, 6)} USDC`} hint={`Across your last ${s.fees.count} sent transaction${s.fees.count === 1 ? '' : 's'}, from receipts`} loading={s.fees.loading} />
        <Stat testId="stat-bridge" label="Bridge volume" value={`${fmtToken(s.bridge.volume, 6, 4)} USDC`} hint={`${s.bridge.count} CCTP transfer${s.bridge.count === 1 ? '' : 's'} found, ${s.bridge.completed} completed`} loading={s.bridge.loading} />
        <button className="glass lift rounded-3xl p-4 text-left" onClick={() => navigate('bridges')}>
          <p className="label">Bridge history</p>
          <p className="mt-1 font-display text-lg font-bold text-white">View transfers</p>
          <p className="mt-1 text-xs text-slate-400">Source and destination transactions</p>
        </button>
      </div>

      <Card className="space-y-3">
        <h2 className="label">Token overview</h2>
        <ul className="space-y-3" data-testid="token-overview">
          {rows.map((r) => {
            const bps = shareBps(r.value, total)
            return (
              <li key={r.token.address} className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <TokenIcon token={r.token} size={28} />
                  <span className="min-w-0 flex-1 truncate font-medium text-white">{r.token.symbol}</span>
                  <span className="text-sm tabular text-slate-200">{r.raw === undefined ? '…' : fmtToken(r.raw, r.token.decimals, 4)}</span>
                  <span className="w-20 text-right text-sm tabular text-slate-400">{r.value === null ? 'No live price' : fmtUsd(r.value, 6)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="presentation">
                  <div className="h-full rounded-full bg-[var(--a)]" style={{ width: `${bps === null ? 0 : Math.max(bps / 100, bps > 0 ? 1 : 0)}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-slate-500">Values use live Uniswap quotes on Arc. A token without a live price is shown as such and left out of totals.</p>
      </Card>

      <p className="text-center text-xs text-slate-500">Everything here is read from the network. Totals marked "recent" cover only the blocks scanned, not your whole history.</p>
    </div>
  )
}
