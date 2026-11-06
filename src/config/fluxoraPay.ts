/**
 * Your own FluxoraPay payment contract (contracts/FluxoraPay.sol).
 *
 * Set VITE_FLUXORA_PAY_ADDRESS to the address you deployed. When it is set, Send pays USDC THROUGH that contract
 * (so the transaction is addressed to your contract and it emits a `PaymentMade` event). When it is empty or not a
 * valid address, Send keeps sending a plain USDC transfer. The address is public configuration, never a secret.
 */
import { parseAbi, type Address } from 'viem'
import { envAddress } from '@/lib/env'
import { reportConfigIssue } from '@/lib/configIssues'

export const FLUXORA_PAY_ADDRESS: Address | undefined = envAddress(import.meta.env.VITE_FLUXORA_PAY_ADDRESS)

;(() => {
  const raw: unknown = import.meta.env.VITE_FLUXORA_PAY_ADDRESS
  if (typeof raw === 'string' && raw.trim() && !FLUXORA_PAY_ADDRESS) {
    reportConfigIssue('VITE_FLUXORA_PAY_ADDRESS is set but is not a valid address, so Send pays with a plain transfer.')
  }
})()

/** Only the parts the app calls. */
export const fluxoraPayAbi = parseAbi([
  'function pay(address recipient, uint256 amount, string memo) returns (uint256 id)',
  'function usdc() view returns (address)',
  'function paymentCount() view returns (uint256)',
  'event PaymentMade(uint256 indexed id, address indexed payer, address indexed recipient, uint256 amount, string memo)',
])

export const MAX_MEMO_BYTES = 140

/** Length of a note in bytes (what the contract limits), not in characters. */
export function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length
}

/**
 * Gas for `pay` when it cannot be estimated yet because the contract has no allowance (the node would revert).
 * Measured on Arc against the deployed contract with the allowance set in a simulation: 188,526 gas with no note and
 * 209,223 with an 11-byte note; each further 32-byte word of note is another storage slot. Rounded up on purpose.
 */
export function payGasFallback(memoBytes: number): bigint {
  const slots = memoBytes === 0 ? 0 : memoBytes < 32 ? 1 : 1 + Math.ceil(memoBytes / 32)
  return 195_000n + 25_000n * BigInt(slots)
}
