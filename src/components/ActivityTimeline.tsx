import clsx from 'clsx'
import { ARC_CHAIN_ID, explorerTx } from '@/config/networks'
import { timeAgo, fmtDate } from '@/lib/format'
import type { HistoryRow } from '@/hooks/useHistoryRows'
import { toTimelineEntry, type TimelineEntry, type TimelineStatus } from '@/lib/activityView'
import { HistoryKindBadge } from '@/components/HistoryKindBadge'
import { ExplorerLink, Spinner } from '@/components/ui'

const STATUS_STYLE: Record<TimelineStatus, string> = {
  Pending: 'bg-amber-300/15 text-amber-300',
  Confirmed: 'bg-flux-green/15 text-flux-green',
  Failed: 'bg-flux-pink/15 text-flux-pink',
}

function Item({ row, entry, last, onOpenTx }: { row: HistoryRow; entry: TimelineEntry; last: boolean; onOpenTx?: (hash: string, chainId: number) => void }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0" data-testid="timeline-item">
      {!last && <span className="absolute left-5 top-11 -ml-px h-[calc(100%-2.75rem)] w-px bg-white/10" aria-hidden="true" />}
      <HistoryKindBadge kind={row.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 truncate text-sm font-semibold text-white">
            {entry.type}
            {entry.token && <span className="font-medium text-slate-400"> · {entry.token}</span>}
          </p>
          {entry.amount && (
            <p className={clsx('shrink-0 text-sm font-semibold tabular', entry.direction === 'in' ? 'text-flux-green' : 'text-white')}>{entry.amount}</p>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-400" title={entry.summary}>
          {entry.summary}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', STATUS_STYLE[entry.status])} title={entry.statusNote}>
            {entry.status === 'Pending' && <Spinner className="!h-3 !w-3" />}
            {entry.status}
          </span>
          <time className="text-slate-400" dateTime={new Date(entry.timestamp * 1000).toISOString()} title={fmtDate(entry.timestamp)}>
            {timeAgo(entry.timestamp)}
          </time>
          {entry.shortHash && <span className="font-mono text-slate-400">{entry.shortHash}</span>}
        </div>
        {entry.hash && (
          <div className="-mb-3 mt-0.5 flex flex-wrap items-center gap-x-4">
            {onOpenTx && (
              <button className="min-h-[44px] text-sm font-medium text-[var(--a)] hover:brightness-125" onClick={() => onOpenTx(entry.hash as string, entry.chainId)}>
                Details
              </button>
            )}
            <ExplorerLink href={explorerTx(entry.chainId, entry.hash)}>{entry.chainId === ARC_CHAIN_ID ? 'View on Arc Explorer' : 'View on explorer'}</ExplorerLink>
          </div>
        )}
      </div>
    </li>
  )
}

/** The real activity list as an onchain timeline. Nothing is added to it: no rows means an empty state. */
export function ActivityTimeline({
  rows,
  loading,
  limit,
  empty,
  onOpenTx,
}: {
  rows: HistoryRow[]
  loading: boolean
  limit?: number
  empty: string
  onOpenTx?: (hash: string, chainId: number) => void
}) {
  if (loading) {
    return (
      <div className="space-y-4 px-1 py-2" aria-busy="true" aria-label="Loading activity">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton h-10 w-10 shrink-0 !rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (rows.length === 0) return <p className="px-2 py-6 text-center text-sm text-slate-400">{empty}</p>
  const shown = limit ? rows.slice(0, limit) : rows
  return (
    <ol className="px-1 py-2">
      {shown.map((r, i) => (
        <Item key={r.key} row={r} entry={toTimelineEntry(r)} last={i === shown.length - 1} onOpenTx={onOpenTx} />
      ))}
    </ol>
  )
}
