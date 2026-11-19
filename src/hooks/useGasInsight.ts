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

const READ_AT_ONCE = 4
const DEFAULT_MAX_ITEMS = 5
const DEFAULT_LOOK_AT = 12


interface ReceiptFacts {
  from: string
  costRaw: bigint
}
const receiptCache = new Map<string, ReceiptFacts>()

/** One receipt, remembered for the rest of the visit. A receipt that cannot be read yet is skipped (null), never invented. */
async function readReceipt(client: NonNullable<ReturnType<typeof usePublicClient>>, hash: Hex): Promise<ReceiptFacts | null> {
  const known = receiptCache.get(hash)
  if (known) return known
  try {
    const receipt = await client.getTransactionReceipt({ hash })
    const facts = { from: receipt.from.toLowerCase(), costRaw: arcGasCostUsdc(receipt.gasUsed, receipt.effectiveGasPrice).raw }
    receiptCache.set(hash, facts)
    return facts
  } catch {
    return null
  }
}

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
      const mine = address.toLowerCase()
      const items: GasItem[] = []
      // A few receipts at a time (they travel together in one batched request), in order, stopping once enough sent
      // transactions are found. Receipts never change, so each is read once per visit and shared by every page.
      for (let i = 0; i < candidates.length && items.length < MAX_ITEMS; i += READ_AT_ONCE) {
        const batch = candidates.slice(i, i + READ_AT_ONCE)
        const found = await Promise.all(batch.map((r) => readReceipt(client, r.hash as Hex)))
        batch.forEach((r, j) => {
          const f = found[j]
          if (f && f.from === mine && items.length < MAX_ITEMS) items.push({ hash: r.hash as Hex, kind: r.kind, timestamp: r.timestamp, costRaw: f.costRaw })
        })
      }
      return items
    },
  })
  const items = query.data ?? []
  const average = items.length ? items.reduce((s, i) => s + i.costRaw, 0n) / BigInt(items.length) : undefined
  const total = items.reduce((sum, i) => sum + i.costRaw, 0n)
  return { items, average, total, isLoading: query.isLoading && candidates.length > 0, hasCandidates: candidates.length > 0 }
}
