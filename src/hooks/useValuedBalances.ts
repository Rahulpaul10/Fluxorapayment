import { useMemo } from 'react'
import { useTokenBalances, useTokenPrices, type BalanceRow } from '@/hooks/useBalances'

export interface ValuedRow extends BalanceRow {
  /** Value in 6-decimal USDC units. null when no live price exists: the value is unknown and never guessed. */
  value: bigint | null
}

/** Real balances priced with real Uniswap quotes (see useBalances). One place, shared by the dashboard and the asset page. */
export function useValuedBalances() {
  const balances = useTokenBalances()
  const prices = useTokenPrices()
  const rows: ValuedRow[] = useMemo(
    () =>
      balances.rows.map((r) => {
        const price = prices.data?.[r.token.symbol]
        const value = r.raw === undefined || price === undefined || price === null ? null : (r.raw * price) / 10n ** BigInt(r.token.decimals)
        return { ...r, value }
      }),
    [balances.rows, prices.data],
  )
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0n), 0n)
  const unpriced = rows.filter((r) => r.raw !== undefined && r.raw > 0n && r.value === null)
  return { rows, total, unpriced, loading: balances.isLoading || prices.isLoading, pricesLoading: prices.isLoading, refetch: balances.refetch }
}
