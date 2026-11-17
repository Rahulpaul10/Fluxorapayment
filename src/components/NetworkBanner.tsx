import { useArcWallet } from '@/hooks/useWallet'
import { ARC_CHAIN_ID, NETWORKS } from '@/config/networks'
import { Notice, Spinner } from '@/components/ui'

/**
 * Shown on every page while the wallet is on a network this app does not support. It never switches networks by
 * itself: the person decides. Transactions are separately blocked until the wallet's live chain matches (see txLifecycle).
 */
export function NetworkBanner() {
  const { unsupportedChain, chainId, switchToArc, switching } = useArcWallet()
  if (!unsupportedChain) return null
  return (
    <div className="mb-4" role="alert" data-testid="network-banner">
      <Notice
        tone="error"
        action={
          <button className="btn-primary !min-h-[44px] shrink-0" onClick={() => void switchToArc()} disabled={switching}>
            {switching ? <><Spinner /> Switching…</> : 'Switch to Arc'}
          </button>
        }
      >
        <p className="font-semibold">Unsupported network</p>
        <p className="mt-0.5 text-sm">
          Your wallet is on chain {chainId}, which FLUXORA does not support. Nothing will be sent from here. Switch your wallet to Arc (chain {ARC_CHAIN_ID}).
        </p>
        <p className="mt-1 text-xs opacity-80">Supported networks: {NETWORKS.map((n) => n.name).join(', ')}. Bridging can start from any of them; Send, Swap and Pay run on Arc.</p>
      </Notice>
    </div>
  )
}
