import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ArrowLeft } from 'lucide-react'
import type { View } from '@/lib/router'
import { ARC_CHAIN_ID, explorerAddress } from '@/config/networks'
import { fmtToken, fmtUsd } from '@/lib/format'
import { tokenBySymbol, USDC } from '@/lib/tokens'
import { useValuedBalances } from '@/hooks/useValuedBalances'
import { useHistoryRows } from '@/hooks/useHistoryRows'
import { rowsForToken } from '@/lib/activityView'
import { ActionChips, ConfiguredBadge } from '@/components/AssetCard'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { Card, CopyButton, ExplorerLink, PageTitle, TokenIcon } from '@/components/ui'

/** One token: balance, value, its real contract address, and the activity that moved it. */
export function Asset({ symbol, navigate }: { symbol?: string; navigate: (view: View, search?: string) => void }) {
  const { isConnected } = useAccount()
  const { rows: assets, pricesLoading } = useValuedBalances()
  const { rows, transfers } = useHistoryRows()
  const token = symbol ? tokenBySymbol(symbol) : undefined
  const row = token ? assets.find((a) => a.token.address === token.address) : undefined

  if (!token || !row) {
    return (
      <>
        <PageTitle title="Asset" />
        <Card className="mx-auto max-w-xl space-y-3 py-10 text-center">
          <p className="text-slate-300">{symbol ? `“${symbol}” is not one of the tokens this app supports on Arc.` : 'Choose an asset from your dashboard.'}</p>
          <button className="btn-primary mx-auto" onClick={() => navigate('dashboard')}>
            <ArrowLeft size={16} /> Back to dashboard
          </button>
        </Card>
      </>
    )
  }

  const { raw, value } = row
  const own = rowsForToken(rows, token.symbol)
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="surface-hero soft-glow rounded-3xl p-5 text-center" aria-label={`${token.name} balance`}>
        <div className="mx-auto flex w-fit items-center gap-3">
          <TokenIcon token={token} size={44} />
          <div className="text-left">
            <h1 className="flex items-center gap-1.5 font-display text-xl font-bold text-white">
              {token.name}
              <ConfiguredBadge symbol={token.symbol} />
            </h1>
            <p className="text-sm font-medium text-slate-400">{token.symbol} on Arc</p>
          </div>
        </div>
        {!isConnected ? (
          <div className="mt-5">
            <ConnectKitButton.Custom>{({ show }) => <button className="btn-primary" onClick={show}>Connect wallet</button>}</ConnectKitButton.Custom>
          </div>
        ) : (
          <>
            <p className="mt-5 break-words font-display text-4xl font-bold tracking-[-0.03em] text-white tabular" data-testid="asset-balance">
              {raw === undefined ? <span className="skeleton inline-block h-10 w-40 align-middle" aria-busy="true" /> : `${fmtToken(raw, token.decimals, 6)} ${token.symbol}`}
            </p>
            <p className="mt-1 text-sm tabular text-slate-400" data-testid="asset-value">
              {pricesLoading || raw === undefined ? (
                <span className="skeleton inline-block h-4 w-20 align-middle" aria-busy="true" />
              ) : value === null ? (
                raw === 0n ? '$0.00' : 'No live price'
              ) : (
                `$${fmtUsd(value, USDC.decimals)}`
              )}
            </p>
            <div className="mt-4">
              <ActionChips symbol={token.symbol} navigate={navigate} />
            </div>
          </>
        )}
      </section>

      <Card className="space-y-3 !p-4">
        <h2 className="label">Contract</h2>
        <p className="break-all font-mono text-[13px] text-slate-200" data-testid="asset-contract">
          {token.address}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton value={token.address} label="Copy address" />
          <ExplorerLink href={explorerAddress(ARC_CHAIN_ID, token.address)}>View on Arc Explorer</ExplorerLink>
        </div>
        <p className="text-xs text-slate-400">
          {token.decimals} decimals. {token.symbol === 'USDC' ? 'USDC is also the gas token on Arc; the balance above is its 6-decimal token view.' : 'The address is part of this app’s configured token list.'}
        </p>
      </Card>

      <Card className="!p-3 sm:!p-4">
        <h2 className="label px-1 pb-1">Recent {token.symbol} activity</h2>
        <ActivityTimeline rows={own} loading={transfers.isLoading} limit={8} onOpenTx={(hash, chainId) => navigate('tx', `?hash=${hash}&chain=${chainId}`)} empty={`No ${token.symbol} activity in the recent blocks scanned. Older history is on the History page.`} />
      </Card>
    </div>
  )
}
