import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import type { Hex } from 'viem'
import { config } from '@/config/wallet'
import { ARC_CHAIN_ID, asChainId } from '@/config/networks'
import { useActivityLog } from '@/lib/activity'
import {
  CCTP_DOMAINS,
  chainForDomain,
  deriveStatus,
  discoverArcBurns,
  fetchIris,
  verifyDestination,
  type CctpTransfer,
  type IrisMessage,
} from '@/lib/cctpHistory'

const CHUNK = 5000n
const STEP_BLOCKS = 15_000n
const MAX_TRANSFERS = 25

async function inPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/**
 * Real CCTP transfers for the connected wallet: burns found on Arc, plus burns this app recorded on any chain,
 * each checked against Circle's message API and the destination chain. See lib/cctpHistory for the status rules.
 */
export function useCctpTransfers() {
  const { address } = useAccount()
  const arc = usePublicClient({ chainId: ARC_CHAIN_ID })
  const recorded = useActivityLog(address).filter((r) => r.kind === 'bridge')
  const [span, setSpan] = useState(STEP_BLOCKS)
  const recordedKey = recorded.map((r) => `${r.chainId}:${r.hash}`).join(',')

  const query = useQuery({
    queryKey: ['cctp-transfers', address, span.toString(), recordedKey],
    enabled: Boolean(arc && address),
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<{ transfers: CctpTransfer[]; scannedBlocks: bigint; issues: string[] }> => {
      if (!arc || !address) return { transfers: [], scannedBlocks: 0n, issues: [] }
      const issues: string[] = []
      const head = await arc.getBlockNumber()
      const found = new Map<string, CctpTransfer>()

      for (let to = head; to > head - span && to > 0n; to -= CHUNK) {
        const from = to - CHUNK + 1n > 0n ? to - CHUNK + 1n : 0n
        try {
          for (const b of await discoverArcBurns(arc, address, from, to)) {
            found.set(b.burnHash.toLowerCase(), {
              burnHash: b.burnHash,
              sourceChainId: ARC_CHAIN_ID,
              sourceDomain: CCTP_DOMAINS[ARC_CHAIN_ID],
              destinationDomain: b.destinationDomain,
              amount: b.amount,
              blockNumber: b.blockNumber,
              origin: 'onchain',
              destinationVerified: false,
              status: 'attesting',
            })
          }
        } catch {
          issues.push(`Blocks ${from.toLocaleString()} to ${to.toLocaleString()} could not be read.`)
        }
        // Arc's RPC caps a log query at 5,000 blocks. Space the requests so a scan never bursts into the rate limit.
        await new Promise((r) => setTimeout(r, 200))
      }
      for (const r of recorded) {
        const domain = CCTP_DOMAINS[r.chainId]
        if (domain === undefined || found.has(r.hash.toLowerCase())) continue
        found.set(r.hash.toLowerCase(), { burnHash: r.hash, sourceChainId: r.chainId, sourceDomain: domain, origin: 'app', timestamp: r.createdAt, destinationVerified: false, status: 'attesting' })
      }

      const list = [...found.values()]
        .sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)) || (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, MAX_TRANSFERS)

      const checked = await inPool(list, 3, async (t): Promise<CctpTransfer> => {
        const next: CctpTransfer = { ...t }
        const source = getPublicClient(config, { chainId: asChainId(t.sourceChainId) })
        try {
          if (t.blockNumber !== undefined && source && !t.timestamp) next.timestamp = Number((await source.getBlock({ blockNumber: t.blockNumber })).timestamp)
        } catch {
          /* the block time is optional */
        }
        if (t.origin === 'app' && source) {
          try {
            next.burnFailed = (await source.getTransactionReceipt({ hash: t.burnHash as Hex })).status === 'reverted'
          } catch {
            /* still pending or unreadable: not marked failed */
          }
        }
        if (next.burnFailed) return { ...next, status: 'failed' }
        let iris: IrisMessage | null = null
        try {
          iris = await fetchIris(t.sourceDomain, t.burnHash as Hex)
        } catch (e) {
          next.note = (e as Error).message
        }
        next.iris = iris
        next.amount = next.amount ?? iris?.amount
        next.destinationDomain = next.destinationDomain ?? iris?.destinationDomain
        if (iris && next.destinationDomain !== undefined) {
          const destChain = chainForDomain(next.destinationDomain)
          const dest = destChain ? getPublicClient(config, { chainId: asChainId(destChain) }) : undefined
          const check = await verifyDestination(dest, iris)
          next.destinationVerified = check.verified
          next.destinationTxHash = check.txHash ?? iris.destinationTxHash
          next.verifiedVia = check.via
          if (check.note) next.note = check.note
        }
        next.status = deriveStatus({ burnFailed: next.burnFailed, iris, destinationVerified: next.destinationVerified })
        return next
      })
      return { transfers: checked, scannedBlocks: span, issues }
    },
  })

  const loadOlder = useCallback(() => setSpan((w) => w + STEP_BLOCKS), [setSpan])
  return { ...query, transfers: query.data?.transfers ?? [], scannedBlocks: query.data?.scannedBlocks, issues: query.data?.issues ?? [], loadOlder }
}
