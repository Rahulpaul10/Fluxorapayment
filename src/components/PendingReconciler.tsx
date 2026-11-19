import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAllActivity } from '@/lib/activity'
import { onTxSettled, watchTransaction } from '@/lib/txRegistry'
import { explorerTx } from '@/config/networks'

/**
 * Starts tracking every locally recorded pending transaction the moment it appears (and again after a reload),
 * wherever you are in the app. When one settles it refreshes balances and tells you, even if you navigated away
 * from the page that sent it. It only reads from the chain: it never sends or resends anything.
 */
const NOT_REFRESHED_ON_SETTLE = new Set(['arc-transfers', 'rpc-health', 'cctp-transfers', 'gas-insight', 'bridge-quote', 'cctp-fee-tiers', 'bridge-route', 'tx-details'])

export function PendingReconciler() {
  const all = useAllActivity()
  const queryClient = useQueryClient()

  useEffect(() => {
    for (const r of all) if (r.status === 'pending') watchTransaction(r.hash, r.chainId, r.createdAt)
  }, [all])

  useEffect(() => {
    return onTxSettled(({ hash, chainId, success }) => {
        // Refresh balances and contract reads. Not refreshed: block-range scans (expensive for the public RPC), receipts and
        // CCTP lookups (immutable or keyed by what they read), and bridge quotes/fee tiers (a settled approval must not
        // trigger a new quote in the middle of a bridge).
        void queryClient.invalidateQueries({ predicate: (q) => !NOT_REFRESHED_ON_SETTLE.has(String(q.queryKey[0])) })
        const link = explorerTx(chainId, hash)
        const action = { label: 'Explorer', onClick: () => window.open(link, '_blank', 'noopener,noreferrer') }
        if (success) toast.success('Transaction confirmed', { action })
        else toast.error('Transaction reverted onchain', { action })
      })
  }, [queryClient])

  return null
}
