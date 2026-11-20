import clsx from 'clsx'
import { ExternalLink, Radio } from 'lucide-react'
import { useRpcHealth, type RpcStatus } from '@/hooks/useRpcHealth'
import { ARC_CHAIN_ID, HOME_NETWORK } from '@/config/networks'
import { ARC_CONTENT } from '@/content/arcContent'
import { CopyButton } from '@/components/ui'
import { SourceTag } from './SourceTag'

const STATUS: Record<RpcStatus, { dot: string; label: string }> = {
  checking: { dot: 'bg-slate-400', label: 'Checking' },
  online: { dot: 'bg-flux-green', label: 'Online' },
  degraded: { dot: 'bg-amber-300', label: 'Slow' },
  offline: { dot: 'bg-flux-pink', label: 'Unreachable' },
  'wrong-chain': { dot: 'bg-flux-pink', label: 'Wrong chain' },
}

/** The public endpoint Arc's documentation lists for mainnet (https://docs.arc.io/arc/references/rpc-endpoints). */
export const OFFICIAL_MAINNET_RPC = 'https://rpc.mainnet.arc.io'

function Item({ label, tag, children, testId }: { label: string; tag: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="glass-inner min-w-0 rounded-2xl p-3.5">
      <div className="flex items-center justify-between gap-2">
        <dt className="label !text-[10px]">{label}</dt>
        {tag}
      </div>
      <dd className="mt-1.5 min-w-0 break-words font-semibold text-white" data-testid={testId}>{children}</dd>
    </div>
  )
}

export function NetworkInfo() {
  const h = useRpcHealth()
  const s = STATUS[h.status]
  const idOk = h.servedChain === ARC_CHAIN_ID
  return (
    <section id="network" aria-labelledby="net-h" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="net-h" className="flex items-center gap-2 font-display text-xl font-bold tracking-[-0.02em] text-white"><Radio size={18} className="text-[var(--a)]" /> Arc network</h2>
        <span className="pill" role="status" aria-label={`Arc network ${s.label}`}>
          <span className={clsx('relative h-2 w-2 rounded-full', s.dot, h.status === 'online' && 'dot-live')} /> {s.label}
        </span>
      </div>
      <dl className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Network" tag={<SourceTag kind="config" />}>Arc Mainnet</Item>
        <Item label="Chain ID" tag={<SourceTag kind="live" />} testId="explore-chain-id">
          {ARC_CHAIN_ID}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {h.servedChain === undefined ? 'checking the RPC…' : idOk ? 'the RPC reports the same chain' : `the RPC reports ${h.servedChain}`}
          </span>
        </Item>
        <Item label="Current block" tag={<SourceTag kind="live" />} testId="explore-block">
          {h.block !== undefined ? h.block.toLocaleString() : <span className="skeleton inline-block h-5 w-24 align-middle" aria-busy="true" />}
        </Item>
        <Item label="Gas token" tag={<SourceTag kind="config" />}>USDC<span className="ml-2 text-xs font-normal text-slate-400">6 decimals as a token, 18 as native gas</span></Item>
        <Item label="RPC used by this app" tag={<SourceTag kind="live" />}>
          <span className="break-all font-mono text-sm">{h.host || '—'}</span>
          <span className="ml-2 text-xs font-normal text-slate-400">{h.latency !== undefined ? `${h.latency} ms` : ''}{h.custom ? ' · custom endpoint' : ''}</span>
        </Item>
        <Item label="Arc's public RPC" tag={<SourceTag kind="snapshot" retrievedAt={ARC_CONTENT.retrievedAt} source="docs.arc.io" />}>
          <span className="inline-flex max-w-full items-center gap-1.5"><span className="break-all font-mono text-sm">{OFFICIAL_MAINNET_RPC}</span><CopyButton value={OFFICIAL_MAINNET_RPC} label="Copy RPC URL" /></span>
        </Item>
      </dl>
      <div className="flex flex-wrap gap-2">
        <a href={HOME_NETWORK.explorerUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost !min-h-[44px] gap-1.5 text-sm"><ExternalLink size={15} aria-hidden="true" /> Arc Explorer</a>
        {ARC_CONTENT.docs.network.slice(0, 3).map((d) => (
          <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="btn-ghost !min-h-[44px] gap-1.5 text-sm"><ExternalLink size={15} aria-hidden="true" /> {d.title}</a>
        ))}
      </div>
    </section>
  )
}
