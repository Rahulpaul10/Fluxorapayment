/**
 * The Arc to Ethereum CCTP quote flow, checked against Circle's own services. READ ONLY: it asks for quotes and fee
 * tiers, and never signs or sends anything. The wallet used for the quote is a throwaway key made in memory (it holds
 * nothing) and is never printed.
 *
 * Run: bun run test:cctp-fees
 */
import { generatePrivateKey } from 'viem/accounts'
import { usdcToRaw, rawToUsdc, checkReceive, gasUsdcRaw } from '../src/lib/bridgeMath'
import { FeeDataError, fetchOfficialFeeTiers, isFresh, parseFeeTiers, quotedForwardingRaw, tierFor, unusualFeeWarning, verifyForwardingFee, verifyRoute, type KitChainDef } from '../src/lib/cctpFees'
import { CCTP_DOMAINS } from '../src/lib/cctpHistory'
import { getUsdc } from '../src/onchain-facts'

let pass = 0
let fail = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) } else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const throws = async (fn: () => unknown) => { try { await fn() } catch { return true } return false }

console.log('Fee tier parsing and verification (fixtures shaped like the real API)')
const good = [{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 764_805, med: 987_672, high: 1_210_539 } }, { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 764_805, med: 987_672, high: 1_210_539 } }]
const tiers = parseFeeTiers(good)
check(tiers.length === 2 && tiers[0].high === 1_210_539n && tiers[0].low === 764_805n, 'a valid answer parses to exact raw units')
check(await throws(() => parseFeeTiers([])) && await throws(() => parseFeeTiers('x')) && await throws(() => parseFeeTiers([{ finalityThreshold: 1000 }])), 'empty, non-array or incomplete answers are refused')
check(await throws(() => parseFeeTiers([{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 5, med: 3, high: 9 } }])), 'tiers that are out of order are refused')
check(await throws(() => parseFeeTiers([{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: -1, med: 1, high: 2 } }])) && await throws(() => parseFeeTiers([{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 1.5, med: 2, high: 3 } }])), 'negative or fractional raw fees are refused')
const quote = (amount: string | null, type = 'forwarder') => [{ type, token: 'USDC', amount }]
check(verifyForwardingFee(quote('1.208146'), tiers, 'FAST').ok, 'the UI figure 1.208146 is consistent with the official high tier 1.210539')
check(!verifyForwardingFee(quote('9.5'), tiers, 'FAST').ok && !verifyForwardingFee(quote('0.1'), tiers, 'FAST').ok, 'a quote far from the official tier is refused as stale or unexpected')
check(!verifyForwardingFee(quote(null), tiers, 'FAST').ok && !verifyForwardingFee(quote('0'), tiers, 'FAST').ok && !verifyForwardingFee([], tiers, 'FAST').ok && !verifyForwardingFee(undefined, tiers, 'FAST').ok, 'a missing, null or zero forwarding fee is refused')
check(!verifyForwardingFee(quote('1.2'), undefined, 'FAST').ok, 'with no official tiers the fee cannot be verified')
check(!verifyForwardingFee(quote('1.2'), [tiers[1]], 'FAST').ok, 'a missing speed tier cannot be verified')
check(quotedForwardingRaw(quote('1.208146')) === 1_208_146n && quotedForwardingRaw([{ type: 'forwarder', token: 'ETH', amount: '1' }]) === undefined, 'the quoted fee is read as exact raw USDC units; a non-USDC fee is not treated as USDC')
check(isFresh(1_000, 1_000 + 59_000) && !isFresh(1_000, 1_000 + 61_000) && !isFresh(undefined) && isFresh(5_000, 1_000), 'quote age: fresh under a minute (a slightly trailing page clock still counts as fresh), stale after, missing is not fresh')

console.log('Validation uses the live quote (the case from the UI: 0.001 USDC, fee 1.208146)')
const fees = quote('1.208146')
const tiny = checkReceive(usdcToRaw('0.001'), fees)
check(!tiny.ok && tiny.reason === 'fee-covers-amount' && tiny.minRaw === 1_208_147n, '0.001 USDC is refused; the minimum is the quoted fee + 0.000001 = 1.208147', rawToUsdc(1_208_147n))
check(checkReceive(usdcToRaw('1.208147'), fees).ok && !checkReceive(usdcToRaw('1.208146'), fees).ok, 'the boundary is exact: one unit above the fee works, equal does not')
const ten = checkReceive(usdcToRaw('10'), fees)
check(ten.ok && ten.receiveRaw === 8_791_854n, '10 USDC delivers 8.791854 USDC (10 - 1.208146)')
check(gasUsdcRaw([{ token: 'USDC', fees: { fee: '0.0039375' } }, { token: 'USDC', fees: { fee: '0.013125' } }]) === 17_063n, 'network fee 0.003938 + 0.013125 = 0.017063 (parts round up, so a fee is never understated)')
const warn = unusualFeeWarning(usdcToRaw('1.5') as bigint, 1_208_146n, tiers[0], 'Ethereum')
check(Boolean(warn && warn.detail.includes('1.208146') && warn.detail.includes('0.764805') && warn.detail.includes('1.210539')), 'an unusually high fee is explained with the real tier range')
check(unusualFeeWarning(usdcToRaw('1000') as bigint, 1_208_146n, tiers[0], 'Ethereum') === undefined, 'a small fee share on a large transfer raises no warning')

console.log('Route: domains and chains')
const defs: KitChainDef[] = [{ chain: 'Arc', chainId: 5042, isTestnet: false, cctp: { domain: 26 } }, { chain: 'Ethereum', chainId: 1, isTestnet: false, cctp: { domain: 0 } }, { chain: 'Arc_Testnet', chainId: 5042002, isTestnet: true, cctp: { domain: 26 } }]
const arc = { kit: 'Arc', id: 5042, name: 'Arc' }
const eth = { kit: 'Ethereum', id: 1, name: 'Ethereum' }
check(verifyRoute(defs, arc, eth, CCTP_DOMAINS).ok, 'Arc (26) to Ethereum (0) verifies')
check(!verifyRoute(defs, arc, { kit: 'Arc_Testnet', id: 5042002, name: 'Arc Testnet' }, { ...CCTP_DOMAINS, 5042002: 26 }).ok, 'a testnet end is refused')
check(!verifyRoute([{ ...defs[0], cctp: { domain: 9 } }, defs[1]], arc, eth, CCTP_DOMAINS).ok, 'a domain that disagrees with the expected one is refused')
check(!verifyRoute([{ ...defs[0], chainId: 1 }, defs[1]], arc, eth, CCTP_DOMAINS).ok && !verifyRoute([defs[1]], arc, eth, CCTP_DOMAINS).ok, 'a wrong chain id or a missing chain is refused')

console.log('Live: Circle fee service and the bridge kit (read only)')
let officialHigh: bigint | undefined
try {
  const official = await fetchOfficialFeeTiers(26, 0)
  const fast = tierFor(official, 'FAST')
  check(Boolean(fast && fast.high >= fast.med && fast.med >= fast.low && fast.high > 0n), 'the official Arc to Ethereum fee tiers are valid', fast ? `low ${rawToUsdc(fast.low)} med ${rawToUsdc(fast.med)} high ${rawToUsdc(fast.high)} USDC, protocol fee ${fast.minimumFeeBps} bps` : '')
  officialHigh = fast?.high
  check(fast?.minimumFeeBps === 0, 'the protocol (burn) fee for this route is 0 bps, so the fee is the forwarding fee alone')
} catch (e) {
  check(false, 'official fee tiers could be read', (e as Error).message)
}

try {
  const { AppKit } = await import('@circle-fin/app-kit')
  const { createViemAdapterFromPrivateKey } = await import('@circle-fin/adapter-viem-v2')
  const { createPublicClient, http } = await import('viem')
  const kit = new AppKit()
  const adapter = createViemAdapterFromPrivateKey({
    privateKey: generatePrivateKey(),
    getPublicClient: ({ chain }) => createPublicClient({ chain, transport: http() }),
  })
  const chains = kit.getSupportedChains() as unknown as KitChainDef[]
  const route = verifyRoute(chains, arc, eth, CCTP_DOMAINS)
  check(route.ok && route.sourceDomain === 26 && route.destinationDomain === 0, "the bridge kit's own chain data agrees: Arc mainnet is domain 26 and Ethereum mainnet is domain 0")
  const arcDef = chains.find((c) => c.chain === 'Arc')
  check(arcDef?.chainId === 5042 && arcDef.isTestnet === false, 'Arc is the mainnet (chain 5042)')
  const usdcFact = getUsdc(5042)
  check(usdcFact !== undefined && usdcFact.decimals === 6 && usdcFact.address.toLowerCase() === '0x3600000000000000000000000000000000000000', 'Arc USDC is 0x3600…0000 with 6 decimals')
  for (const amount of ['0.001', '1.5', '10']) {
    const q = await kit.estimateBridge({ from: { adapter, chain: 'Arc' }, to: { chain: 'Ethereum', recipientAddress: '0x000000000000000000000000000000000000dEaD', useForwarder: true }, amount, config: { transferSpeed: 'FAST' } })
    const fwd = quotedForwardingRaw(q.fees as never)
    const amountRaw = usdcToRaw(amount) as bigint
    const verdict = verifyForwardingFee(q.fees as never, await fetchOfficialFeeTiers(26, 0), 'FAST')
    console.log(`       ${amount} USDC: forwarding fee ${fwd === undefined ? '?' : rawToUsdc(fwd)}, network fee ${gasUsdcRaw(q.gasFees as never) === undefined ? '?' : rawToUsdc(gasUsdcRaw(q.gasFees as never) as bigint)}, official high ${officialHigh === undefined ? '?' : rawToUsdc(officialHigh)}`)
    check(fwd !== undefined && fwd > 0n, `${amount} USDC: the kit quote carries a forwarding fee as a priced USDC amount`)
    check(verdict.ok, `${amount} USDC: the kit's forwarding fee matches Circle's official high tier`, verdict.ok ? '' : verdict.message)
    const rc = checkReceive(amountRaw, q.fees as never)
    if (fwd !== undefined) {
      check(rc.ok === (amountRaw > fwd), `${amount} USDC: allowed exactly when the amount is above the fee`, rc.ok ? `receive ${rawToUsdc(rc.receiveRaw)}` : `refused, minimum ${rawToUsdc(rc.minRaw ?? 0n)}`)
      if (rc.ok) check(rc.receiveRaw === amountRaw - fwd, `${amount} USDC: estimated receive = amount - forwarding fee, in exact units`)
    }
  }
} catch (e) {
  check(false, 'the bridge kit quote flow ran', (e as Error).message.split('\n')[0])
}
check(await throws(() => fetchOfficialFeeTiers(26, -1)), 'an invalid domain is refused before any request')
check((await fetchOfficialFeeTiers(26, 0, (async () => new Response('', { status: 429 })) as unknown as typeof fetch).then(() => false).catch((e) => e instanceof FeeDataError && /rate limiting/.test(e.message))), 'a 429 from the fee service is reported as such, not as a fee')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
