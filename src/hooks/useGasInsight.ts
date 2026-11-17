import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useAccount } from 'wagmi'
import type { Hex } from 'viem'
import { ARC_CHAIN_ID } from '@/config/networks'
import { arcGasCostUsdc } from '@/lib/fees'
import type { HistoryRow } from '@/hooks/useHistoryRows'

export interface GasItem {
  hash: Hex
  kind: HistoryRow['kind']
  timestamp: number
  /** Gas this wallet paid, in 6-decimal USDC units, from the transaction receipt (gas used x the price actually charged). */
  costRaw: bigint
}

const DEFAULT_MAX_ITEMS = 5
const DEFAULT_LOOK_AT = 12

/**
 * What recent transactions actually cost this wallet in gas, read from their receipts. Only transactions this
 * wallet sent are counted: a payment someone else sent you costs you nothing. Receipts never change, so each one is
 * read once and kept.
 */
export function useGasInsight(rows: HistoryRow[], opts: { max?: number; lookAt?: number } = {}) {
  const MAX_ITEMS = opts.max ?? DEFAULT_MAX_ITEMS
  const LOOK_AT = opts.lookAt ?? DEFAULT_LOOK_AT
  const { address } = useAccount()
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const candidates = rows.filter((r) => r.hash && r.chainId === ARC_CHAIN_ID && r.status !== 'dropped').slice(0, LOOK_AT)
  const key = candidates.map((r) => r.hash).join(',')
  const query = useQuery({
    queryKey: ['gas-insight', address, MAX_ITEMS, key],
    enabled: Boolean(client && address && candidates.length > 0),
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<GasItem[]> => {
      if (!client || !address) return []
      const items: GasItem[] = []
      for (const r of candidates) {
        if (items.length >= MAX_ITEMS) break
        try {
          const receipt = await client.getTransactionReceipt({ hash: r.hash as Hex })
          if (receipt.from.toLowerCase() !== address.toLowerCase()) continue
          items.push({ hash: receipt.transactionHash, kind: r.kind, timestamp: r.timestamp, costRaw: arcGasCostUsdc(receipt.gasUsed, receipt.effectiveGasPrice).raw })
        } catch {
          // a receipt that cannot be read yet is skipped, never invented
        }
      }
      return items
    },
  })
  const items = query.data ?? []
  const average = items.length ? items.reduce((s, i) => s + i.costRaw, 0n) / BigInt(items.length) : undefined
  const total = items.reduce((sum, i) => sum + i.costRaw, 0n)
  return { items, average, total, isLoading: query.isLoading && candidates.length > 0, hasCandidates: candidates.length > 0 }
}
