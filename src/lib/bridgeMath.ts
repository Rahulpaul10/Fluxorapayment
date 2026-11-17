/**
 * What a bridge transfer delivers, worked out in exact 6-decimal USDC units (never floating point).
 *
 * Circle's forwarding fee is taken out of the amount that is burned: the burn passes it as `maxFee`, and the CCTP
 * TokenMessenger refuses any burn where `maxFee >= amount` ("Max fee must be less than amount"). So a transfer is only
 * possible when the amount is strictly larger than the fee, and the estimated receive is the amount minus that fee.
 * The minimum is exactly that: the live quoted fee plus one unit. No fixed margin is added here; the quote is re-checked
 * right before the burn and the fee tiers are checked against Circle's own fee service (see cctpFees).
 */
const DECIMALS = 6
const UNIT = 10n ** BigInt(DECIMALS)

export interface QuoteFee {
  type?: string
  token?: string
  amount?: string | null
}

export type ReceiveCheck =
  | { ok: true; feeRaw: bigint; receiveRaw: bigint; minRaw: bigint }
  | { ok: false; reason: 'no-amount' | 'fee-unknown' | 'fee-covers-amount'; feeRaw?: bigint; minRaw?: bigint }

/** "1.118159" -> 1118159n. More than 6 decimals rounds UP, so a fee is never understated. Anything else is undefined. */
export function usdcToRaw(value: string): bigint | undefined {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!m) return undefined
  const frac = m[2] ?? ''
  const kept = frac.slice(0, DECIMALS).padEnd(DECIMALS, '0')
  const roundUp = /[1-9]/.test(frac.slice(DECIMALS)) ? 1n : 0n
  return BigInt(m[1]) * UNIT + BigInt(kept) + roundUp
}

export function rawToUsdc(raw: bigint): string {
  const whole = raw / UNIT
  const frac = (raw % UNIT).toString().padStart(DECIMALS, '0')
  return `${whole}.${frac}`
}

/**
 * Can this amount be bridged, and what arrives? Only USDC fees come out of the burned amount. A fee the quote could
 * not price (null amount) makes the whole quote unusable: nothing is guessed.
 */
export function checkReceive(amountRaw: bigint | undefined, fees: readonly QuoteFee[] | undefined): ReceiveCheck {
  if (amountRaw === undefined || amountRaw <= 0n) return { ok: false, reason: 'no-amount' }
  if (!fees) return { ok: false, reason: 'fee-unknown' }
  let feeRaw = 0n
  for (const f of fees) {
    if (f.amount === null || f.amount === undefined) return { ok: false, reason: 'fee-unknown' }
    if (f.token !== undefined && f.token !== 'USDC') continue // paid in another token, not taken from the burned USDC
    const raw = usdcToRaw(f.amount)
    if (raw === undefined) return { ok: false, reason: 'fee-unknown' }
    feeRaw += raw
  }
  // The burn is accepted only when the amount is larger than the fee: the smallest amount is one unit above it.
  const minRaw = feeRaw + 1n
  if (amountRaw <= feeRaw) return { ok: false, reason: 'fee-covers-amount', feeRaw, minRaw }
  return { ok: true, feeRaw, receiveRaw: amountRaw - feeRaw, minRaw }
}

/** The gas on the source chain that is paid in USDC, in 6-decimal units, or undefined when any part of the estimate is missing. */
export function gasUsdcRaw(gasFees: ReadonlyArray<{ token?: string; fees?: { fee?: string } | null }> | undefined): bigint | undefined {
  if (!gasFees || gasFees.length === 0) return undefined
  let total = 0n
  for (const g of gasFees) {
    const fee = g.fees?.fee
    if (fee === undefined || fee === null) return undefined
    if (g.token !== 'USDC') continue
    const raw = usdcToRaw(fee)
    if (raw === undefined) return undefined
    total += raw
  }
  return total
}

/** One line for the gas the transactions on the source chain will cost, e.g. "0.017063 USDC". Gas in other tokens is listed separately, never converted. */
export function networkFeeSummary(gasFees: ReadonlyArray<{ token?: string; fees?: { fee?: string } | null }> | undefined): string | undefined {
  if (!gasFees || gasFees.length === 0) return undefined
  let usdc = 0n
  const other = new Map<string, number>()
  for (const g of gasFees) {
    const fee = g.fees?.fee
    if (fee === undefined || fee === null) return undefined // a part of the estimate failed: say nothing rather than a partial total
    if (g.token === 'USDC') {
      const raw = usdcToRaw(fee)
      if (raw === undefined) return undefined
      usdc += raw
    } else if (g.token) {
      other.set(g.token, (other.get(g.token) ?? 0) + Number(fee))
    }
  }
  const parts: string[] = []
  if (usdc > 0n) parts.push(`${rawToUsdc(usdc)} USDC`)
  for (const [token, sum] of other) parts.push(`${Number(sum.toFixed(8))} ${token}`)
  return parts.length ? parts.join(' + ') : undefined
}
