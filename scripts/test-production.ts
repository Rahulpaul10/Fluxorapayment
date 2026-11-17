/**
 * Pure logic added for the production pass: address book, history filters, portfolio math, explorer links,
 * transaction details and CCTP status rules. No network and no wallet. Inputs shaped like real chain and Circle
 * API responses are fixtures here and are labelled as such.
 *
 * Run: bun run test:production
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register({ url: 'http://localhost/' })

const { addEntry, updateEntry, removeEntry, validateEntry, resetAddressBookCache, MAX_NAME_LENGTH } = await import('../src/lib/addressBook')
const { applyHistoryFilters, dateBounds, dayStart } = await import('../src/lib/historyFilters')
const { windowStats, shareBps } = await import('../src/lib/portfolioStats')
const { explorerTx, explorerAddress } = await import('../src/config/networks')
const { loadTxDetails, parseTxHash } = await import('../src/lib/txDetails')
const cctp = await import('../src/lib/cctpHistory')
const { USDC, EURC } = await import('../src/lib/tokens')
const { setOnchainDetails } = await import('../src/lib/onchainMode')
const { encodeEventTopics, encodeAbiParameters, encodeFunctionData, erc20Abi } = await import('viem')

let pass = 0
let fail = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) } else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const CHECKSUMMED = '0xf9022064E606C4d67203701400b5353c87fC2eC4'

console.log('Address book')
localStorage.clear(); resetAddressBookCache()
check(validateEntry('Alex', A).ok, 'a plain name and address are accepted')
check(!validateEntry('', A).ok && !validateEntry('x'.repeat(MAX_NAME_LENGTH + 1), A).ok, 'an empty or overlong name is refused')
check(!validateEntry('Alex', '0x123').ok && !validateEntry('Alex', 'not an address').ok, 'a malformed address is refused')
check(!validateEntry('Alex', `0x${'0'.repeat(40)}`).ok, 'the zero address is refused')
const pk = validateEntry('Alex', `0x${'ab'.repeat(32)}`)
check(!pk.ok && /private key/i.test((pk as { message: string }).message), 'something shaped like a private key is refused and named as such')
check(!validateEntry('word '.repeat(12).trim(), A).ok && !validateEntry('Alex', 'one two three four five six seven eight nine ten eleven twelve').ok, 'something shaped like a recovery phrase is refused')
const bad = CHECKSUMMED.slice(0, 20) + (CHECKSUMMED[20] === 'a' ? 'B' : 'a') + CHECKSUMMED.slice(21)
check(!validateEntry('Alex', bad).ok, 'a mixed-case address with a wrong checksum is refused (a typo is caught)')
check(validateEntry('Alex', CHECKSUMMED.toLowerCase()).ok && validateEntry('Alex', CHECKSUMMED).ok, 'the lowercase and correct-checksum forms are accepted')
const saved = addEntry('Alex', A)
check(saved.ok, 'addEntry saves')
check(!addEntry('Other', A).ok && !addEntry('alex', B).ok, 'a duplicate address or a duplicate name is refused')
check(JSON.parse(localStorage.getItem('fluxora:addressbook:v1') ?? '[]').length === 1, 'it is stored in the browser')
const raw = localStorage.getItem('fluxora:addressbook:v1') ?? ''
check(!/key|seed|phrase|mnemonic/i.test(raw.replace(/"name":"Alex"/, '')), 'only a name and a public address are stored')
resetAddressBookCache()
const id = JSON.parse(localStorage.getItem('fluxora:addressbook:v1') ?? '[]')[0].id
check(updateEntry(id, 'Alex B', B).ok, 'an entry can be edited')
removeEntry(id)
check(JSON.parse(localStorage.getItem('fluxora:addressbook:v1') ?? '[]').length === 0, 'an entry can be deleted')
localStorage.setItem('fluxora:addressbook:v1', JSON.stringify([{ id: '1', name: 'Bad', address: 'zzz', createdAt: 1 }, { id: '2', name: 'Good', address: A, createdAt: 1 }]))
resetAddressBookCache()
check(JSON.parse(localStorage.getItem('fluxora:addressbook:v1') ?? '[]').length === 2, 'corrupt stored entries do not crash loading')
localStorage.clear(); resetAddressBookCache()

console.log('Onchain details setting')
setOnchainDetails(true); check(localStorage.getItem('fluxora:onchain-details:v1') === '1', 'on is remembered')
setOnchainDetails(false); check(localStorage.getItem('fluxora:onchain-details:v1') === '0', 'off is remembered')

console.log('Explorer links')
const H = `0x${'ab'.repeat(32)}`
check(explorerTx(5042, H).endsWith(`/tx/${H}`), 'a transaction link ends with the hash', explorerTx(5042, H))
check(explorerAddress(5042, CHECKSUMMED).endsWith(`/address/${CHECKSUMMED}`), 'an address link ends with the address')
check(explorerTx(5042, `${H}/../../x`) === '#' && explorerTx(5042, '0x12') === '#' && explorerAddress(5042, `${A}?x=1`) === '#' && explorerTx(5042, 'javascript:alert(1)') === '#', 'malformed or hostile identifiers never become a link')
check(explorerTx(1, H).startsWith('https://') && explorerTx(999999, H) === '#', 'every supported chain has its own explorer; an unknown chain gets none')

console.log('History filters')
const now = 1_800_000_000
const leg = (direction: 'in' | 'out', token: typeof USDC, amount: bigint, who = A) => ({ direction, token, amount, counterparty: who as `0x${string}` })
const row = (key: string, kind: string, status: string, age: number, legs: ReturnType<typeof leg>[] = [], summary = kind, hash?: string) =>
  ({ key, hash: hash as `0x${string}` | undefined, chainId: 5042, kind, summary, status, timestamp: now - age, legs }) as never
const rows = [
  row('1', 'send', 'success', 3600, [leg('out', USDC, 5_000_000n, B)], 'Sent 5 USDC', H),
  row('2', 'receive', 'success', 90_000, [leg('in', EURC, 1_000_000n)], 'Received 1 EURC'),
  row('3', 'swap', 'pending', 600, [], 'USDC → EURC'),
  row('4', 'bridge', 'failed', 40 * 86_400, [], 'Bridge'),
  row('5', 'send', 'dropped', 100, [], 'Sent'),
]
const base = { kind: 'all' as 'all' | 'send' | 'receive' | 'swap' | 'bridge', query: '', status: 'all' as 'all' | 'pending' | 'success' | 'failed', preset: 'any' as 'any' | '24h' | '7d' | '30d' | 'custom', fromDay: '', toDay: '', networkName: () => 'Arc', savedName: (a: string) => (a.toLowerCase() === B ? 'Alex' : undefined), now }
const keys = (f: Partial<typeof base>) => applyHistoryFilters(rows, { ...base, ...f }).map((r) => r.key).join(',')
check(keys({}) === '1,2,3,4,5', 'no filter shows everything')
check(keys({ kind: 'send' }) === '1,5' && keys({ kind: 'receive' }) === '2' && keys({ kind: 'swap' }) === '3' && keys({ kind: 'bridge' }) === '4', 'All, Send, Receive, Swap and Bridge each filter by kind')
check(keys({ status: 'pending' }) === '3' && keys({ status: 'success' }) === '1,2' && keys({ status: 'failed' }) === '4,5', 'status filters: pending, confirmed, failed or not found')
check(keys({ preset: '24h' }) === '1,3,5' && keys({ preset: '7d' }) === '1,2,3,5' && keys({ preset: '30d' }) === '1,2,3,5', 'date presets use the transaction time')
const day = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
check(keys({ preset: 'custom', fromDay: day(now - 40 * 86_400), toDay: day(now - 39 * 86_400) }) === '4', 'a custom range includes the whole of both end days')
check(dayStart('not-a-date') === undefined && Object.keys(dateBounds({ preset: 'custom', fromDay: '', toDay: '', now })).length === 2 && dateBounds({ preset: 'any', fromDay: '', toDay: '' }).from === undefined, 'an empty or invalid custom date means no bound')
check(keys({ query: 'alex' }) === '1' && keys({ query: 'eurc' }) === '2,3' && keys({ query: H.slice(0, 12) }) === '1' && keys({ query: 'zzz-nothing' }) === '', 'search matches saved names, tokens, summaries and hashes')
check(keys({ kind: 'send', status: 'success', preset: '24h' }) === '1', 'filters combine')

console.log('Portfolio math')
const prices = { USDC: 1_000_000n, EURC: 1_100_000n, WETH: null as bigint | null }
const ws = windowStats(
  [row('a', 'send', 'success', 1, [leg('out', USDC, 2_000_000n)]), row('b', 'receive', 'success', 1, [leg('in', EURC, 10_000_000n)]), row('c', 'swap', 'success', 1, [leg('out', USDC, 4_000_000n), leg('in', EURC, 3_600_000n)]), row('d', 'send', 'pending', 1, [leg('out', USDC, 99_000_000n)]), row('e', 'send', 'success', 1, [{ ...leg('out', USDC, 1n), token: { ...USDC, symbol: 'WETH' } }])] as never,
  prices,
)
check(ws.count === 4, 'only confirmed transactions are counted (pending is not)', String(ws.count))
check(ws.volume === 2_000_000n + 11_000_000n + 4_000_000n, 'volume = sent + received + the outgoing side of swaps, priced', String(ws.volume))
check(ws.unpricedLegs === 1, 'a leg with no live price is excluded and counted, never guessed')
check(shareBps(2_500_000n, 10_000_000n) === 2500 && shareBps(null, 1n) === null && shareBps(1n, 0n) === null, 'token share is basis points, or unknown')

console.log('Transaction details (reader fixtures shaped like real RPC answers)')
const transferTopics = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: A as `0x${string}`, to: B as `0x${string}` } })
const goodLog = { address: USDC.address, topics: transferTopics, data: encodeAbiParameters([{ type: 'uint256' }], [12_500_000n]), blockNumber: 10n, transactionHash: H, transactionIndex: 0, blockHash: H, logIndex: 0, removed: false }
const tx = { from: A as `0x${string}`, to: USDC.address as `0x${string}`, value: 0n, nonce: 7, gas: 60_000n, input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [B as `0x${string}`, 12_500_000n] }) }
const reader = (over: Record<string, unknown> = {}) => ({
  getTransaction: async () => tx,
  getTransactionReceipt: async () => ({ status: 'success', blockNumber: 31_000_000n, gasUsed: 48_000n, effectiveGasPrice: 20_000_000_000n, logs: [goodLog] }),
  getBlock: async () => ({ timestamp: 1_800_000_000n }),
  ...over,
}) as never
const d = await loadTxDetails(reader(), H as `0x${string}`)
check(d.status === 'success' && d.blockNumber === 31_000_000n && d.timestamp === 1_800_000_000 && d.method === 'transfer', 'a confirmed transaction: status, block, time and the function called')
check(d.feeUsdc === 960n, 'network fee = gas used x price paid, in USDC units (48000 x 20 gwei = 0.00096)', String(d.feeUsdc))
check(d.transfers.length === 1 && d.transfers[0].token?.symbol === 'USDC' && d.transfers[0].amount === 12_500_000n && d.transfers[0].to.toLowerCase() === B, 'the token transfer is decoded with the configured token')
const failed = await loadTxDetails(reader({ getTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 5n, gasUsed: 30_000n, effectiveGasPrice: 20_000_000_000n, logs: [] }) }), H as `0x${string}`)
check(failed.status === 'failed' && failed.transfers.length === 0, 'a reverted transaction is Failed and shows no transfers')
const missingReceipt = Object.assign(new Error('The Transaction Receipt could not be found'), { name: 'TransactionReceiptNotFoundError' })
const pending = await loadTxDetails(reader({ getTransactionReceipt: async () => { throw missingReceipt } }), H as `0x${string}`)
check(pending.status === 'pending' && pending.from === A, 'known but not yet mined is Pending, not invented as success')
const notFound = await loadTxDetails(reader({ getTransaction: async () => { throw Object.assign(new Error('Transaction could not be found'), { name: 'TransactionNotFoundError' }) } }), H as `0x${string}`)
check(notFound.status === 'not-found', 'an unknown hash is Not found')
let threw = false
try { await loadTxDetails(reader({ getTransaction: async () => { throw new Error('HTTP request failed. Status: 429') } }), H as `0x${string}`) } catch { threw = true }
check(threw, 'an RPC failure or rate limit is thrown (so the page offers Retry), never turned into "not found"')
check(parseTxHash(H) === H && parseTxHash('0x123') === undefined && parseTxHash(null) === undefined && parseTxHash(`${H}00`) === undefined, 'only a 66-character hash is accepted from the URL')

console.log('CCTP status rules (fixtures shaped like Circle API answers)')
const irisDone = cctp.parseIrisMessage({ status: 'complete', attestation: `0x${'ab'.repeat(65)}`, eventNonce: `0x${'cd'.repeat(32)}`, forwardState: 'COMPLETE', destinationMintTxHash: H, decodedMessage: { sourceDomain: '26', destinationDomain: '0', decodedMessageBody: { amount: '14480422789', feeExecuted: '255380', mintRecipient: '0xb21d' } } })
check(irisDone?.attestationReady === true && irisDone.amount === 14_480_422_789n && irisDone.destinationDomain === 0 && irisDone.destinationTxHash === H, 'a complete attestation is parsed (amount, domains, destination hash)')
const irisPending = cctp.parseIrisMessage({ status: 'pending_confirmations', attestation: 'PENDING', decodedMessage: {} })
check(irisPending?.attestationReady === false, 'a pending attestation is not "ready"')
check(cctp.parseIrisMessage(null) === null && cctp.parseIrisMessage('x') === null, 'garbage is rejected')
check(cctp.deriveStatus({ iris: irisPending, destinationVerified: false }) === 'attesting', 'no attestation yet -> waiting for attestation')
check(cctp.deriveStatus({ iris: irisDone, destinationVerified: false }) === 'ready-to-mint', 'attested but arrival not verified -> NOT completed')
check(cctp.deriveStatus({ iris: irisDone, destinationVerified: true }) === 'completed', 'completed only when the destination check passed')
check(cctp.deriveStatus({ iris: irisPending, destinationVerified: true }) === 'completed', 'a verified destination mint is completed')
check(cctp.deriveStatus({ burnFailed: true, iris: irisDone, destinationVerified: true }) === 'failed', 'a reverted burn is failed whatever else is reported')
check(cctp.deriveStatus({ iris: { ...irisDone!, forwardState: 'FAILED' }, destinationVerified: false }) === 'failed', 'a forwarding failure reported by Circle is failed')
check(cctp.deriveStatus({ iris: null, destinationVerified: false }) === 'attesting', 'no Circle record yet -> waiting')

const okReceipt = { getTransactionReceipt: async () => ({ status: 'success' }), readContract: async () => 0n } as never
check((await cctp.verifyDestination(okReceipt, irisDone!)).verified === true && (await cctp.verifyDestination(okReceipt, irisDone!)).via === 'receipt', 'destination verified by a successful receipt')
const revertedReceipt = { getTransactionReceipt: async () => ({ status: 'reverted' }), readContract: async () => 0n } as never
check((await cctp.verifyDestination(revertedReceipt, irisDone!)).verified === false, 'a reverted destination transaction does not verify')
const nonceUsed = { getTransactionReceipt: async () => { throw new Error('not found') }, readContract: async () => 1n } as never
const viaNonce = await cctp.verifyDestination(nonceUsed, { ...irisDone!, destinationTxHash: undefined })
check(viaNonce.verified === true && viaNonce.via === 'nonce', 'with no destination hash, a used CCTP nonce verifies arrival')
const nonceFree = { getTransactionReceipt: async () => { throw new Error('x') }, readContract: async () => 0n } as never
check((await cctp.verifyDestination(nonceFree, { ...irisDone!, destinationTxHash: undefined })).verified === false, 'an unused nonce is not arrival')
check((await cctp.verifyDestination(undefined, irisDone!)).verified === false && Boolean((await cctp.verifyDestination(undefined, irisDone!)).note), 'no destination client: not verified, with an explanation')
const broken = { getTransactionReceipt: async () => { throw new Error('boom') }, readContract: async () => { throw new Error('rpc down') } } as never
check((await cctp.verifyDestination(broken, { ...irisDone!, destinationTxHash: undefined })).verified === false, 'a destination RPC failure never counts as arrival')
check((await cctp.verifyDestination(okReceipt, { ...irisDone!, attestationReady: false, destinationTxHash: undefined })).verified === false, 'without an attestation or a destination hash nothing is verified')

let calls = 0
const f429 = (async () => { calls++; return calls < 3 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ messages: [{ status: 'complete', attestation: '0xaabbccddeeff00112233', decodedMessage: {} }] }), { status: 200 }) }) as unknown as typeof fetch
const got = await cctp.fetchIris(26, H as `0x${string}`, f429)
check(got?.attestationReady === true && calls === 3, 'a rate-limited lookup is retried with backoff, then succeeds', `${calls} calls`)
check((await cctp.fetchIris(26, H as `0x${string}`, (async () => new Response('', { status: 404 })) as unknown as typeof fetch)) === null, '404 means "not indexed yet", not an error')
let boom = false
try { await cctp.fetchIris(26, H as `0x${string}`, (async () => new Response('', { status: 500 })) as unknown as typeof fetch) } catch { boom = true }
check(boom, 'a server error is thrown, not hidden')
check(cctp.CCTP_DOMAINS[5042] === 26 && cctp.CCTP_DOMAINS[1] === 0 && cctp.chainForDomain(26) === 5042 && cctp.networkForDomain(0)?.name === 'Ethereum', 'domain ids: Arc 26, Ethereum 0, and back')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
