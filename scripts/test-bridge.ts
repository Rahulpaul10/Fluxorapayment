/**
 * Bridge rules: the money math, the failure explanations, the "may Retry run" gate, and the CCTP configuration the
 * kit burns with (checked against the Arc chain itself when its RPC answers).
 *
 * Run: bun run test:bridge
 */
import type { Hex } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { AppKit } from '@circle-fin/app-kit'
import { checkReceive, networkFeeSummary, rawToUsdc, usdcToRaw } from '../src/lib/bridgeMath'
import { bridgeSteps, failureTitle, isProcessing } from '../src/lib/bridgeSteps'
import { toTimelineEntry, rowsForToken } from '../src/lib/activityView'
import { EURC, USDC } from '../src/lib/tokens'
import type { HistoryRow } from '../src/hooks/useHistoryRows'
import { canResume, errorText, explainTx, failedStep, isRateLimited, rateLimitWaitMs, type TxReader } from '../src/lib/bridgeErrors'
import { getUsdc } from '../src/onchain-facts'

let pass = 0
let fail = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const U = (s: string) => usdcToRaw(s) as bigint
const fwd = (amount: string | null) => [{ type: 'forwarder', token: 'USDC', amount }]

console.log('Amounts in exact 6-decimal units')
check(usdcToRaw('1.118159') === 1_118_159n, '1.118159 USDC is 1118159 units')
check(usdcToRaw('0.000001') === 1n && usdcToRaw('5') === 5_000_000n, 'the smallest unit and a whole number parse exactly')
check(usdcToRaw('1.1181591') === 1_118_160n, 'a fee with more than 6 decimals rounds UP, never down')
check(usdcToRaw('abc') === undefined && usdcToRaw('') === undefined && usdcToRaw('-1') === undefined, 'garbage is refused, not turned into zero')
check(rawToUsdc(1_118_159n) === '1.118159' && rawToUsdc(1n) === '0.000001' && rawToUsdc(0n) === '0.000000', 'units print back with 6 decimals')

console.log('Estimated receive (the Arc to Ethereum forwarding fee is 1.118159 USDC)')
const fee = fwd('1.118159')
const small = checkReceive(U('0.5'), fee)
check(!small.ok && small.reason === 'fee-covers-amount', '0.5 USDC is below the fee: not bridgeable, receive is NOT shown as 0')
check(!small.ok && small.minRaw === 1_118_160n, 'the minimum is the live fee plus one unit (1.118160): no fixed margin is added')
const equal = checkReceive(U('1.118159'), fee)
check(!equal.ok && equal.reason === 'fee-covers-amount', 'an amount equal to the fee is refused (the contract needs maxFee < amount)')
const aboveFee = checkReceive(U('1.118160'), fee)
check(aboveFee.ok && aboveFee.receiveRaw === 1n, 'one unit above the fee is allowed and delivers 0.000001 (the quote is re-checked right before the burn)')
const atMin = checkReceive(U('1.118160'), fee)
check(atMin.ok && atMin.receiveRaw === 1n, 'the minimum amount works')
check(!checkReceive(U('1.118159'), fee).ok, 'one unit below the minimum is refused')
const five = checkReceive(U('5'), fee)
check(five.ok && five.receiveRaw === 3_881_841n && rawToUsdc(five.receiveRaw) === '3.881841', '5 USDC delivers 3.881841 USDC, exactly')
check(five.ok && 5_000_000n > 1_118_159n * 113n / 100n, 'a 13% fee rise (seen for real) still leaves 5 USDC bridgeable')
check(!checkReceive(undefined, fee).ok && !checkReceive(0n, fee).ok, 'no amount means no estimate')
const unknownFee = checkReceive(U('5'), fwd(null))
check(!unknownFee.ok && unknownFee.reason === 'fee-unknown', 'a fee the quote could not price blocks the bridge (nothing is guessed)')
check(!checkReceive(U('5'), undefined).ok, 'no quote yet means no estimate')
const twoFees = checkReceive(U('5'), [{ type: 'forwarder', token: 'USDC', amount: '1.000000' }, { type: 'kit', token: 'USDC', amount: '0.5' }])
check(twoFees.ok && twoFees.receiveRaw === 3_500_000n, 'several USDC fees are all taken out')
const nativeFee = checkReceive(U('5'), [...fee, { type: 'gas', token: 'ETH', amount: '0.001' }])
check(nativeFee.ok && nativeFee.receiveRaw === 3_881_841n, 'a fee paid in another token is not subtracted from the burned USDC')
let ok = true
for (let amount = 1n; amount <= 3_000_000n; amount += 7919n) {
  const r = checkReceive(amount, fee)
  if (r.ok !== amount >= 1_118_160n) ok = false
  if (r.ok && r.receiveRaw + 1_118_159n !== amount) ok = false
  if (r.ok && r.receiveRaw <= 0n) ok = false
}
check(ok, 'across thousands of amounts: bridgeable exactly from the minimum up, fee + receive == amount, never zero')

console.log('Failure explanations come from the chain, not from a guess')
const hash = ('0x' + 'ab'.repeat(32)) as Hex
const reader = (over: Partial<TxReader>): TxReader => ({
  getTransactionReceipt: () => Promise.resolve({ status: 'success' as const, blockNumber: 100n }),
  getTransaction: () => Promise.resolve({ from: '0x000000000000000000000000000000000000dEaD' as Hex, to: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as Hex, input: '0x1234' as Hex, value: 0n }),
  call: () => Promise.resolve('0x'),
  ...over,
})
check((await explainTx(reader({}), hash)).status === 'success', 'a mined, successful burn is reported as success')
const reverted = await explainTx(
  reader({
    getTransactionReceipt: () => Promise.resolve({ status: 'reverted' as const, blockNumber: 100n }),
    call: () => Promise.reject(Object.assign(new Error('call failed'), { details: 'execution reverted: Max fee must be less than amount' })),
  }),
  hash,
)
check(reverted.status === 'reverted' && reverted.reason === 'Max fee must be less than amount', 'a reverted burn shows the node\'s own revert reason', JSON.stringify(reverted))
const replayedAt: bigint[] = []
await explainTx(
  reader({
    getTransactionReceipt: () => Promise.resolve({ status: 'reverted' as const, blockNumber: 100n }),
    call: (a) => { replayedAt.push(a.blockNumber); return Promise.reject(new Error('x')) },
  }),
  hash,
)
check(replayedAt[0] === 99n, 'the revert is replayed on the block before it was mined (state as the burn saw it)')
const notFound = await explainTx(reader({ getTransactionReceipt: () => Promise.reject(Object.assign(new Error('nf'), { name: 'TransactionReceiptNotFoundError' })) }), hash)
check(notFound.status === 'pending', 'no receipt yet is pending, never "failed"')
const limited = await explainTx(reader({ getTransactionReceipt: () => Promise.reject(new Error('HTTP request failed. Status: 429')) }), hash)
check(limited.status === 'unknown' && limited.reason.includes('429'), 'an RPC rate limit is "unknown", not a verdict on the burn')
check(errorText(new Error('first line\nreason: Max fee must be less than amount\nmore')) === 'reason: Max fee must be less than amount', 'the useful line of an error is shown')
check(errorText(undefined) === undefined && errorText('') === undefined, 'no error text means no invented text')

console.log('Rate limits (seen for real: Circle returned HTTP 429 during the burn step)')
check(isRateLimited('Maximum retry attempts (10) exceeded: HTTP 429 - Too Many Requests'), 'the real 429 message from the burn step is recognised')
check(isRateLimited('rate limit exceeded') && !isRateLimited('execution reverted: Max fee must be less than amount'), 'a revert is not mistaken for a rate limit')
check(rateLimitWaitMs(1) === 8_000 && rateLimitWaitMs(2) === 16_000 && rateLimitWaitMs(3) === 32_000 && rateLimitWaitMs(9) === 32_000, 'Retry waits longer after each rate limit, up to 32 seconds')

console.log('The three steps: Approve, Burn, Receive come only from what the kit reported')
const s = (name: string, state: string, extra: Record<string, string> = {}) => ({ name, state, ...extra })
const st = (steps: ReturnType<typeof s>[], running: boolean) => bridgeSteps(steps, running).map((v) => v.state).join('/')
check(st([], false) === 'waiting/waiting/waiting', 'nothing started: all three Waiting, nothing animates')
check(st([], true) === 'processing/waiting/waiting', 'started, no step reported yet: Approve is Processing (the wallet prompt), the rest Waiting')
check(st([s('approve', 'success')], true) === 'confirmed/processing/waiting', 'approve done: Burn is Processing')
check(st([s('approve', 'success'), s('burn', 'success')], true) === 'confirmed/confirmed/processing', 'burn done: Receive is Processing')
check(st([s('approve', 'success'), s('burn', 'success'), s('fetchAttestation', 'success')], true) === 'confirmed/confirmed/processing', 'attestation alone is not "received": the mint has not happened')
check(st([s('approve', 'success'), s('burn', 'success'), s('fetchAttestation', 'success'), s('mint', 'success')], false) === 'confirmed/confirmed/confirmed', 'only a successful mint makes Receive Confirmed')
check(st([s('approve', 'success'), s('burn', 'error')], false) === 'confirmed/failed/waiting', 'a failed burn is Failed, and Receive stays Waiting (never shown as successful)')
check(st([s('approve', 'error')], false) === 'failed/waiting/waiting', 'a failed approval stops the flow at Approve')
check(st([s('approve', 'success'), s('burn', 'success'), s('fetchAttestation', 'error')], false) === 'confirmed/confirmed/failed', 'a failed attestation is a failed Receive')
check(st([s('approve', 'success'), s('transfer', 'success'), s('fetchAttestation', 'success'), s('forward', 'success')], false) === 'confirmed/confirmed/confirmed', 'CCTPx names (transfer, forward) map to Burn and Receive')
check(!isProcessing(bridgeSteps([s('approve', 'success'), s('burn', 'error')], false)), 'the route animation is off for a failed bridge')
check(!isProcessing(bridgeSteps([s('approve', 'success'), s('burn', 'success'), s('mint', 'success')], false)), 'the route animation is off for a finished bridge')
check(isProcessing(bridgeSteps([s('approve', 'success')], true)), 'the route animation is on only while a step is processing')
check(failureTitle(bridgeSteps([s('approve', 'success'), s('burn', 'error')], false))?.title === 'Burn failed', 'a failed burn is headlined "Burn failed"')
check(bridgeSteps([s('approve', 'success'), s('burn', 'error', { txHash: '0xabc', error: 'Max fee must be less than amount' })], false)[1].error === 'Max fee must be less than amount', 'the real error text is carried on the failed step')
check(bridgeSteps([s('approve', 'success'), s('burn', 'success'), s('mint', 'success', { txHash: '0xdef' })], false)[2].onDestination === true, 'the receive transaction belongs to the destination chain')

console.log('Network fee line')
check(networkFeeSummary([{ token: 'USDC', fees: { fee: '0.0039375' } }, { token: 'USDC', fees: { fee: '0.013125' } }]) === '0.017063 USDC', 'two USDC gas fees add up, rounded up to 6 decimals (0.017063)')
check(networkFeeSummary([{ token: 'USDC', fees: null }]) === undefined, 'a gas fee that could not be estimated gives no total (nothing is guessed)')
check(networkFeeSummary([]) === undefined && networkFeeSummary(undefined) === undefined, 'no gas data, no line')
check(networkFeeSummary([{ token: 'ETH', fees: { fee: '0.00021' } }]) === '0.00021 ETH', 'gas in another token is shown in that token, never converted')

console.log('Activity timeline entries are built from real rows only')
const leg = (direction: 'in' | 'out', token: typeof USDC, amount: bigint) => ({ direction, token, amount, counterparty: '0x1111111111111111111111111111111111111111' as Hex })
const row = (over: Partial<HistoryRow>): HistoryRow => ({ key: 'k', chainId: 5042, kind: 'send', summary: 'x', status: 'success', timestamp: 1_700_000_000, legs: [], ...over })
const send = toTimelineEntry(row({ hash: `0x${'ab'.repeat(32)}` as Hex, legs: [leg('out', USDC, 12_500_000n)] }))
check(send.type === 'Send' && send.token === 'USDC' && send.amount === '-12.5' && send.status === 'Confirmed', 'a send shows type, token, signed amount and Confirmed')
check(send.shortHash === '0xababab…ababab', 'the hash is shortened for the list', send.shortHash)
const recv = toTimelineEntry(row({ kind: 'receive', legs: [leg('in', EURC, 3_000_000n)] }))
check(recv.amount === '+3' && recv.direction === 'in' && recv.token === 'EURC', 'a receive shows +amount in the token received')
const swap = toTimelineEntry(row({ kind: 'swap', legs: [leg('out', USDC, 10_000_000n), leg('in', EURC, 9_200_000n)] }))
check(swap.token === 'USDC → EURC' && swap.amount === '-10 / +9.2', 'a swap shows both sides')
const pending = toTimelineEntry(row({ status: 'pending', legs: [] }))
check(pending.status === 'Pending' && pending.token === undefined && pending.amount === undefined, 'a pending record without token data shows Pending and invents no token or amount')
check(toTimelineEntry(row({ status: 'failed' })).status === 'Failed', 'a failed transaction shows Failed')
const dropped = toTimelineEntry(row({ status: 'dropped' }))
check(dropped.status === 'Failed' && Boolean(dropped.statusNote), 'a transaction the network never saw shows Failed with the reason')
check(toTimelineEntry(row({ hash: undefined })).shortHash === undefined, 'no hash, no explorer link')
check(rowsForToken([row({ key: 'a', legs: [leg('out', USDC, 1n)] }), row({ key: 'b', legs: [leg('in', EURC, 1n)] }), row({ key: 'c', legs: [] })], 'EURC').map((r) => r.key).join() === 'b', 'the asset page lists only activity that moved that token')

console.log('Retry resumes only the step that failed, and never burns twice')
const steps = (burn: object) => [{ name: 'approve', state: 'success', txHash: '0xaa' }, { name: 'burn', state: 'error', ...burn }]
check(failedStep(steps({}))?.name === 'burn', 'the failed step is found')
const unsent = canResume(steps({}))
check(unsent.ok && unsent.from === 'burn', 'a burn that was never submitted can be started again')
check(!canResume(steps({ txHash: hash })).ok, 'a burn with a hash and no known outcome is NOT retried')
check(!canResume(steps({ txHash: hash }), { status: 'pending' }).ok, 'a burn that may still be mined is NOT retried')
check(!canResume(steps({ txHash: hash }), { status: 'unknown', reason: '429' }).ok, 'a burn that could not be checked (rate limit) is NOT retried')
check(!canResume(steps({ txHash: hash }), { status: 'success' }).ok, 'a burn that succeeded onchain is NEVER burned again')
const afterRevert = canResume(steps({ txHash: hash }), { status: 'reverted', reason: 'x' })
check(afterRevert.ok && afterRevert.from === 'burn', 'a burn that reverted can be retried (nothing was burned)')
const attest = canResume([{ name: 'approve', state: 'success' }, { name: 'burn', state: 'success', txHash: hash }, { name: 'fetchAttestation', state: 'error' }])
check(attest.ok && attest.from === 'fetchAttestation', 'after a good burn, Retry resumes at the attestation and does not touch the burn')
check(!canResume([{ name: 'approve', state: 'success' }]).ok, 'with nothing failed there is nothing to retry')

console.log('CCTP configuration the kit burns with')
const chains = new AppKit().getSupportedChains() as unknown as Array<{ chain: string; chainId: number; usdcAddress: string; cctp: { domain: number; contracts: { v2?: { tokenMessenger: string; messageTransmitter: string } } } }>
const arc = chains.find((c) => c.chain === 'Arc')
const eth = chains.find((c) => c.chain === 'Ethereum')
const TOKEN_MESSENGER_V2 = '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d' // Circle's CCTP V2 TokenMessenger on Arc and Ethereum
check(arc?.chainId === 5042, 'Arc is chain 5042')
check(arc?.usdcAddress.toLowerCase() === '0x3600000000000000000000000000000000000000', 'Arc USDC is the official 0x3600…0000')
check(arc?.usdcAddress.toLowerCase() === getUsdc(5042)?.address.toLowerCase(), 'the kit and the app agree on the Arc USDC address')
check(arc?.cctp.domain === 26, 'Arc CCTP domain is 26')
check(arc?.cctp.contracts.v2?.tokenMessenger.toLowerCase() === TOKEN_MESSENGER_V2, 'Arc TokenMessenger V2 is the official address')
check(eth?.cctp.domain === 0, 'Ethereum CCTP domain is 0')
check(eth?.usdcAddress.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'Ethereum USDC is the official address')
check(eth?.cctp.contracts.v2?.tokenMessenger.toLowerCase() === TOKEN_MESSENGER_V2, 'Ethereum TokenMessenger V2 is the official address')

console.log('The same configuration, read from the Arc chain itself')
try {
  const arcClient = createPublicClient({ transport: http('https://rpc.mainnet.arc.io', { fetchOptions: { headers: { 'user-agent': 'curl/8.0' } } }) })
  const tm = arc?.cctp.contracts.v2?.tokenMessenger as `0x${string}`
  const mt = arc?.cctp.contracts.v2?.messageTransmitter as `0x${string}`
  const abi = parseAbi([
    'function localMessageTransmitter() view returns (address)',
    'function localMinter() view returns (address)',
    'function remoteTokenMessengers(uint32) view returns (bytes32)',
    'function localDomain() view returns (uint32)',
    'function burnLimitsPerMessage(address) view returns (uint256)',
  ])
  const [transmitter, minter, remote, domain] = await Promise.all([
    arcClient.readContract({ address: tm, abi, functionName: 'localMessageTransmitter' }),
    arcClient.readContract({ address: tm, abi, functionName: 'localMinter' }),
    arcClient.readContract({ address: tm, abi, functionName: 'remoteTokenMessengers', args: [0] }),
    arcClient.readContract({ address: mt, abi, functionName: 'localDomain' }),
  ])
  const limit = await arcClient.readContract({ address: minter, abi, functionName: 'burnLimitsPerMessage', args: ['0x3600000000000000000000000000000000000000'] })
  check(transmitter.toLowerCase() === mt.toLowerCase(), 'the TokenMessenger is wired to the MessageTransmitter the kit mints through')
  check(domain === 26, 'the chain itself says its CCTP domain is 26')
  check(remote.toLowerCase().endsWith(TOKEN_MESSENGER_V2.slice(2)), 'the TokenMessenger has Ethereum (domain 0) registered as a destination')
  check(limit > 1_000_000_000_000n, 'Arc USDC has a per-message burn limit set', `${limit / 1_000_000n} USDC`)
} catch (e) {
  console.log(`  skip the onchain read (Arc RPC did not answer: ${String((e as Error).message).split('\n')[0]})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
