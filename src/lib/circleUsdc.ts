import { isAddress, parseAbi, parseEventLogs, type Address } from 'viem'

const erc20TransferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])

/**
 * Circle's USDC contract keeps a compliance list: an address on it cannot send or receive USDC, and the whole token
 * can be paused. A transfer that would hit either simply reverts after the wallet has already asked for a signature
 * and (on Arc) spent gas. Arc's USDC at 0x3600…0000 exposes both flags, so they are read BEFORE the wallet opens.
 * This only reads; it never overrides what the contract itself enforces.
 */
export const usdcComplianceAbi = parseAbi(['function isBlacklisted(address account) view returns (bool)', 'function paused() view returns (bool)'])

export type Compliance =
  | { status: 'clear' }
  | { status: 'blocked'; reason: 'sender' | 'recipient' | 'paused'; message: string }
  /** The reads failed: nothing is claimed either way, and the contract still enforces its own rules. */
  | { status: 'unverified' }

interface ComplianceReader {
  readContract(args: { address: Address; abi: typeof usdcComplianceAbi; functionName: 'isBlacklisted' | 'paused'; args?: readonly [Address] }): Promise<unknown>
}

/**
 * Is it possible for `sender` to send USDC to `recipient` right now? Missing parties are skipped. Any failed read makes
 * the answer "unverified", never "clear".
 */
export async function checkUsdcCompliance(client: ComplianceReader, usdc: Address, parties: { sender?: string; recipient?: string }): Promise<Compliance> {
  const read = (functionName: 'isBlacklisted' | 'paused', account?: Address) =>
    client.readContract({ address: usdc, abi: usdcComplianceAbi, functionName, ...(account ? { args: [account] as const } : {}) })
  const sender = parties.sender && isAddress(parties.sender) ? (parties.sender as Address) : undefined
  const recipient = parties.recipient && isAddress(parties.recipient) ? (parties.recipient as Address) : undefined
  try {
    const [paused, senderBlocked, recipientBlocked] = await Promise.all([read('paused'), sender ? read('isBlacklisted', sender) : false, recipient ? read('isBlacklisted', recipient) : false])
    if (paused === true) return { status: 'blocked', reason: 'paused', message: 'Circle has paused USDC transfers on Arc, so a USDC transfer would fail right now.' }
    if (senderBlocked === true) return { status: 'blocked', reason: 'sender', message: "Your wallet is on Circle's USDC blocklist, so it cannot send USDC. A transfer would fail." }
    if (recipientBlocked === true) return { status: 'blocked', reason: 'recipient', message: "This address is on Circle's USDC blocklist. USDC cannot be sent to it, so the transfer would fail." }
    return { status: 'clear' }
  } catch {
    return { status: 'unverified' }
  }
}

/* ---- delivery verification: read what the CONFIRMED transaction actually moved ---- */

export interface DeliveryExpectation {
  tokenAddress: Address
  symbol: string
  decimals: number
  to: Address
  amount: bigint
}

export type Delivery = { status: 'verified'; received: bigint } | { status: 'mismatch'; received: bigint } | { status: 'not-found' }

/**
 * Did the recipient really get the money? Reads the token's own Transfer events in the receipt of the confirmed
 * transaction. "Confirmed" only says the transaction ran; this says what it moved. Arc also logs USDC from a system
 * emitter with 18 decimals: only the token contract's own events are counted, so nothing is counted twice.
 */
export function verifyDelivery(logs: readonly { address: string; topics: readonly unknown[]; data: string }[], expect: DeliveryExpectation): Delivery {
  let received = 0n
  let seen = false
  for (const log of logs) {
    if (log.address.toLowerCase() !== expect.tokenAddress.toLowerCase()) continue
    try {
      const parsed = parseEventLogs({ abi: erc20TransferAbi, eventName: 'Transfer', logs: [log as never] })
      for (const p of parsed) {
        if (p.args.to.toLowerCase() === expect.to.toLowerCase()) {
          received += p.args.value
          seen = true
        }
      }
    } catch {
      // not a Transfer event
    }
  }
  if (!seen) return { status: 'not-found' }
  return received === expect.amount ? { status: 'verified', received } : { status: 'mismatch', received }
}
