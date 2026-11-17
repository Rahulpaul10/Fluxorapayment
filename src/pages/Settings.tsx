import { useQuery } from '@tanstack/react-query'
import { getAddress, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { ARC_CHAIN_ID, explorerAddress } from '@/config/networks'
import { FLUXORA_PAY_ADDRESS, fluxoraPayAbi } from '@/config/fluxoraPay'
import { USDC } from '@/lib/tokens'
import type { View } from '@/lib/router'
import { NETWORKS } from '@/config/networks'
import { ARC_TOKENS } from '@/lib/tokens'
import { ARC_TOKEN_MESSENGER, MESSAGE_TRANSMITTER_V2, CCTP_DOMAINS } from '@/lib/cctpHistory'
import { setOnchainDetails, useOnchainDetails } from '@/lib/onchainMode'
import { formatGwei } from 'viem'
import { AddressBookManager } from '@/components/AddressBookParts'
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

export function Settings({ navigate }: { navigate: (view: View, search?: string) => void }) {
  const onchainMode = useOnchainDetails()
  const arcClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const gasPrice = useQuery({ queryKey: ['settings-gas-price'], enabled: Boolean(arcClient) && onchainMode, staleTime: 15_000, queryFn: async () => (arcClient ? arcClient.getGasPrice() : 0n) })
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

        <Card className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-white">Address book</h2>
          <p className="text-sm text-slate-400">Save trusted wallet addresses with a name, then pick them when you send.</p>
          <AddressBookManager />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">Onchain details</h2>
              <p className="text-sm text-slate-400">Show contract addresses, chain IDs, gas and block information across the app.</p>
            </div>
            <button
              role="switch"
              aria-checked={onchainMode}
              aria-label="Onchain details"
              className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${onchainMode ? 'bg-[var(--a)]' : 'bg-white/20'}`}
              onClick={() => setOnchainDetails(!onchainMode)}
              data-testid="onchain-toggle"
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-[#ffffff] transition-all ${onchainMode ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          {onchainMode && (
            <div className="space-y-4" data-testid="onchain-panel">
              <div className="divide-y divide-white/5">
                <Row label="Gas price (Arc)" value={gasPrice.data === undefined ? '…' : `${Number(formatGwei(gasPrice.data)).toLocaleString(undefined, { maximumFractionDigits: 3 })} gwei`} mono />
                <Row label="Gas token" value="USDC (18 decimals natively, 6 as a token)" />
              </div>
              <div>
                <p className="label">Networks</p>
                <ul className="mt-1 divide-y divide-white/5">
                  {NETWORKS.map((n) => (
                    <li key={n.id} className="py-2 text-xs text-slate-300">
                      <span className="font-semibold text-white">{n.name}</span> · chain {n.id} · CCTP domain {CCTP_DOMAINS[n.id] ?? '—'} · RPC {new URL(n.rpcUrls[0]).host}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="label">Contracts on Arc</p>
                <ul className="mt-1 divide-y divide-white/5">
                  {[...ARC_TOKENS.map((t) => [t.symbol, t.address] as const), ['CCTP TokenMessenger', ARC_TOKEN_MESSENGER] as const, ['CCTP MessageTransmitter', MESSAGE_TRANSMITTER_V2] as const, ...(address ? ([['FluxoraPay', address]] as const) : [])].map(([label, addr]) => (
                    <li key={label} className="py-2">
                      <p className="text-xs font-semibold text-white">{label}</p>
                      <p className="break-all font-mono text-[11px] text-slate-300">{addr}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-slate-500">Transaction hashes and block numbers appear on each transaction's details page while this is on.</p>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <button className="glass lift rounded-2xl p-4 text-left" onClick={() => navigate('analytics')}>
            <p className="font-display font-semibold text-white">Analytics</p>
            <p className="text-xs text-slate-400">Portfolio numbers</p>
          </button>
          <button className="glass lift rounded-2xl p-4 text-left" onClick={() => navigate('bridges')}>
            <p className="font-display font-semibold text-white">Bridge history</p>
            <p className="text-xs text-slate-400">CCTP transfers</p>
          </button>
        </div>
      </div>
    </>
  )
}
