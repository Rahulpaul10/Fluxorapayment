import { ArrowLeftRight, ArrowUpRight, BadgeCheck, ChevronRight, Landmark } from 'lucide-react'
import type { View } from '@/lib/router'
import { fmtToken, fmtUsd } from '@/lib/format'
import { USDC } from '@/lib/tokens'
import type { ValuedRow } from '@/hooks/useValuedBalances'
import { TokenIcon } from '@/components/ui'

/**
 * Tokens the Bridge page can move today. The page bridges USDC with Circle CCTP, so only USDC offers Bridge.
 * (Other tokens are never offered a button that would lead to a page that cannot bridge them.)
 */
export const isBridgeable = (symbol: string): boolean => symbol === 'USDC'

/** Marks a token whose contract address is part of this app's configured token list. */
export function ConfiguredBadge({ symbol }: { symbol: string }) {
  return (
    <span className="inline-flex shrink-0 text-[var(--a)]" title={`${symbol} contract address is configured in this app`} role="img" aria-label="Configured token contract">
      <BadgeCheck size={15} />
    </span>
  )
}

export function ActionChips({ symbol, navigate }: { symbol: string; navigate: (view: View, search?: string) => void }) {
  const chip = 'tap inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-200 hover:bg-white/10'
  return (
    <div className="flex gap-2">
      <button type="button" className={chip} onClick={() => navigate('send', `?token=${encodeURIComponent(symbol)}`)}>
        <ArrowUpRight size={14} /> Send
      </button>
      <button type="button" className={chip} onClick={() => navigate('swap')}>
        <ArrowLeftRight size={14} /> Swap
      </button>
      {isBridgeable(symbol) && (
        <button type="button" className={chip} onClick={() => navigate('bridge')}>
          <Landmark size={14} /> Bridge
        </button>
      )}
    </div>
  )
}

/** One asset: icon, name, symbol, balance, USD value. Tap the top part to open the asset page. */
export function AssetCard({ row, pricesLoading, navigate }: { row: ValuedRow; pricesLoading: boolean; navigate: (view: View, search?: string) => void }) {
  const { token, raw, value } = row
  return (
    <li className="glass rounded-3xl p-2" data-testid="asset-card">
      <button
        type="button"
        onClick={() => navigate('asset', `?token=${encodeURIComponent(token.symbol)}`)}
        className="tap flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/5"
        aria-label={`${token.name}, ${token.symbol}. Open details`}
      >
        <TokenIcon token={token} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-semibold text-white">
            {token.name}
            <ConfiguredBadge symbol={token.symbol} />
          </p>
          <p className="text-xs font-medium text-slate-400">{token.symbol}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular text-white">{raw === undefined ? <span className="skeleton inline-block h-4 w-16 align-middle" aria-busy="true" /> : fmtToken(raw, token.decimals, 4)}</p>
          <p className="text-xs tabular text-slate-400">
            {pricesLoading || raw === undefined ? (
              <span className="skeleton inline-block h-3 w-12 align-middle" aria-busy="true" />
            ) : value === null ? (
              raw === 0n ? '$0.00' : 'No live price'
            ) : (
              `$${fmtUsd(value, USDC.decimals)}`
            )}
          </p>
        </div>
        <ChevronRight size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
      </button>
      <div className="px-2 pb-2 pt-1">
        <ActionChips symbol={token.symbol} navigate={navigate} />
      </div>
    </li>
  )
}
