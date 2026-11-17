import { useMemo, useState } from 'react'
import type { View } from '@/lib/router'
import { nameFor, useAddressBook } from '@/lib/addressBook'
import { applyHistoryFilters, DATE_PRESETS, PAGE_SIZE, STATUS_FILTERS, type DatePreset, type StatusFilter } from '@/lib/historyFilters'
import { Search } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useHistoryRows, type HistoryKind } from '@/hooks/useHistoryRows'
import { fmtDate, shortHash } from '@/lib/format'
import { explorerTx, networkById } from '@/config/networks'
import { ArcGate } from '@/components/Gate'
import { HistoryKindBadge, kindLabel } from '@/components/HistoryKindBadge'
import { Card, CopyButton, ExplorerLink, Notice, PageTitle, Spinner } from '@/components/ui'
import clsx from 'clsx'

const FILTERS: { value: 'all' | HistoryKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'send', label: 'Send' },
  { value: 'receive', label: 'Receive' },
  { value: 'swap', label: 'Swap' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'payment', label: 'Payments' },
]

export function History({ navigate }: { navigate: (view: View, search?: string) => void }) {
  const { isConnected } = useAccount()
  return (
    <>
      <PageTitle title="History" subtitle="Real transfers read from Arc, labelled with what you did in FLUXORA." />
      {isConnected ? <HistoryList navigate={navigate} /> : <ArcGate feature="History"><span /></ArcGate>}
    </>
  )
}

function groupByDay<T extends { timestamp: number }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const day = new Date(item.timestamp * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    map.set(day, [...(map.get(day) ?? []), item])
  }
  return [...map.entries()]
}

function HistoryList({ navigate }: { navigate: (view: View, search?: string) => void }) {
  const { rows, transfers } = useHistoryRows()
  const book = useAddressBook()
  const [filter, setFilter] = useState<'all' | HistoryKind>('all')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [preset, setPreset] = useState<DatePreset>('any')
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(
    () => applyHistoryFilters(rows, { kind: filter, query: q, status, preset, fromDay, toDay, networkName: (id) => networkById(id)?.name, savedName: (a) => nameFor(book, a) }),
    [rows, filter, q, status, preset, fromDay, toDay, book],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const reset = () => setPage(0)

  const scanned = transfers.head !== undefined && transfers.oldestScanned !== undefined ? transfers.head - transfers.oldestScanned : undefined

  return (
    <div className="space-y-4">
      <Card className="space-y-3 !p-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-slate-500" />
          <input className="field pl-10" placeholder="Search hash, address, token or network" value={q} onChange={(e) => { setQ(e.target.value); reset() }} aria-label="Search history" />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setFilter(f.value); reset() }}
              className={clsx('min-h-[40px] rounded-xl px-4 text-sm font-semibold transition', filter === f.value ? 'theme-chip shadow-glow' : 'bg-white/5 text-slate-300 hover:bg-white/10')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-400">
            Status
            <select className="field mt-1" value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); reset() }} aria-label="Filter by status">
              {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-400">
            Date
            <select className="field mt-1" value={preset} onChange={(e) => { setPreset(e.target.value as DatePreset); reset() }} aria-label="Filter by date">
              {DATE_PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <label className="block text-xs font-medium text-slate-400">From<input type="date" className="field mt-1" value={fromDay} max={toDay || undefined} onChange={(e) => { setFromDay(e.target.value); reset() }} aria-label="From date" /></label>
              <label className="block text-xs font-medium text-slate-400">To<input type="date" className="field mt-1" value={toDay} min={fromDay || undefined} onChange={(e) => { setToDay(e.target.value); reset() }} aria-label="To date" /></label>
            </>
          )}
        </div>
      </Card>

      {transfers.isError && (
        <Notice tone="warn" action={<button className="btn-ghost !min-h-[36px]" onClick={() => void transfers.refetch()}>Retry</button>}>
          Could not read onchain history right now. Transactions made in FLUXORA are still listed below.
        </Notice>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          ['Matching', filtered.length, 'text-white'],
          ['Received', filtered.filter((r) => r.kind === 'receive').length, 'text-flux-green'],
          ['Sent', filtered.filter((r) => r.kind === 'send').length, 'text-flux-pink'],
        ].map(([label, n, tone]) => (
          <Card key={label as string} className="!p-4 text-center">
            <p className="label">{label}</p>
            <p className={clsx('mt-1 font-display text-2xl font-bold tabular', tone as string)}>{n}</p>
          </Card>
        ))}
      </div>

      {transfers.isLoading ? (
        <Card><p className="flex items-center gap-2 p-4 text-sm text-slate-400"><Spinner /> Reading recent Arc blocks…</p></Card>
      ) : shown.length === 0 ? (
        <Card><p className="p-6 text-center text-sm text-slate-400">{rows.length === 0 ? 'No transactions found in the blocks scanned so far.' : 'No transactions match these filters. Try clearing the search, status or date.'}</p></Card>
      ) : (
        groupByDay(shown).map(([day, items]) => (
          <section key={day} className="space-y-2">
            <h2 className="label px-1">{day}</h2>
            <ul className="space-y-2">
              {items.map((r) => (
                <li key={r.key} className="lift glass flex flex-wrap items-center gap-3 rounded-2xl px-3.5 py-3 sm:flex-nowrap">
                  <HistoryKindBadge kind={r.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{r.summary}</p>
                    <p className="text-xs text-slate-400">
                      {kindLabel(r.kind)} · {networkById(r.chainId)?.name ?? `Chain ${r.chainId}`} · {fmtDate(r.timestamp)}
                      {r.note ? ` · ${r.note}` : ''}
                    </p>
                    {r.hash && <p className="mt-0.5 font-mono text-xs text-slate-500">{shortHash(r.hash)}</p>}
                  </div>
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-xs font-semibold',
                      r.status === 'success' && 'bg-flux-green/15 text-flux-green',
                      r.status === 'pending' && 'bg-amber-400/15 text-amber-300',
                      r.status === 'failed' && 'bg-flux-pink/15 text-flux-pink',
                      r.status === 'dropped' && 'bg-slate-500/20 text-slate-300',
                    )}
                    title={r.status === 'dropped' ? 'The network never recorded this transaction. Check the explorer.' : undefined}
                  >
                    {r.status === 'success' ? 'Confirmed' : r.status === 'pending' ? 'Pending' : r.status === 'failed' ? 'Reverted' : 'Not found'}
                  </span>
                  <div className="flex items-center gap-2">
                    {r.hash && <button className="btn-ghost !min-h-[44px] !px-3" onClick={() => navigate('tx', `?hash=${r.hash}&chain=${r.chainId}`)}>Details</button>}
                    {r.hash && <CopyButton value={r.hash} label="Hash" className="!min-h-[44px] !px-3" />}
                    {r.hash && <ExplorerLink href={explorerTx(r.chainId, r.hash)}>Explorer</ExplorerLink>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="History pages">
          <button className="btn-ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <p className="text-sm text-slate-400" data-testid="history-page">Page {current + 1} of {pages}</p>
          <button className="btn-ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </nav>
      )}

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-slate-500">
          {scanned !== undefined ? `Scanned about ${Number(scanned).toLocaleString()} recent blocks (≈ ${(Number(scanned) * 0.5 / 3600).toFixed(1)} hours). ` : ''}
          Arc history is read directly from the network in small ranges.
        </p>
        {transfers.hasMore && (
          <button className="btn-ghost" disabled={transfers.loadingMore} onClick={() => void transfers.loadMore()}>
            {transfers.loadingMore ? <><Spinner /> Scanning older blocks…</> : 'Load older transactions'}
          </button>
        )}
      </div>
    </div>
  )
}
