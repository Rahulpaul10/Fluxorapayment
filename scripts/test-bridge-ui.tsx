/* oxlint-disable typescript/require-await -- the fake wallet and kit methods must return promises to match the real interfaces */
/**
 * The Bridge page, with a FAKE wallet and a STAND-IN for Circle's kit.
 *
 * The page, its amount rules, its error display and its Retry gate are the real code. The kit (Circle's SDK, which needs
 * a wallet and Circle's servers) is replaced by a stand-in that returns quotes and results shaped like the real ones,
 * including the real failures seen on Arc Testnet: "Simulation failed on Arc Testnet: Max fee must be less than amount"
 * and "Maximum retry attempts (10) exceeded: HTTP 429 - Too Many Requests". The REAL kit against the real chain is
 * covered by the Arc Testnet run documented in docs/bridge-fix.md. Nothing here is broadcast.
 *
 * Run: bun run test:bridge-ui
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
// @ts-expect-error bun:test is a Bun built-in module; the project's types do not declare it
import { mock } from 'bun:test'

GlobalRegistrator.register({ url: 'http://localhost/bridge', width: 390, height: 844 })
const g = globalThis as unknown as Record<string, unknown>
g.IS_REACT_ACT_ENVIRONMENT = false
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
g.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
process.env.VITE_FLUXORA_PAY_ADDRESS = ''

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BURN_HASH = `0x${'cd'.repeat(32)}`
const calls = { estimate: 0, bridge: 0, retry: 0 }
const scenario: { bridge: () => unknown; retry: () => unknown; fee: string | null; tiers: 'ok' | 'rate' | 'mismatch' | 'garbage' } = { bridge: () => ({}), retry: () => ({}), fee: '1.118159', tiers: 'ok' }
// Circle's fee service is answered locally so this test is deterministic. The numbers are FIXTURES shaped like the real API (raw 6-decimal units).
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.includes('/v2/burn/USDC/fees/')) return realFetch(input, init)
  if (scenario.tiers === 'rate') return new Response('', { status: 429 })
  if (scenario.tiers === 'garbage') return new Response(JSON.stringify([{ finalityThreshold: 1000, forwardFee: { low: 'x' } }]), { status: 200 })
  const high = scenario.tiers === 'mismatch' ? 9_000_000 : 1_118_159
  const tier = (finalityThreshold: number) => ({ finalityThreshold, minimumFee: 0, forwardFee: { low: 764_805, med: 987_672, high } })
  return new Response(JSON.stringify([tier(1000), tier(2000)]), { status: 200 })
}) as typeof fetch
const step = (name: string, state: string, extra: object = {}) => ({ name, state, ...extra })

const stubKit = {
  on: () => undefined,
  off: () => undefined,
  estimateBridge: async (p: { amount: string }) => {
    calls.estimate++
    return { amount: p.amount, fees: [{ type: 'forwarder', token: 'USDC', amount: scenario.fee }], gasFees: [{ name: 'Approve', token: 'USDC', fees: { fee: '0.0039375' } }, { name: 'Burn', token: 'USDC', fees: { fee: '0.013125' } }] }
  },
  getSupportedChains: () => [
    { chain: 'Arc', chainId: 5042, isTestnet: false, cctp: { domain: 26 } },
    { chain: 'Ethereum', chainId: 1, isTestnet: false, cctp: { domain: 0 } },
  ],
  bridge: async () => {
    calls.bridge++
    await sleep(400)
    return scenario.bridge()
  },
  retryBridge: async () => {
    calls.retry++
    await sleep(200)
    return scenario.retry()
  },
}
mock.module('../src/lib/bridgeKit', () => ({
  loadBridgeKit: async () => stubKit,
  loadViemAdapter: async () => ({ createViemAdapterFromProvider: async () => ({ stub: true }) }),
  preloadBridgeKit: () => undefined,
}))

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { WagmiProvider, createConnector } = await import('wagmi')
const { connect } = await import('wagmi/actions')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ConnectKitProvider } = await import('connectkit')
const { config } = await import('../src/config/wallet')
const { default: App } = await import('../src/App')

const ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const // public address; only read from, and the fake wallet's account
const provider = {
  request: async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return '0x13b2' // Arc, 5042
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT]
    throw Object.assign(new Error(`fake wallet: unsupported ${method}`), { code: -32601 })
  },
  on: () => undefined,
  removeListener: () => undefined,
}
const fakeWallet = createConnector((cfg) => ({
  id: 'fake', name: 'Fake wallet', type: 'fake',
  setup: async () => undefined,
  connect: (async () => ({ accounts: [ACCOUNT], chainId: 5042 })) as never,
  disconnect: async () => undefined,
  getAccounts: async () => [ACCOUNT],
  getChainId: async () => 5042,
  isAuthorized: async () => true,
  switchChain: async ({ chainId }) => { const chain = cfg.chains.find((c) => c.id === chainId); if (!chain) throw new Error('unknown chain'); return chain },
  onAccountsChanged: () => undefined,
  onChainChanged: () => undefined,
  onDisconnect: () => undefined,
  getProvider: async () => provider,
}))

let pass = 0
let fail = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const waitFor = async (fn: () => boolean, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50) } return false }
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
const setValue = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const go = (path: string) => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const bridgeButton = () => button('Bridge to')
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false, staleTime: 0 } } })
document.body.innerHTML = '<div id="root"></div>'
createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(WagmiProvider, { config, reconnectOnMount: false }, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConnectKitProvider, null, React.createElement(App)))),
)

await sleep(1500)
await (connect as unknown as (c: unknown, p: unknown) => Promise<unknown>)(config, { connector: fakeWallet })
go('/bridge')
await waitFor(() => document.getElementById('bridge-amt') !== null)
;(document.querySelector('button[aria-label="Swap direction"]') as HTMLButtonElement).click() // Arc -> Ethereum
await waitFor(() => text().includes('Bridge to Ethereum'))
check(text().includes('Bridge to Ethereum'), 'the page is set up for Arc to Ethereum with the wallet on Arc')

const amountIs = async (value: string) => {
  setValue('bridge-amt', value)
  await sleep(900) // the page waits for typing to settle before it asks for a quote
  await waitFor(() => !text().includes('Getting a live quote'), 8000)
}

console.log('An amount below the fee never reaches the burn (the failure seen on Arc: Max fee must be less than amount)')
await amountIs('0.5')
check(text().includes('This amount is too small') && text().includes('1.118159') && text().includes('1.118160'), 'the page explains the fee and the minimum amount (fee + 0.000001, no added margin)', '1.118160 USDC')
check(!text().includes('≈ 0.000000') && !text().includes('≈ 0 '), 'it does not show a zero estimated receive')
check(bridgeButton()?.disabled === true, 'the Bridge button stays off')
await amountIs('1.2')
check(bridgeButton()?.disabled === false && text().includes('The fee is a large part of this transfer'), 'an amount just above the fee is allowed, with a warning that explains the fee', '1.2 USDC')
check(text().includes('Minimum required amount') && text().includes('1.118160 USDC'), 'the minimum is exactly the live fee plus one unit')
await amountIs('5')
check(text().includes('≈ 3.881841 USDC'), 'an amount above the fee shows the exact estimated receive', '5 - 1.118159')
check(bridgeButton()?.disabled === false, 'the Bridge button turns on')
const summary = document.querySelector('[data-testid="bridge-summary"]')?.textContent?.replace(/\s+/g, ' ') ?? ''
check(summary.includes('FromArc') && summary.includes('ToEthereum') && summary.includes('Transfer amount5 USDC'), 'the summary shows From, To and the transfer amount', summary.slice(0, 80))
check(summary.includes('Network fee0.017063 USDC'), 'the summary shows the network fee in USDC (0.003938 + 0.013125)')
check(summary.includes('Estimated receive≈ 3.881841 USDC') && summary.includes('Estimated arrival') && summary.includes('Route'), 'the summary shows estimated receive, arrival and route')
check(summary.includes('Circle forwarding fee1.118159 USDC'), 'the Circle forwarding fee has its own line')
check(summary.includes('Total wallet deduction5.017063 USDC'), 'total wallet deduction = amount + network fee (the forwarding fee comes out of the amount)')
check(summary.includes('Minimum required amount1.118160 USDC'), 'the minimum required amount is shown')
console.log('Fee verification: the bridge stays off when the fee cannot be verified')
scenario.tiers = 'rate'
await queryClient.invalidateQueries({ queryKey: ['cctp-fee-tiers'] })
await amountIs('6')
await waitFor(() => text().includes('Fee could not be verified'), 12000)
check(text().includes('Fee could not be verified') && /rate limiting/.test(text()) && bridgeButton()?.disabled === true, 'Circle fee service rate limiting: clear message, Bridge off')
scenario.tiers = 'garbage'
await queryClient.invalidateQueries({ queryKey: ['cctp-fee-tiers'] })
await amountIs('7')
await waitFor(() => /unexpected format/.test(text()), 12000)
check(/unexpected format/.test(text()) && bridgeButton()?.disabled === true, 'unexpected fee data: refused, Bridge off')
scenario.tiers = 'mismatch'
await queryClient.invalidateQueries({ queryKey: ['cctp-fee-tiers'] })
await amountIs('8')
await waitFor(() => /does not match Circle/.test(text()), 12000)
check(/does not match Circle's official fee service/.test(text()) && /stale or unexpected/.test(text()) && bridgeButton()?.disabled === true, 'a quote that disagrees with Circle: refused as stale or unexpected, Bridge off')
const before = calls.bridge
bridgeButton()?.click()
await sleep(300)
check(calls.bridge === before, 'and pressing the disabled button submits nothing')
scenario.tiers = 'ok'
await queryClient.invalidateQueries({ queryKey: ['cctp-fee-tiers'] })
await amountIs('5')
await waitFor(() => bridgeButton()?.disabled === false, 12000)
check(bridgeButton()?.disabled === false, 'with a verified fee the Bridge button is on again')
check(summary.includes('Arc → Circle CCTP → Ethereum'), 'the route line reads Arc → Circle CCTP → Ethereum')
const route = () => document.querySelector('[data-testid="bridge-route"]')
const stepState = (k: string) => document.querySelector(`[data-testid="bridge-step-${k}"]`)?.getAttribute('data-state')
check(route() !== null && route()?.getAttribute('data-active') === 'false', 'the route is shown and is NOT animating before anything is sent')
check(['approve', 'burn', 'receive'].every((k) => document.querySelector(`[data-testid="bridge-step-${k}"]`) === null), 'the three steps appear only after a bridge starts')

console.log('A quote with an unpriced fee blocks the bridge instead of guessing')
scenario.fee = null
await amountIs('9')
check(text().includes('could not be priced') && bridgeButton()?.disabled === true, 'no fee, no bridge')
scenario.fee = '1.118159'
await amountIs('5')

console.log('A burn failure shows the real reason and the hash, and Retry resumes only that step')
scenario.bridge = () => ({ state: 'error', steps: [step('approve', 'success', { txHash: `0x${'aa'.repeat(32)}` }), step('burn', 'error', { error: new Error('Simulation failed on Arc: Max fee must be less than amount') })] })
scenario.retry = () => ({ state: 'success', steps: [step('approve', 'success', { txHash: `0x${'aa'.repeat(32)}` }), step('burn', 'success', { txHash: BURN_HASH }), step('fetchAttestation', 'success'), step('mint', 'success', { txHash: `0x${'ee'.repeat(32)}` })] })
bridgeButton()?.click()
bridgeButton()?.click() // a second press while the first is running
await sleep(120)
check(stepState('approve') === 'processing' && route()?.getAttribute('data-active') === 'true', 'while the real bridge call is running the first step is Processing and the route moves', `${stepState('approve')}`)
await waitFor(() => text().includes('Burn failed'), 8000)
check(calls.bridge === 1, 'pressing Bridge twice starts only ONE bridge', `${calls.bridge} call`)
check(text().includes('Max fee must be less than amount'), 'the real revert reason is on screen')
check(text().includes('Nothing was sent for this step'), 'it says no transaction was sent for the failed step')
check(text().includes('Approve') && text().includes('Burn') && text().includes('Receive'), 'the three steps are kept on screen')
check(button('Retry') !== undefined, 'the Retry button is there')
check(stepState('approve') === 'confirmed' && stepState('burn') === 'failed' && stepState('receive') === 'waiting', 'Approve is Confirmed, Burn is Failed, Receive is still Waiting', `${stepState('approve')}/${stepState('burn')}/${stepState('receive')}`)
check(route()?.getAttribute('data-active') === 'false', 'the route stops moving when the burn failed')
button('Retry')?.click()
await waitFor(() => text().includes('Bridge complete'), 8000)
check(calls.retry === 1 && calls.bridge === 1, 'Retry resumed the existing transfer once and did not start a new bridge', `bridge ${calls.bridge}, retry ${calls.retry}`)
check(text().includes('Bridge complete'), 'success is shown only after the kit reports success')

console.log('A burn that has a hash but no receipt yet is NOT retried (it could be mined)')
await amountIs('5.5')
scenario.bridge = () => ({ state: 'error', steps: [step('approve', 'success', { txHash: `0x${'aa'.repeat(32)}` }), step('burn', 'error', { txHash: BURN_HASH, error: new Error('timeout while waiting for the receipt') })] })
const retriesBefore = calls.retry
bridgeButton()?.click()
await waitFor(() => text().includes('Burn failed'), 8000)
check(text().includes('timeout while waiting for the receipt'), 'the kit message is shown')
check(text().includes('Transaction hash is in the progress list'), 'the burn hash is shown for checking')
button('Retry')?.click()
await waitFor(() => text().includes('Wait for it to be mined') || text().includes('could not be checked'), 8000)
check(calls.retry === retriesBefore, 'Retry did NOT call the kit, so there is no second burn', `retry calls ${calls.retry}`)
check(text().includes('burned twice') || text().includes('twice'), 'the page says why')

console.log('A rate limit from Circle is explained, and Retry waits before resuming')
await amountIs('7')
scenario.bridge = () => ({ state: 'error', steps: [step('approve', 'success', { txHash: `0x${'aa'.repeat(32)}` }), step('burn', 'error', { error: new Error('Maximum retry attempts (10) exceeded: HTTP 429 - Too Many Requests') })] })
bridgeButton()?.click()
await waitFor(() => text().includes('rate limiting'), 8000)
check(text().includes('HTTP 429') && text().includes('rate limiting this connection'), 'the 429 is named and explained')
check(text().includes('waits a few seconds'), 'it says Retry waits first')
const beforeWait = calls.retry
button('Retry')?.click()
await waitFor(() => text().includes('Waiting 8 seconds'), 3000)
check(text().includes('Waiting 8 seconds'), 'Retry shows the wait instead of hammering the service')
check(calls.retry === beforeWait, 'the kit is not called during the wait')
await waitFor(() => calls.retry > beforeWait, 14000)
check(calls.retry === beforeWait + 1, 'after the wait, Retry resumes once', `retry calls ${calls.retry}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
