import type { HistoryKind, HistoryRow } from '@/hooks/useHistoryRows'

export const PAGE_SIZE = 20

export type StatusFilter = 'all' | 'pending' | 'success' | 'failed'
export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'pending', label: 'Pending' },
  { value: 'success', label: 'Confirmed' },
  { value: 'failed', label: 'Failed or not found' },
]

export type DatePreset = 'any' | '24h' | '7d' | '30d' | 'custom'
export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

export interface HistoryFilter {
  kind: 'all' | HistoryKind
  query: string
  status: StatusFilter
  preset: DatePreset
  /** yyyy-mm-dd, local time, inclusive. Used with preset "custom". */
  fromDay: string
  toDay: string
  networkName: (chainId: number) => string | undefined
  savedName: (address: string) => string | undefined
  /** Injected for tests */
  now?: number
}

/** Start of a local calendar day (yyyy-mm-dd) as unix seconds, or undefined for an invalid date. */
export function dayStart(day: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return undefined
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000)
}

export function dateBounds(f: Pick<HistoryFilter, 'preset' | 'fromDay' | 'toDay' | 'now'>): { from?: number; to?: number } {
  const now = f.now ?? Math.floor(Date.now() / 1000)
  if (f.preset === '24h') return { from: now - 86_400 }
  if (f.preset === '7d') return { from: now - 7 * 86_400 }
  if (f.preset === '30d') return { from: now - 30 * 86_400 }
  if (f.preset === 'custom') {
    const from = dayStart(f.fromDay)
    const toStart = dayStart(f.toDay)
    return { from, to: toStart === undefined ? undefined : toStart + 86_400 - 1 }
  }
  return {}
}

/** Kind, free-text search, status and date. Pure, so the same rules are tested without a browser. */
export function applyHistoryFilters(rows: readonly HistoryRow[], f: HistoryFilter): HistoryRow[] {
  const needle = f.query.trim().toLowerCase()
  const { from, to } = dateBounds(f)
  return rows.filter((r) => {
    if (f.kind !== 'all' && r.kind !== f.kind) return false
    if (f.status === 'pending' && r.status !== 'pending') return false
    if (f.status === 'success' && r.status !== 'success') return false
    if (f.status === 'failed' && r.status !== 'failed' && r.status !== 'dropped') return false
    if (from !== undefined && r.timestamp < from) return false
    if (to !== undefined && r.timestamp > to) return false
    if (!needle) return true
    return (
      r.summary.toLowerCase().includes(needle) ||
      (r.hash?.toLowerCase().includes(needle) ?? false) ||
      (f.networkName(r.chainId)?.toLowerCase().includes(needle) ?? false) ||
      r.legs.some((l) => l.counterparty.toLowerCase().includes(needle) || l.token.symbol.toLowerCase().includes(needle) || (f.savedName(l.counterparty)?.toLowerCase().includes(needle) ?? false))
    )
  })
}
