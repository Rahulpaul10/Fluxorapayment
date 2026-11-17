import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { ArrowLeft, CheckCircle2, Clock, XCircle, SearchX } from 'lucide-react'
import clsx from 'clsx'
import type { Address } from 'viem'
import type { View } from '@/lib/router'
import { asChainId, explorerAddress, explorerTx, networkById, ARC_CHAIN_ID } from '@/config/networks'
import { fmtDate, fmtToken, shortAddr } from '@/lib/format'
import { gweiText, loadTxDetails, parseTxHash, type TxReader, type TxStatus } from '@/lib/txDetails'
import { nameFor, useAddressBook } from '@/lib/addressBook'
import { useOnchainDetails } from '@/lib/onchainMode'
import { Card, CopyButton, ExplorerLink, Notice, PageTitle, Row, Spinner, TokenIcon } from '@/components/ui'

const STATUS: Record<TxStatus, { label: string; tone: string; Icon: typeof Clock }> = {
  success: { label: 'Confirmed', tone: 'bg-flux-green/15 text-flux-green', Icon: CheckCircle2 },
  failed: { label: 'Failed', tone: 'bg-flux-pink/15 text-flux-pink', Icon: XCircle },
  pending: { label: 'Pending', tone: 'bg-amber-400/15 text-amber-300', Icon: Clock },
  'not-found': { label: 'Not found', tone: 'bg-slate-500/20 text-slate-300', Icon: SearchX },
}

function AddressRow({ label, address, chainId, names }: { label: string; address: Address | null | undefined; chainId: number; names: ReturnType<typeof useAddressBook> }) {
  if (!address) return <Row label={label} value="—" />
  const saved = nameFor(names, address)
  return (
    <div className="py-3">
      <p className="label">{label}</p>
      {saved && <p className="mt-1 text-sm font-semibold text-white">{saved}</p>}
      <p className="mt-1 break-all font-mono text-[13px] text-slate-200" data-testid={`tx-${label.toLowerCase()}`}>{address}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <CopyButton value={address} label="Copy" className="!min-h-[40px]" />
        <ExplorerLink href={explorerAddress(chainId, address)}>View on explorer</ExplorerLink>
      </div>
    </div>
  )
}

/** One transaction, read from the chain. Nothing here is inferred: a failed lookup shows an error with Retry. */
export function TxDetails({ hash: hashParam, chainParam, navigate }: { hash?: string | null; chainParam?: string | null; navigate: (view: View, search?: string) => void }) {
  const hash = parseTxHash(hashParam)
  const chainId = Number(chainParam ?? ARC_CHAIN_ID)
  const network = networkById(chainId)
  const client = usePublicClient({ chainId: network ? asChainId(network.id) : ARC_CHAIN_ID })
  const { address } = useAccount()
  const names = useAddressBook()
  const onchain = useOnchainDetails()

  const query = useQuery({
    queryKey: ['tx-details', chainId, hash],
    enabled: Boolean(client && hash && network),
    retry: 2,
    retryDelay: (n) => 800 * 2 ** n,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 4000 : false),
    queryFn: async () => {
      if (!client || !hash) throw new Error('no client')
      return loadTxDetails(client as unknown as TxReader, hash)
    },
  })

  const back = (
    <button className="btn-ghost" onClick={() => navigate('history')}>
      <ArrowLeft size={16} /> Back to history
    </button>
  )
  if (!hash || !network) {
    return (
      <>
        <PageTitle title="Transaction" />
        <Card className="mx-auto max-w-xl space-y-3 text-center">
          <p className="text-slate-300">{!hash ? 'That is not a valid transaction hash. A hash is 66 characters and starts with 0x.' : `Chain ${chainParam} is not a network this app supports.`}</p>
          <div className="flex justify-center">{back}</div>
        </Card>
      </>
    )
  }

  const tx = query.data
  const s = STATUS[tx?.status ?? 'pending']
  const mine = address && tx?.from && tx.from.toLowerCase() === address.toLowerCase()
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle title="Transaction" subtitle={`${network.name} · ${mine ? 'sent by you' : 'read from the network'}`} />
      {query.isLoading && (
        <Card className="space-y-3" aria-busy="true"><div className="skeleton h-6 w-32" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-2/3" /></Card>
      )}
      {query.isError && (
        <Notice tone="error" action={<button className="btn-ghost !min-h-[36px]" onClick={() => void query.refetch()}>Retry</button>}>
          Could not read this transaction from {network.name} right now ({(query.error as Error).message.split('\n')[0]}). Nothing is assumed: try again.
        </Notice>
      )}
      {tx && (
        <>
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold', s.tone)} data-testid="tx-status">
                <s.Icon size={16} /> {s.label}
              </span>
              {tx.status === 'pending' && <span className="flex items-center gap-2 text-xs text-slate-400"><Spinner /> Waiting for confirmation…</span>}
            </div>
            {tx.status === 'not-found' && <Notice tone="warn">The network has no record of this hash. It may be wrong, still propagating, or dropped.</Notice>}

            <div className="glass-inner rounded-2xl p-3.5">
              <p className="label">Transaction hash</p>
              <p className="mt-1 break-all font-mono text-[13px] text-white" data-testid="tx-hash">{hash}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyButton value={hash} label="Copy hash" className="!min-h-[40px]" />
                <ExplorerLink href={explorerTx(network.id, hash)}>View on {network.name === 'Arc' ? 'Arc ' : ''}Explorer</ExplorerLink>
              </div>
            </div>

            {tx.status !== 'not-found' && (
              <div className="divide-y divide-white/5">
                <AddressRow label="From" address={tx.from} chainId={network.id} names={names} />
                <AddressRow label="To" address={tx.to} chainId={network.id} names={names} />
                <Row label="Action" value={tx.method ?? '—'} />
                {tx.feeUsdc !== undefined && <Row label="Network fee" value={`${fmtToken(tx.feeUsdc, 6, 6)} USDC`} />}
                {tx.blockNumber !== undefined && <Row label="Block" value={<span data-testid="tx-block">{tx.blockNumber.toLocaleString()}</span>} mono />}
                {tx.timestamp !== undefined && <Row label="Time" value={`${fmtDate(tx.timestamp)} (${new Date(tx.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC)`} />}
              </div>
            )}
          </Card>

          {tx.transfers.length > 0 && (
            <Card className="space-y-2">
              <h2 className="label">Token transfers in this transaction</h2>
              <ul className="divide-y divide-white/5" data-testid="tx-transfers">
                {tx.transfers.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 py-3">
                    {t.token ? <TokenIcon token={t.token} size={32} /> : <span className="h-8 w-8 rounded-full bg-white/10" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white">{t.token ? `${fmtToken(t.amount, t.token.decimals, 6)} ${t.token.symbol}` : `${t.amount.toString()} (unknown token)`}</p>
                      <p className="break-all text-xs text-slate-400">{t.token?.name ?? t.tokenAddress} · {nameFor(names, t.from) ?? shortAddr(t.from)} → {nameFor(names, t.to) ?? shortAddr(t.to)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {onchain && tx.status !== 'not-found' && (
            <div data-testid="tx-onchain-details"><Card className="space-y-1">
              <h2 className="label">Onchain details</h2>
              <div className="divide-y divide-white/5">
                <Row label="Chain ID" value={String(network.id)} mono />
                <Row label="Nonce" value={tx.nonce === undefined ? '—' : String(tx.nonce)} mono />
                <Row label="Gas limit" value={tx.gasLimit?.toLocaleString() ?? '—'} mono />
                <Row label="Gas used" value={tx.gasUsed?.toLocaleString() ?? '—'} mono />
                <Row label="Gas price paid" value={gweiText(tx.effectiveGasPrice)} mono />
                <Row label="Native value" value={`${fmtToken(tx.nativeValue ?? 0n, 18, 6)} ${network.gas}`} />
                <Row label="RPC" value={new URL(network.rpcUrls[0]).host} mono />
              </div>
            </Card></div>
          )}
        </>
      )}
      <div className="flex justify-center">{back}</div>
    </div>
  )
}
