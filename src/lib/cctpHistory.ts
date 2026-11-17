import { getAddress, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from 'viem'
import { ARC_CHAIN_ID, NETWORKS, networkById } from '@/config/networks'

/**
 * CCTP transfer history built ONLY from things that can be checked:
 *  - burns: DepositForBurn events emitted by Arc's TokenMessengerV2 for this wallet, plus burns this app recorded;
 *  - attestation: Circle's own message API (Iris), looked up by the burn transaction hash;
 *  - arrival: the destination transaction's receipt, or the destination MessageTransmitter's usedNonces flag.
 * A transfer is "completed" only after one of those two destination checks passes.
 */

/** Circle CCTP domain ids for the networks this app can bridge between. */
export const CCTP_DOMAINS: Record<number, number> = { 1: 0, 43114: 1, 10: 2, 42161: 3, 8453: 6, 137: 7, 5042: 26 }
const DOMAIN_TO_CHAIN = new Map(Object.entries(CCTP_DOMAINS).map(([chain, domain]) => [domain, Number(chain)]))
export const chainForDomain = (domain: number) => DOMAIN_TO_CHAIN.get(domain)
export const networkForDomain = (domain: number) => networkById(chainForDomain(domain))

/** CCTP V2 contracts on Arc and the MessageTransmitterV2 address shared by the EVM V2 deployments. */
export const ARC_TOKEN_MESSENGER = getAddress('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d')
export const MESSAGE_TRANSMITTER_V2 = getAddress('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64')
export const IRIS_API = 'https://iris-api.circle.com'

export const depositForBurnEvent = parseAbiItem(
  'event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)',
)
const transmitterAbi = parseAbi(['function usedNonces(bytes32 nonce) view returns (uint256)'])

export type CctpStatus = 'attesting' | 'ready-to-mint' | 'completed' | 'failed'

export interface IrisMessage {
  status: string
  eventNonce?: string
  attestationReady: boolean
  destinationDomain?: number
  sourceDomain?: number
  amount?: bigint
  feeExecuted?: bigint
  mintRecipient?: string
  forwardState?: string | null
  destinationTxHash?: Hex
  delayReason?: string | null
}

export interface CctpTransfer {
  /** Source (burn) transaction */
  burnHash: Hex
  sourceChainId: number
  sourceDomain: number
  destinationDomain?: number
  amount?: bigint
  blockNumber?: bigint
  timestamp?: number
  origin: 'onchain' | 'app'
  /** The burn receipt said the transaction reverted (only possible for app-recorded transfers) */
  burnFailed?: boolean
  iris?: IrisMessage | null
  /** The destination was checked and confirms the mint */
  destinationVerified: boolean
  destinationTxHash?: Hex
  verifiedVia?: 'receipt' | 'nonce'
  /** Why a status could not be fully determined, shown to the user instead of guessing */
  note?: string
  status: CctpStatus
}

const hex = (v: unknown): Hex | undefined => (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : undefined)
const big = (v: unknown): bigint | undefined => {
  try {
    return typeof v === 'string' || typeof v === 'number' ? BigInt(v) : undefined
  } catch {
    return undefined
  }
}

/** Normalise one message object from Circle's API. Unknown shapes become "not ready" rather than an error. */
export function parseIrisMessage(raw: unknown): IrisMessage | null {
  const m = raw as Record<string, unknown> | null
  if (!m || typeof m !== 'object') return null
  const decoded = (m.decodedMessage ?? {}) as Record<string, unknown>
  const body = (decoded.decodedMessageBody ?? {}) as Record<string, unknown>
  const attestation = typeof m.attestation === 'string' ? m.attestation : ''
  return {
    status: String(m.status ?? 'unknown'),
    eventNonce: typeof m.eventNonce === 'string' ? m.eventNonce : undefined,
    attestationReady: m.status === 'complete' && /^0x[0-9a-fA-F]{20,}$/.test(attestation),
    destinationDomain: decoded.destinationDomain === undefined ? undefined : Number(decoded.destinationDomain),
    sourceDomain: decoded.sourceDomain === undefined ? undefined : Number(decoded.sourceDomain),
    amount: big(body.amount),
    feeExecuted: big(body.feeExecuted),
    mintRecipient: typeof body.mintRecipient === 'string' ? body.mintRecipient : undefined,
    forwardState: typeof m.forwardState === 'string' ? m.forwardState : null,
    destinationTxHash: hex(m.destinationMintTxHash) ?? hex(m.forwardTxHash),
    delayReason: typeof m.delayReason === 'string' ? m.delayReason : null,
  }
}

/** Look a burn up in Circle's API. 404 means "not indexed yet" (null). Other failures throw, so callers can show them. */
export async function fetchIris(sourceDomain: number, burnHash: Hex, fetchImpl: typeof fetch = fetch): Promise<IrisMessage | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnHash)}`)
    if (res.status === 404) return null
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt))
      continue
    }
    if (!res.ok) throw new Error(`Circle's message service answered ${res.status}`)
    const json = (await res.json()) as { messages?: unknown[] }
    return parseIrisMessage(json.messages?.[0])
  }
  throw new Error("Circle's message service is rate limiting this connection")
}

export interface DestinationCheck {
  verified: boolean
  via?: 'receipt' | 'nonce'
  txHash?: Hex
  /** Set when the check could not be performed (no RPC for that network, RPC error) */
  note?: string
}

type DestinationClient = Pick<PublicClient, 'getTransactionReceipt' | 'readContract'>

/**
 * Verify arrival on the destination chain. Prefer the destination transaction's own receipt (it must have
 * succeeded); otherwise ask the destination MessageTransmitter whether this message nonce is used.
 */
export async function verifyDestination(client: DestinationClient | undefined, iris: IrisMessage): Promise<DestinationCheck> {
  if (!client) return { verified: false, note: "The destination network is not configured here, so arrival can't be verified from this app." }
  try {
    if (iris.destinationTxHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: iris.destinationTxHash })
        if (receipt.status === 'success') return { verified: true, via: 'receipt', txHash: iris.destinationTxHash }
        return { verified: false, txHash: iris.destinationTxHash, note: 'The destination transaction reverted.' }
      } catch {
        // not found yet: fall through to the nonce check
      }
    }
    if (iris.attestationReady && iris.eventNonce && /^0x[0-9a-fA-F]{64}$/.test(iris.eventNonce)) {
      const used = (await client.readContract({ address: MESSAGE_TRANSMITTER_V2, abi: transmitterAbi, functionName: 'usedNonces', args: [iris.eventNonce as Hex] })) as bigint
      if (used > 0n) return { verified: true, via: 'nonce', txHash: iris.destinationTxHash }
    }
    return { verified: false }
  } catch {
    return { verified: false, note: 'The destination network could not be reached, so arrival is unconfirmed.' }
  }
}

/** The one place a transfer status is decided. "completed" requires a passed destination check. */
export function deriveStatus(input: { burnFailed?: boolean; iris?: IrisMessage | null; destinationVerified: boolean }): CctpStatus {
  if (input.burnFailed) return 'failed'
  const iris = input.iris
  if (iris?.forwardState === 'FAILED') return 'failed'
  if (input.destinationVerified) return 'completed'
  if (iris?.attestationReady) return 'ready-to-mint'
  return 'attesting'
}

export const STATUS_LABEL: Record<CctpStatus, string> = {
  attesting: 'Waiting for attestation',
  'ready-to-mint': 'Attested, mint not confirmed',
  completed: 'Completed',
  failed: 'Failed',
}

/** Arc burns by this wallet in [fromBlock, toBlock], read from the TokenMessenger's own events. */
export async function discoverArcBurns(client: Pick<PublicClient, 'getLogs'>, depositor: Address, fromBlock: bigint, toBlock: bigint) {
  const logs = await client.getLogs({ address: ARC_TOKEN_MESSENGER, event: depositForBurnEvent, args: { depositor }, fromBlock, toBlock })
  return logs.map((l) => ({
    burnHash: l.transactionHash as Hex,
    blockNumber: l.blockNumber,
    amount: l.args.amount,
    destinationDomain: l.args.destinationDomain === undefined ? undefined : Number(l.args.destinationDomain),
  }))
}

export const supportedDomains = () => NETWORKS.map((n) => CCTP_DOMAINS[n.id]).filter((d) => d !== undefined)
export { ARC_CHAIN_ID }
