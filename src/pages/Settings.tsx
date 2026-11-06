import { useQuery } from '@tanstack/react-query'
import { getAddress, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { ARC_CHAIN_ID, explorerAddress } from '@/config/networks'
import { FLUXORA_PAY_ADDRESS, fluxoraPayAbi } from '@/config/fluxoraPay'
import { USDC } from '@/lib/tokens'
import { Card, CopyButton, ExplorerLink, Notice, PageTitle, Row, Spinner } from '@/components/ui'

/** The contract name shown to people. It is the Solidity contract in contracts/FluxoraPay.sol. */
const CONTRACT_NAME = 'FluxoraPay'

/** What the chain says about the configured contract. Read live: nothing here is assumed. */
function useFluxoraPayOnchain(address: Address | undefined) {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  return useQuery({
    queryKey: ['settings-fluxorapay', address],
    enabled: Boolean(client && address),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client || !address) throw new Error('no client')
      const code = await client.getCode({ address })
      if (!code || code === '0x') return { deployed: false as const }
      const [token, count] = await Promise.all([
        client.readContract({ address, abi: fluxoraPayAbi, functionName: 'usdc' }),
        client.readContract({ address, abi: fluxoraPayAbi, functionName: 'paymentCount' }),
      ])
      return { deployed: true as const, token: getAddress(token), count }
    },
  })
}

export function Settings() {
  const address = FLUXORA_PAY_ADDRESS
  const chain = useFluxoraPayOnchain(address)
  const onchain = chain.data
  const tokenOk = onchain?.deployed ? onchain.token.toLowerCase() === USDC.address.toLowerCase() : undefined

  return (
    <>
      <PageTitle title="Settings" subtitle="The contracts this app uses, read live from Arc mainnet." />
      <div className="mx-auto max-w-xl space-y-5">
        <Card className="space-y-4">
          <div>
            <p className="label">Payment contract</p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-[-0.02em] text-white">{CONTRACT_NAME}</h2>
            <p className="mt-1 text-pretty text-sm text-slate-400">
              Your own contract. When it is set, USDC you send from the Send page is paid through it, so the transaction is addressed to this contract and shows its payment event.
            </p>
          </div>

          {address ? (
            <>
              <div className="glass-inner rounded-2xl p-3.5">
                <p className="label">Contract address</p>
                <p className="mt-1.5 break-all font-mono text-[13px] text-white" data-testid="fluxorapay-address">
                  {address}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CopyButton value={address} label="Copy address" className="!min-h-[44px]" />
                  <ExplorerLink href={explorerAddress(ARC_CHAIN_ID, address)}>View on explorer</ExplorerLink>
                </div>
              </div>

              <div className="divide-y divide-white/5">
                <Row label="Network" value="Arc mainnet (chain 5042)" />
                <Row
                  label="Status"
                  value={
                    chain.isLoading ? (
                      <Spinner />
                    ) : chain.isError ? (
                      'Could not read the contract'
                    ) : onchain?.deployed ? (
                      <span className="inline-flex items-center gap-1.5 text-flux-green">
                        <CheckCircle2 size={15} /> Live onchain
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-flux-pink">
                        <CircleAlert size={15} /> No contract at this address
                      </span>
                    )
                  }
                />
                {onchain?.deployed && (
                  <>
                    <Row label="Pays in" value={`${USDC.symbol} (${tokenOk ? 'matches the app' : 'differs from the app'})`} />
                    <Row label="Token contract" value={onchain.token} mono />
                    <Row label="Payments made through it" value={onchain.count.toString()} />
                  </>
                )}
              </div>

              {onchain?.deployed && tokenOk === false && (
                <Notice tone="warn">This contract pays a different token than the USDC this app uses. Check the address before sending.</Notice>
              )}
              {onchain && !onchain.deployed && (
                <Notice tone="error">No contract code exists at this address on Arc mainnet, so a payment through it would fail. Check VITE_FLUXORA_PAY_ADDRESS.</Notice>
              )}
              {chain.isError && <Notice tone="warn">The network did not answer. The address above is what the app is set to use; try again in a moment.</Notice>}
            </>
          ) : (
            <Notice tone="info">
              No payment contract is set, so Send makes a plain USDC transfer. To use your own, set <span className="font-mono">VITE_FLUXORA_PAY_ADDRESS</span> to its Arc mainnet address and restart the app.
            </Notice>
          )}
        </Card>
      </div>
    </>
  )
}
