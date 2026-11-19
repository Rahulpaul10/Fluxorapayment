import { useQuery } from '@tanstack/react-query'
import { isAddress } from 'viem'
import { usePublicClient } from 'wagmi'
import { ARC_CHAIN_ID } from '@/config/networks'
import { USDC } from '@/lib/tokens'
import { checkUsdcCompliance, type Compliance } from '@/lib/circleUsdc'

/**
 * Reads Circle's USDC compliance flags on Arc for a sender and a recipient. Disabled until there is a real address to check.
 * `blocked` is only ever true when the contract itself says so.
 */
export function useUsdcCompliance(parties: { sender?: string; recipient?: string }, enabled = true) {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const recipient = parties.recipient && isAddress(parties.recipient) ? parties.recipient.toLowerCase() : undefined
  const sender = parties.sender && isAddress(parties.sender) ? parties.sender.toLowerCase() : undefined
  const query = useQuery<Compliance>({
    queryKey: ['usdc-compliance', sender, recipient],
    enabled: Boolean(client && enabled && (recipient || sender)),
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => (client ? checkUsdcCompliance(client, USDC.address, { sender, recipient }) : { status: 'unverified' }),
  })
  const verdict = query.data
  return { verdict, blocked: verdict?.status === 'blocked' ? verdict : undefined, loading: query.isLoading }
}
