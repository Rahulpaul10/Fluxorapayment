import { IRIS_API } from '@/lib/cctpHistory'
import { rawToUsdc, usdcToRaw, type QuoteFee } from '@/lib/bridgeMath'

/**
 * Checks a bridge fee quote against Circle's own fee service before anything is allowed to be sent.
 *
 * The forwarding fee pays for minting on the destination chain (gas on Ethereum is the big part), so it moves with
 * that chain's gas price. Nothing here is a fixed fee or a fixed minimum: every number comes from a live answer, and
 * an answer that is missing, malformed, stale or inconsistent with Circle's service makes the quote unusable.
 */

/** Finality thresholds Circle's fee tiers are keyed by */
export const FINALITY = { FAST: 1000, SLOW: 2000 } as const
export type SpeedKey = keyof typeof FINALITY

/** A quote older than this is not trusted for a submission. */
export const QUOTE_MAX_AGE_MS = 60_000
/**
 * How far a quoted forwarding fee may differ from Circle's `high` tier before it is treated as stale or unexpected.
 * The kit quotes the `high` tier, and the tiers move with gas between two reads a few seconds apart. This is a
 * consistency tolerance, not a fee or a minimum amount.
 */
export const TIER_TOLERANCE_BPS = 2_500n

export interface FeeTier {
  finalityThreshold: number
  /** Protocol fee in basis points of the amount */
  minimumFeeBps: number
  /** Forwarding fee tiers in 6-decimal USDC units */
  low: bigint
  med: bigint
  high: bigint
}

export class FeeDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeeDataError'
  }
}

const isUint = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** Validate Circle's fee-tier response. Any unexpected shape throws: it is never "fixed up". */
export function parseFeeTiers(json: unknown): FeeTier[] {
  if (!Array.isArray(json) || json.length === 0) throw new FeeDataError("Circle's fee service returned no fee tiers for this route.")
  return json.map((item) => {
    const t = item as { finalityThreshold?: unknown; minimumFee?: unknown; forwardFee?: { low?: unknown; med?: unknown; high?: unknown } }
    const f = t.forwardFee
    if (!isUint(t.finalityThreshold) || !(isUint(t.minimumFee) || (typeof t.minimumFee === 'number' && t.minimumFee >= 0)) || !f || !isUint(f.low) || !isUint(f.med) || !isUint(f.high)) {
      throw new FeeDataError("Circle's fee service returned fee data in an unexpected format.")
    }
    if (!(f.low <= f.med && f.med <= f.high)) throw new FeeDataError("Circle's fee tiers are out of order (low, medium, high), so they cannot be trusted.")
    return { finalityThreshold: t.finalityThreshold, minimumFeeBps: Number(t.minimumFee), low: BigInt(f.low), med: BigInt(f.med), high: BigInt(f.high) }
  })
}

/** The official fee tiers for a route (domain ids), straight from Circle's fee service. */
export async function fetchOfficialFeeTiers(sourceDomain: number, destinationDomain: number, fetchImpl: typeof fetch = fetch): Promise<FeeTier[]> {
  if (!Number.isInteger(sourceDomain) || !Number.isInteger(destinationDomain) || sourceDomain < 0 || destinationDomain < 0) throw new FeeDataError('Invalid CCTP domain for this route.')
  let res: Response
  try {
    res = await fetchImpl(`${IRIS_API}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}?forward=true`)
  } catch {
    throw new FeeDataError("Circle's fee service could not be reached, so the fee cannot be verified.")
  }
  if (res.status === 429) throw new FeeDataError("Circle's fee service is rate limiting this connection, so the fee cannot be verified right now.")
  if (!res.ok) throw new FeeDataError(`Circle's fee service answered ${res.status}, so the fee cannot be verified.`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new FeeDataError("Circle's fee service returned an unreadable answer.")
  }
  return parseFeeTiers(json)
}

export const tierFor = (tiers: readonly FeeTier[], speed: SpeedKey): FeeTier | undefined => tiers.find((t) => t.finalityThreshold === FINALITY[speed])

/** The forwarding fee in a kit quote, in raw USDC units. undefined when the quote has none or it is not a priced USDC amount. */
export function quotedForwardingRaw(fees: readonly QuoteFee[] | undefined): bigint | undefined {
  const f = fees?.find((x) => x.type === 'forwarder')
  if (!f || f.amount === null || f.amount === undefined || (f.token !== undefined && f.token !== 'USDC')) return undefined
  return usdcToRaw(f.amount)
}

export type FeeVerdict =
  | { ok: true; tier: FeeTier; forwardingRaw: bigint }
  | { ok: false; message: string }

/** Is the kit's forwarding fee consistent with Circle's official tier for this speed? */
export function verifyForwardingFee(quoteFees: readonly QuoteFee[] | undefined, tiers: readonly FeeTier[] | undefined, speed: SpeedKey): FeeVerdict {
  if (!tiers) return { ok: false, message: "The fee could not be verified against Circle's fee service, so the bridge is paused." }
  const tier = tierFor(tiers, speed)
  if (!tier) return { ok: false, message: `Circle's fee service has no ${speed === 'FAST' ? 'fast' : 'standard'} tier for this route, so the fee cannot be verified.` }
  const forwardingRaw = quotedForwardingRaw(quoteFees)
  if (forwardingRaw === undefined) return { ok: false, message: 'The quote has no valid forwarding fee, so the bridge is paused. Try again in a moment.' }
  if (forwardingRaw <= 0n) return { ok: false, message: 'The quoted forwarding fee is zero, which Circle does not charge for forwarded transfers. The quote is treated as invalid.' }
  const diff = forwardingRaw > tier.high ? forwardingRaw - tier.high : tier.high - forwardingRaw
  if (diff * 10_000n > tier.high * TIER_TOLERANCE_BPS) {
    return {
      ok: false,
      message: `The quoted forwarding fee (${rawToUsdc(forwardingRaw)} USDC) does not match Circle's official fee service (${rawToUsdc(tier.high)} USDC). The quote is stale or unexpected, so the bridge is paused. Refresh and try again.`,
    }
  }
  return { ok: true, tier, forwardingRaw }
}

/** The clock the page reads ticks every few seconds, so it can briefly trail a quote that just arrived: a quote is only stale once it is clearly older than the limit. */
export const isFresh = (fetchedAtMs: number | undefined, nowMs = Date.now()) => fetchedAtMs !== undefined && nowMs - fetchedAtMs <= QUOTE_MAX_AGE_MS

export interface UnusualFee {
  title: string
  detail: string
}

/**
 * Explains a forwarding fee that takes a large part of the transfer. The share is a policy line for the WARNING only: it
 * never changes what is allowed, only what the person is told.
 */
export function unusualFeeWarning(amountRaw: bigint, forwardingRaw: bigint, tier: FeeTier, destinationName: string): UnusualFee | undefined {
  if (amountRaw <= 0n) return undefined
  const shareBps = (forwardingRaw * 10_000n) / amountRaw
  const spread = tier.high - tier.low
  const thin = amountRaw > forwardingRaw && amountRaw - forwardingRaw < spread
  if (shareBps < 500n && !thin) return undefined
  return {
    title: 'The fee is a large part of this transfer',
    detail:
      `Circle's forwarding fee is ${rawToUsdc(forwardingRaw)} USDC, ${Number(shareBps) / 100}% of the ${rawToUsdc(amountRaw)} USDC you are sending. It pays for minting on ${destinationName} (mostly ${destinationName} gas), so it rises when that network is busy. ` +
      `Circle currently quotes ${rawToUsdc(tier.low)} to ${rawToUsdc(tier.high)} USDC for this route, and this app uses the highest so the transfer does not stall. ` +
      (thin ? 'The amount is within that range of the fee, so a small fee rise before the burn could make it fail (nothing would be sent). ' : '') +
      'Sending a larger amount makes the fee a smaller share.',
  }
}

/** The part of the kit's chain definition used to check a route. */
export interface KitChainDef {
  chain: string
  chainId?: number
  isTestnet?: boolean
  cctp?: { domain?: number; contracts?: { v2?: { confirmations?: number; fastConfirmations?: number } } } | null
}

export interface SourceFinality {
  /** Block confirmations Circle waits for on a standard transfer */
  confirmations?: number
  /** Block confirmations for a Fast Transfer, where the source chain offers one */
  fastConfirmations?: number
}

export type RouteVerdict = { ok: true; sourceDomain: number; destinationDomain: number; finality: SourceFinality } | { ok: false; message: string }

/**
 * Both ends must be MAINNET chains whose id and CCTP domain in the kit's own chain data match what this app
 * expects. A route that disagrees with itself is refused, so a burn never goes to the wrong domain.
 */
export function verifyRoute(defs: readonly KitChainDef[], from: { kit: string; id: number; name: string }, to: { kit: string; id: number; name: string }, expected: Record<number, number>): RouteVerdict {
  const find = (kit: string) => defs.find((d) => d.chain === kit)
  const a = find(from.kit)
  const b = find(to.kit)
  if (!a || !b) return { ok: false, message: 'The bridge kit does not list one of these networks, so the route cannot be verified.' }
  if (a.isTestnet || b.isTestnet) return { ok: false, message: 'One of these networks is a testnet. This app only bridges between mainnets.' }
  if (a.chainId !== from.id || b.chainId !== to.id) return { ok: false, message: `The bridge kit's chain ids do not match ${from.name} and ${to.name}, so the route is refused.` }
  const sd = a.cctp?.domain
  const dd = b.cctp?.domain
  if (sd === undefined || dd === undefined) return { ok: false, message: 'Circle CCTP is not available on one of these networks.' }
  if (sd !== expected[from.id] || dd !== expected[to.id]) return { ok: false, message: `The CCTP domains for ${from.name} (${sd}) and ${to.name} (${dd}) do not match what this app expects (${expected[from.id]}, ${expected[to.id]}), so the route is refused.` }
  return { ok: true, sourceDomain: sd, destinationDomain: dd, finality: { confirmations: a.cctp?.contracts?.v2?.confirmations, fastConfirmations: a.cctp?.contracts?.v2?.fastConfirmations } }
}

/**
 * How long until the funds arrive, from the SOURCE chain's own finality as listed by the bridge kit (Circle's data).
 * Circle's docs: a chain that needs only a few confirmations (Arc: 1, about 0.5 s) attests in seconds even on a standard
 * transfer; chains that wait for Ethereum finality (about 65 blocks) take about 15 to 19 minutes unless a Fast Transfer is used.
 */
export function arrivalEstimate(finality: SourceFinality | undefined, speed: SpeedKey): string {
  const few = (n: number | undefined) => n !== undefined && n <= 3
  if (!finality || finality.confirmations === undefined) return 'Depends on the source network, usually a few minutes'
  if (few(finality.confirmations)) return 'Typically under a minute'
  if (speed === 'FAST' && few(finality.fastConfirmations)) return 'Typically under a minute'
  return speed === 'FAST' ? 'Typically a few minutes' : 'Typically 15 to 20 minutes'
}
