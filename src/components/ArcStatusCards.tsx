import clsx from 'clsx'
import { Fuel, Radio } from 'lucide-react'
import { useRpcHealth, type RpcStatus } from '@/hooks/useRpcHealth'
import { useGasInsight } from '@/hooks/useGasInsight'
import type { HistoryRow } from '@/hooks/useHistoryRows'
import { fmtGasUsdc } from '@/lib/fees'
import { Amount } from '@/onchain-money'
import { kindLabel } from '@/components/HistoryKindBadge'
import { timeAgo } from '@/lib/format'

const STATUS: Record<RpcStatus, { dot: string; label: string }> = {
  checking: { dot: 'bg-slate-400', label: 'Connecting' },
  online: { dot: 'bg-flux-green', label: 'Online' },
  degraded: { dot: 'bg-amber-300', label: 'Slow' },
  offline: { dot: 'bg-flux-pink', label: 'Unreachable' },
  'wrong-chain': { dot: 'bg-flux-pink', label: 'Wrong chain' },
}

/** Arc Mainnet, its real status and block, and the gas token. All of it is read from the network. */
export function ArcNetworkCard() {
  const h = useRpcHealth()
  const s = STATUS[h.status]
  return (
    <section className="glass rounded-3xl p-4" aria-label="Arc Network">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Radio size={16} className="text-[var(--a)]" /> Arc Network
        </h2>
        <span className="pill" role="status" aria-label={`Arc network ${s.label}`}>
          <span className={clsx('relative h-2 w-2 rounded-full', s.dot, h.status === 'online' && 'dot-live')} />
          {s.label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="glass-inner min-w-0 rounded-2xl p-3">
          <dt className="label !text-[10px]">Network</dt>
          <dd className="mt-1 truncate font-semibold text-white">Arc Mainnet</dd>
        </div>
        <div className="glass-inner min-w-0 rounded-2xl p-3">
          <dt className="label !text-[10px]">Block</dt>
          <dd className="mt-1 truncate font-semibold tabular text-white" data-testid="arc-block">
            {h.block !== undefined ? h.block.toLocaleString() : <span className="skeleton inline-block h-4 w-16 align-middle" aria-busy="true" />}
          </dd>
        </div>
        <div className="glass-inner min-w-0 rounded-2xl p-3">
          <dt className="label !text-[10px]">Gas token</dt>
          <dd className="mt-1 font-semibold text-white">USDC</dd>
        </div>
      </dl>
    </section>
  )
}

/** Gas the wallet actually paid for its recent transactions, from their receipts, in USDC. */
export function GasInsight({ rows }: { rows: HistoryRow[] }) {
  const g = useGasInsight(rows)
  return (
    <section className="glass rounded-3xl p-4" aria-label="Gas Insight">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Fuel size={16} className="text-[var(--a)]" /> Gas Insight
        </h2>
        {g.average !== undefined && (
          <span className="text-xs text-slate-400 tabular">
            avg {fmtGasUsdc(Amount.fromRaw(g.average, 6))} USDC
          </span>
        )}
      </div>
      {g.isLoading ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <div className="skeleton h-6" />
          <div className="skeleton h-6" />
        </div>
      ) : g.items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          {g.hasCandidates ? 'No recent transactions sent from this wallet.' : 'Gas you pay will show here after your first transaction on Arc.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-white/5">
          {g.items.map((i) => (
            <li key={i.hash} className="flex min-h-[40px] items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-300">
                {kindLabel(i.kind)} <span className="text-slate-400">· {timeAgo(i.timestamp)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular text-white">{fmtGasUsdc(Amount.fromRaw(i.costRaw, 6))} USDC</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-400">Paid in USDC. Read from each transaction receipt.</p>
    </section>
  )
}
