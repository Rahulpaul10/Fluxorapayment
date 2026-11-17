import { useAccount } from 'wagmi'
import { ArrowRight, BadgeCheck } from 'lucide-react'
import clsx from 'clsx'
import type { View } from '@/lib/router'
import { explorerTx, networkById } from '@/config/networks'
import { fmtDate, fmtToken, shortHash } from '@/lib/format'
import { networkForDomain, STATUS_LABEL, type CctpStatus, type CctpTransfer } from '@/lib/cctpHistory'
import { useCctpTransfers } from '@/hooks/useCctpTransfers'
import { useOnchainDetails } from '@/lib/onchainMode'
import { ArcGate } from '@/components/Gate'
import { Card, CopyButton, ExplorerLink, Notice, PageTitle, Spinner } from '@/components/ui'

const TONE: Record<CctpStatus, string> = {
  attesting: 'bg-amber-400/15 text-amber-300',
  'ready-to-mint': 'bg-neon/15 text-neon',
  completed: 'bg-flux-green/15 text-flux-green',
  failed: 'bg-flux-pink/15 text-flux-pink',
}

function HashLine({ label, hash, chainId, navigate }: { label: string; hash?: string; chainId?: number; navigate: (v: View, s?: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="label">{label}</span>
      {hash && chainId ? (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-xs text-slate-200" title={hash} data-testid={`cctp-${label.toLowerCase().split(' ')[0]}-hash`}>{shortHash(hash)}</span>
          <CopyButton value={hash} label="Copy" className="!min-h-[36px] !px-2.5" />
          <button className="btn-ghost !min-h-[36px] !px-2.5" onClick={() => navigate('tx', `?hash=${hash}&chain=${chainId}`)}>Details</button>
          <ExplorerLink href={explorerTx(chainId, hash)}>Explorer</ExplorerLink>
        </span>
      ) : (
        <span className="text-xs text-slate-400">Not confirmed yet</span>
      )}
    </div>
  )
}

function TransferCard({ t, navigate, onchain }: { t: CctpTransfer; navigate: (v: View, s?: string) => void; onchain: boolean }) {
  const from = networkById(t.sourceChainId)
  const to = networkForDomain(t.destinationDomain ?? -1)
  const destChain = to?.id
  return (
    <li className="glass rounded-2xl p-4" data-testid="cctp-transfer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-display text-base font-semibold text-white">
          <span className="truncate">{from?.name ?? `Domain ${t.sourceDomain}`}</span>
          <ArrowRight size={16} className="shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">{to?.name ?? (t.destinationDomain === undefined ? 'Unknown' : `Domain ${t.destinationDomain}`)}</span>
        </p>
        <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', TONE[t.status])} data-testid="cctp-status">{STATUS_LABEL[t.status]}</span>
      </div>
      <p className="mt-1 font-display text-xl font-bold text-white tabular" data-testid="cctp-amount">
        {t.amount === undefined ? '—' : `${fmtToken(t.amount, 6, 6)} USDC`}
      </p>
      {t.timestamp !== undefined && <p className="text-xs text-slate-400">{fmtDate(t.timestamp)}</p>}
      <div className="mt-2 divide-y divide-white/5">
        <HashLine label="Source transaction" hash={t.burnHash} chainId={t.sourceChainId} navigate={navigate} />
        <HashLine label="Destination transaction" hash={t.destinationTxHash} chainId={destChain} navigate={navigate} />
      </div>
      {t.status === 'completed' && (
        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-flux-green"><BadgeCheck size={14} /> Verified on {to?.name ?? 'the destination'} {t.verifiedVia === 'receipt' ? '(transaction receipt)' : '(CCTP nonce used)'}</p>
      )}
      {t.status === 'failed' && <p className="mt-1 text-xs text-flux-pink">{t.burnFailed ? 'The burn transaction reverted. Nothing was bridged.' : `Forwarding reported ${t.iris?.forwardState ?? 'a failure'}.`}</p>}
      {t.note && <p className="mt-1 text-xs text-slate-400">{t.note}</p>}
      {onchain && (
        <p className="mt-2 break-all font-mono text-[11px] text-slate-400">
          domain {t.sourceDomain} → {t.destinationDomain ?? '?'} · block {t.blockNumber?.toString() ?? '—'} · nonce {t.iris?.eventNonce ?? '—'} · Circle status {t.iris?.status ?? 'unknown'}
          {t.iris?.feeExecuted !== undefined ? ` · fee ${fmtToken(t.iris.feeExecuted, 6, 6)} USDC` : ''}
        </p>
      )}
    </li>
  )
}

/** Every CCTP transfer found for this wallet, with the status taken from Circle's attestation service and the destination chain. */
export function BridgeHistory({ navigate }: { navigate: (view: View, search?: string) => void }) {
  const { isConnected } = useAccount()
  return (
    <>
      <PageTitle
        title="Bridge history"
        subtitle="CCTP transfers from your wallet. A transfer is Completed only after the destination chain confirms it."
        right={<button className="btn-ghost" onClick={() => navigate('bridge')}>New bridge</button>}
      />
      {isConnected ? <List navigate={navigate} /> : <ArcGate feature="Bridge history"><span /></ArcGate>}
    </>
  )
}

function List({ navigate }: { navigate: (v: View, s?: string) => void }) {
  const q = useCctpTransfers()
  const onchain = useOnchainDetails()
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {q.isError && (
        <Notice tone="error" action={<button className="btn-ghost !min-h-[36px]" onClick={() => void q.refetch()}>Retry</button>}>
          Could not read bridge history right now. Nothing is assumed: try again.
        </Notice>
      )}
      {q.issues.length > 0 && <Notice tone="warn">Some block ranges could not be read, so older transfers may be missing. {q.issues[0]}</Notice>}
      {q.isLoading ? (
        <ul className="space-y-3" aria-busy="true">{[0, 1].map((i) => <li key={i} className="glass space-y-3 rounded-2xl p-4"><div className="skeleton h-5 w-48" /><div className="skeleton h-7 w-32" /><div className="skeleton h-4 w-full" /></li>)}</ul>
      ) : q.transfers.length === 0 ? (
        <Card className="space-y-2 text-center">
          <p className="font-medium text-white">No CCTP transfers found</p>
          <p className="text-sm text-slate-400">Nothing was found in the recent blocks scanned. Transfers you make with Bridge appear here, and older ones can be loaded below.</p>
        </Card>
      ) : (
        <ul className="space-y-3">{q.transfers.map((t) => <TransferCard key={t.burnHash} t={t} navigate={navigate} onchain={onchain} />)}</ul>
      )}
      <div className="flex flex-col items-center gap-2">
        <p className="text-center text-xs text-slate-500">
          Transfers that left Arc are found from the network's own events (about {q.scannedBlocks ? Math.round(Number(q.scannedBlocks) * 0.5 / 3600) : '…'} hours scanned), plus bridges made in this app from any network.
        </p>
        <button className="btn-ghost" disabled={q.isFetching} onClick={q.loadOlder}>{q.isFetching ? <><Spinner /> Scanning…</> : 'Scan older blocks'}</button>
      </div>
    </div>
  )
}
