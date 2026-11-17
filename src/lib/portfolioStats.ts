import type { HistoryRow } from '@/hooks/useHistoryRows'

export interface WindowStats {
  /** Confirmed transactions in the scanned window */
  count: number
  /** Value moved, in 6-decimal USD units, using live prices only */
  volume: bigint
  /** Legs that could not be valued because no live price exists. They are excluded, never guessed. */
  unpricedLegs: number
}

/**
 * Totals over the rows this app has actually read. A swap moves one value (what went out), so only its outgoing leg is
 * counted; sends and receipts count their own leg. Pending, failed and dropped transactions are not counted.
 */
export function windowStats(rows: readonly HistoryRow[], prices: Record<string, bigint | null> | undefined): WindowStats {
  let count = 0
  let volume = 0n
  let unpricedLegs = 0
  for (const r of rows) {
    if (r.status !== 'success') continue
    count++
    const legs = r.kind === 'swap' ? r.legs.filter((l) => l.direction === 'out') : r.legs
    for (const l of legs) {
      const price = prices?.[l.token.symbol]
      if (price === undefined || price === null) {
        unpricedLegs++
        continue
      }
      volume += (l.amount * price) / 10n ** BigInt(l.token.decimals)
    }
  }
  return { count, volume, unpricedLegs }
}

/** A token's share of the total, in basis points, from valued balances. null when the total is zero. */
export function shareBps(value: bigint | null, total: bigint): number | null {
  if (value === null || total <= 0n) return null
  return Number((value * 10_000n) / total)
}
