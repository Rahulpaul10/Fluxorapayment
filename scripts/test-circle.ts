/**
 * Circle integration checks. Part 1 is pure logic (compliance, delivery verification, arrival times). Part 2 checks the
 * app's configuration against Circle's OWN documentation pages and the Arc network itself. It reads only: no wallet,
 * no transaction, no key.
 *
 * Run: bun run test:circle
 */
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, createPublicClient, http, parseAbiItem } from 'viem'
import { checkUsdcCompliance, verifyDelivery, usdcComplianceAbi } from '../src/lib/circleUsdc'
import { arrivalEstimate, verifyRoute, type KitChainDef } from '../src/lib/cctpFees'
import { ARC_TOKEN_MESSENGER, CCTP_DOMAINS, MESSAGE_TRANSMITTER_V2, IRIS_API } from '../src/lib/cctpHistory'
import { bridgeSteps } from '../src/lib/bridgeSteps'
import { USDC } from '../src/lib/tokens'
import { getUsdc } from '../src/onchain-facts'

let pass = 0
let fail = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) } else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const A = '0x1111111111111111111111111111111111111111' as const
const B = '0x2222222222222222222222222222222222222222' as const
const TOKEN = USDC.address

console.log("Circle USDC compliance list (fixtures: a fake reader that answers like the contract)")
const reader = (blocked: string[], paused = false, fail = false) => ({
  readContract: async (a: { functionName: string; args?: readonly string[] }) => {
    if (fail) throw new Error('rpc down')
    if (a.functionName === 'paused') return paused
    return blocked.includes((a.args?.[0] ?? '').toLowerCase())
  },
}) as never
check((await checkUsdcCompliance(reader([]), TOKEN, { sender: A, recipient: B })).status === 'clear', 'neither party blocked: clear')
const r1 = await checkUsdcCompliance(reader([B]), TOKEN, { sender: A, recipient: B })
check(r1.status === 'blocked' && r1.reason === 'recipient' && /blocklist/.test(r1.message), 'a blocked recipient is reported before anything is signed')
const r2 = await checkUsdcCompliance(reader([A]), TOKEN, { sender: A, recipient: B })
check(r2.status === 'blocked' && r2.reason === 'sender', 'a blocked sender is reported')
const r3 = await checkUsdcCompliance(reader([], true), TOKEN, { sender: A, recipient: B })
check(r3.status === 'blocked' && r3.reason === 'paused', 'a paused token is reported')
check((await checkUsdcCompliance(reader([], false, true), TOKEN, { sender: A, recipient: B })).status === 'unverified', 'a failed read is "unverified", never "clear"')
check((await checkUsdcCompliance(reader([B]), TOKEN, { sender: A })).status === 'clear', 'only the parties given are checked')
check((await checkUsdcCompliance(reader([B]), TOKEN, { recipient: 'not an address' })).status === 'clear', 'an invalid address is skipped, not sent to the contract')

console.log('Delivery verification from a confirmed receipt (fixtures shaped like Arc receipts)')
const transferLog = (token: string, from: string, to: string, value: bigint) => ({ address: token, topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']), eventName: 'Transfer', args: { from: from as `0x${string}`, to: to as `0x${string}` } }), data: encodeAbiParameters([{ type: 'uint256' }], [value]) })
const expect = { tokenAddress: TOKEN, symbol: 'USDC', decimals: 6, to: B, amount: 5_000_000n }
check(verifyDelivery([transferLog(TOKEN, A, B, 5_000_000n)], expect).status === 'verified', 'the exact amount reached the recipient: verified')
const mism = verifyDelivery([transferLog(TOKEN, A, B, 4_950_000n)], expect)
check(mism.status === 'mismatch' && mism.received === 4_950_000n, 'a different amount is flagged with what really arrived')
check(verifyDelivery([], expect).status === 'not-found' && verifyDelivery([transferLog(TOKEN, A, A, 5_000_000n)], expect).status === 'not-found', 'no transfer to the recipient: not found')
check(verifyDelivery([transferLog('0x9999999999999999999999999999999999999999', A, B, 5_000_000n)], expect).status === 'not-found', 'a transfer of a different token does not count')
check(verifyDelivery([transferLog(TOKEN, A, B, 2_000_000n), transferLog(TOKEN, A, B, 3_000_000n)], expect).status === 'verified', 'several transfers to the recipient add up')
check(verifyDelivery([transferLog(TOKEN, A, B, 5_000_000n), { address: TOKEN, topics: ['0xdeadbeef'], data: '0x' }], expect).status === 'verified', 'unrelated logs are ignored')

console.log('Estimated arrival from the source network finality (kit data, Circle docs)')
check(arrivalEstimate({ confirmations: 1 }, 'SLOW') === 'Typically under a minute' && arrivalEstimate({ confirmations: 1 }, 'FAST') === 'Typically under a minute', 'Arc source (1 confirmation): under a minute for both speeds')
check(arrivalEstimate({ confirmations: 65, fastConfirmations: 2 }, 'SLOW') === 'Typically 15 to 20 minutes', 'Ethereum-style standard transfer (65 confirmations): 15 to 20 minutes')
check(arrivalEstimate({ confirmations: 65, fastConfirmations: 2 }, 'FAST') === 'Typically under a minute', 'a Fast Transfer on that chain: under a minute')
check(/source network/.test(arrivalEstimate(undefined, 'FAST')), 'unknown finality says so instead of inventing a time')

console.log('Receive step says which half it is in (what the kit really reported)')
const waiting = bridgeSteps([{ name: 'approve', state: 'success' }, { name: 'burn', state: 'success' }, { name: 'fetchAttestation', state: 'pending' }], true)[2]
check(waiting.state === 'processing' && /Waiting for Circle to attest/.test(waiting.detail ?? ''), 'attestation pending: "Waiting for Circle to attest the burn."')
const minting = bridgeSteps([{ name: 'approve', state: 'success' }, { name: 'burn', state: 'success' }, { name: 'fetchAttestation', state: 'success' }, { name: 'mint', state: 'pending' }], true)[2]
check(minting.state === 'processing' && /attested the burn/.test(minting.detail ?? ''), 'attested, mint pending: "Minting on the destination now."')
check(bridgeSteps([{ name: 'burn', state: 'success' }, { name: 'fetchAttestation', state: 'success' }, { name: 'mint', state: 'success' }], false)[2].detail === undefined, 'a finished step shows no in-progress text')

console.log("Live: Circle's own documentation, the kit's chain data and the Arc network agree (read only)")
const get = async (url: string) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url)
    if (r.ok) return r.text()
    await new Promise((res) => setTimeout(res, 1200 * (i + 1)))
  }
  throw new Error(`could not read ${url}`)
}
try {
  const chains = await get('https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md')
  const arcRow = chains.split('\n').find((l) => /^\|\s*Arc\s*\|/.test(l)) ?? ''
  check(/✅/.test(arcRow) && (arcRow.match(/✅/g) ?? []).length >= 3, 'Circle lists Arc as a CCTP chain: standard source, upfront fees and Forwarding Service', arcRow.replace(/\s+/g, ' ').slice(0, 70))
  check(/\|\s*26\s*\|\s*Arc\s*\|/.test(chains) && /\|\s*0\s*\|\s*Ethereum\s*\|/.test(chains), 'Circle domain ids: Arc 26, Ethereum 0', `app uses ${CCTP_DOMAINS[5042]} and ${CCTP_DOMAINS[1]}`)
  check(CCTP_DOMAINS[5042] === 26 && CCTP_DOMAINS[1] === 0, "the app's domain ids match")
  const addrs = await get('https://developers.circle.com/cctp/references/contract-addresses.md')
  const mainnet = addrs.slice(addrs.indexOf('## Mainnet contract addresses'), addrs.indexOf('## Testnet contract addresses'))
  const section = (name: string) => mainnet.slice(mainnet.indexOf(`### ${name}`)).split('### ').slice(1, 2)[0] ?? ''
  const rowAddr = (sec: string, chain: string) => (sec.split('\n').find((l) => l.includes(`**${chain}**`))?.match(/0x[0-9a-fA-F]{40}/)?.[0])
  const docTM = rowAddr(section('TokenMessengerV2'), 'Arc')
  const docMT = rowAddr(section('MessageTransmitterV2'), 'Arc')
  const docMinter = rowAddr(section('TokenMinterV2'), 'Arc')
  const docMsg = rowAddr(section('MessageV2'), 'Arc')
  check(docTM?.toLowerCase() === ARC_TOKEN_MESSENGER.toLowerCase(), 'TokenMessengerV2 on Arc = the app\'s address', docTM)
  check(docMT?.toLowerCase() === MESSAGE_TRANSMITTER_V2.toLowerCase(), 'MessageTransmitterV2 on Arc = the app\'s address', docMT)
  check(rowAddr(section('TokenMessengerV2'), 'Ethereum')?.toLowerCase() === ARC_TOKEN_MESSENGER.toLowerCase() && rowAddr(section('MessageTransmitterV2'), 'Ethereum')?.toLowerCase() === MESSAGE_TRANSMITTER_V2.toLowerCase(), 'the same V2 addresses are listed for Ethereum')
  const usdcDoc = await get('https://developers.circle.com/stablecoins/usdc-contract-addresses.md')
  const docUsdc = usdcDoc.split('\n').find((l) => /^\|\s*Arc\s*\|/.test(l))?.match(/0x[0-9a-fA-F]{40}/)?.[0]
  const fact = getUsdc(5042)
  check(docUsdc?.toLowerCase() === USDC.address.toLowerCase() && fact?.address.toLowerCase() === docUsdc?.toLowerCase(), 'USDC on Arc: Circle docs = the app = the shared network facts', docUsdc)

  const { AppKit } = await import('@circle-fin/app-kit')
  const kitChains = new AppKit().getSupportedChains() as unknown as KitChainDef[]
  const arcDef = kitChains.find((c) => c.chain === 'Arc') as (KitChainDef & { cctp?: { contracts?: { v1?: unknown; v2?: { tokenMessenger?: string; messageTransmitter?: string } } } }) | undefined
  check(arcDef?.cctp?.contracts?.v1 === undefined && arcDef?.cctp?.contracts?.v2 !== undefined, "the bridge kit's Arc data has CCTP V2 only (no V1 contracts)")
  check(arcDef?.cctp?.contracts?.v2?.tokenMessenger?.toLowerCase() === docTM?.toLowerCase() && arcDef?.cctp?.contracts?.v2?.messageTransmitter?.toLowerCase() === docMT?.toLowerCase(), "the kit's Arc contracts equal Circle's documented V2 contracts")
  check(verifyRoute(kitChains, { kit: 'Arc', id: 5042, name: 'Arc' }, { kit: 'Ethereum', id: 1, name: 'Ethereum' }, CCTP_DOMAINS).ok, 'the route Arc to Ethereum verifies against the kit')

  const arc = createPublicClient({ transport: http('https://rpc.mainnet.arc.io') })
  const code = async (a: string) => ((await arc.getCode({ address: a as `0x${string}` })) ?? '0x').length > 2
  check(await code(docTM ?? '') && await code(docMT ?? '') && await code(docMinter ?? '') && await code(docMsg ?? ''), 'all four documented CCTP V2 contracts have code on Arc mainnet (chain 5042)')
  const tm = parseAbi(['function localMessageTransmitter() view returns (address)', 'function remoteTokenMessengers(uint32) view returns (bytes32)'])
  const mt = parseAbi(['function localDomain() view returns (uint32)'])
  check(getAddress(await arc.readContract({ address: ARC_TOKEN_MESSENGER, abi: tm, functionName: 'localMessageTransmitter' })) === MESSAGE_TRANSMITTER_V2, "Arc's TokenMessengerV2 is wired to the documented MessageTransmitterV2")
  check(Number(await arc.readContract({ address: MESSAGE_TRANSMITTER_V2, abi: mt, functionName: 'localDomain' })) === 26, "Arc's MessageTransmitterV2 reports domain 26")
  check((await arc.readContract({ address: ARC_TOKEN_MESSENGER, abi: tm, functionName: 'remoteTokenMessengers', args: [0] })) !== `0x${'0'.repeat(64)}`, 'Arc has Ethereum (domain 0) registered as a remote CCTP domain')
  check(Number(await arc.readContract({ address: USDC.address, abi: parseAbi(['function decimals() view returns (uint8)']), functionName: 'decimals' })) === 6, 'USDC on Arc has 6 decimals')
  const flags = await Promise.all([arc.readContract({ address: USDC.address, abi: usdcComplianceAbi, functionName: 'paused' }), arc.readContract({ address: USDC.address, abi: usdcComplianceAbi, functionName: 'isBlacklisted', args: ['0x000000000000000000000000000000000000dEaD'] })])
  check(typeof flags[0] === 'boolean' && typeof flags[1] === 'boolean', "Arc's USDC answers the compliance reads (paused, isBlacklisted) the app relies on", `paused ${flags[0]}`)

  // A real message from Circle's attestation service: it must be CCTP V2.
  const head = await arc.getBlockNumber()
  const burnEvent = parseAbiItem('event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)')
  let hash: string | undefined
  for (let i = 0n; i < 6n && !hash; i++) {
    try {
      const logs = await arc.getLogs({ address: ARC_TOKEN_MESSENGER, event: burnEvent, fromBlock: head - i * 5000n - 4999n, toBlock: head - i * 5000n })
      hash = logs[logs.length - 1]?.transactionHash
    } catch { /* next range */ }
  }
  if (hash) {
    const res = await fetch(`${IRIS_API}/v2/messages/26?transactionHash=${hash}`)
    const json = (await res.json()) as { messages?: { cctpVersion?: number; status?: string; decodedMessage?: { sourceDomain?: string } }[] }
    const m = json.messages?.[0]
    check(res.ok && m?.cctpVersion === 2 && m.decodedMessage?.sourceDomain === '26', "a real Arc burn is a CCTP V2 message from domain 26 in Circle's attestation service", `status ${m?.status}`)
  } else console.log('  skip no recent Arc burn found for the attestation check')
} catch (e) {
  check(false, 'live verification ran', (e as Error).message.split('\n')[0])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
