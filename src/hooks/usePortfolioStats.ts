import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { ARC_CHAIN_ID } from '@/config/networks'
import { useHistoryRows } from '@/hooks/useHistoryRows'
import { useGasInsight } from '@/hooks/useGasInsight'
import { useCctpTransfers } from '@/hooks/useCctpTransfers'
import { useValuedBalances } from '@/hooks/useValuedBalances'
import { useTokenPrices } from '@/hooks/useBalances'
import { windowStats } from '@/lib/portfolioStats'

/**
 * Portfolio numbers, every one read from the chain. Two scopes, never mixed up:
 *  - all time: the account's transaction count (its nonce), which the network itself keeps exactly;
 *  - the scanned window: transfers and receipts found in the recent blocks this app has read.
 * Nothing is estimated or extrapolated.
 */
export function usePortfolioStats() {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const { rows, transfers } = useHistoryRows()
  const prices = useTokenPrices()
  const balances = useValuedBalances()
  const gas = useGasInsight(rows, { max: 20, lookAt: 40 })
  const cctp = useCctpTransfers()

  const nonce = useQuery({
    queryKey: ['portfolio-nonce', address],
    enabled: Boolean(client && address),
    staleTime: 20_000,
    queryFn: async () => (client && address ? client.getTransactionCount({ address }) : 0),
  })

  const win = windowStats(rows, prices.data)
  const bridged = cctp.transfers.filter((t) => t.status !== 'failed' && t.amount !== undefined)
  return {
    sentAllTime: nonce.data,
    nonceLoading: nonce.isLoading,
    window: win,
    scannedBlocks: transfers.head !== undefined && transfers.oldestScanned !== undefined ? transfers.head - transfers.oldestScanned : undefined,
    transfersLoading: transfers.isLoading,
    fees: { total: gas.total, count: gas.items.length, loading: gas.isLoading },
    bridge: {
      volume: bridged.reduce((sum, t) => sum + (t.amount ?? 0n), 0n),
      count: bridged.length,
      completed: cctp.transfers.filter((t) => t.status === 'completed').length,
      loading: cctp.isLoading,
    },
    balances,
  }
}
