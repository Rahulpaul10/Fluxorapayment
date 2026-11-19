/* oxlint-disable typescript/require-await -- the fake wallet methods must return promises to match the connector interface */
/**
 * Circle USDC checks in the real pages, with a FAKE wallet (reads only, nothing is sent). The compliance reader and the transaction tracker are replaced by test doubles so a blocked recipient and a confirmed receipt can be shown.
 * The test account is a public address that holds real USDC, so balances, the block number and the activity list are
 * what the chain says. Nothing is mocked.
 *
 * Run: bun run test:circle-ui
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register({ url: 'http://localhost/', width: 390, height: 844 })
const g = globalThis as unknown as Record<string, unknown>
g.IS_REACT_ACT_ENVIRONMENT = false
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
g.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
process.env.VITE_FLUXORA_PAY_ADDRESS = ''
// Failure injection for one test below: while on, every JSON-RPC request is answered with a rate-limit error.
let failRpc = false
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (failRpc && init?.body && typeof init.body === 'string' && /jsonrpc/.test(init.body)) {
    const b = JSON.parse(init.body) as { id: number } | { id: number }[]
    const err = (id: number) => ({ jsonrpc: '2.0', id, error: { code: -32005, message: 'rate limit exceeded' } })
    return new Response(JSON.stringify(Array.isArray(b) ? b.map((r) => err(r.id)) : err(b.id)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch

// @ts-expect-error bun:test is a Bun built-in without type declarations in this project
import { mock } from 'bun:test'
const BLOCKED = '0x0000000000000000000000000000000000000bad'
const real = await import('../src/lib/circleUsdc')
mock.module('../src/lib/circleUsdc', () => ({
  ...real,
  checkUsdcCompliance: async (_c: unknown, _u: unknown, parties: { recipient?: string }) =>
    parties.recipient?.toLowerCase() === BLOCKED ? ({ status: 'blocked', reason: 'recipient', message: "This address is on Circle's USDC blocklist. USDC cannot be sent to it, so the transfer would fail." } as const) : ({ status: 'clear' } as const),
}))
const trackerState: { current: unknown } = { current: { phase: 'confirmed', elapsedMs: 800, attempts: 1, receipt: { blockNumber: 123n, logs: [] } } }
mock.module('../src/hooks/useTxTracker', () => ({ useTxTracker: () => ({ state: trackerState.current, checkAgain: () => undefined }) }))

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { WagmiProvider, createConnector } = await import('wagmi')
const { connect } = await import('wagmi/actions')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ConnectKitProvider } = await import('connectkit')
const { config } = await import('../src/config/wallet')
const { default: App } = await import('../src/App')

const ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const // public address, only read from
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const provider = {
  request: async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return '0x13b2'
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
const waitFor = async (fn: () => boolean, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50) } return false }
const q = (sel: string) => document.querySelector(sel)
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
const setValue = (el: Element, value: string) => {
  const input = el as HTMLInputElement
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const go = (path: string) => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 600, refetchOnWindowFocus: false, staleTime: 10_000 } } })
document.body.innerHTML = '<div id="root"></div>'
createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(WagmiProvider, { config, reconnectOnMount: false }, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConnectKitProvider, null, React.createElement(App)))),
)

const { encodeAbiParameters, encodeEventTopics, parseAbi } = await import('viem')

await sleep(1500)
await (connect as unknown as (c: unknown, p: unknown) => Promise<unknown>)(config, { connector: fakeWallet })
await waitFor(() => q('[data-testid="total-balance"]') !== null)

console.log("Send: Circle's USDC blocklist is checked before the wallet opens")
go('/send')
await waitFor(() => document.getElementById('to') !== null)
setValue(document.getElementById('to') as Element, BLOCKED)
setValue(document.getElementById('amt') as Element, '1')
check(await waitFor(() => q('[data-testid="usdc-blocked"]') !== null), 'a blocklisted recipient is refused with a plain message')
check(/Circle's USDC blocklist/.test(q('[data-testid="usdc-blocked"]')?.textContent ?? '') && /would fail/.test(text()), 'the message says why and that it would fail')
await sleep(1500)
check(button('Review transfer')?.disabled === true, 'Review stays off, so the wallet is never asked to sign it')
setValue(document.getElementById('to') as Element, '0x1111111111111111111111111111111111111111')
check(await waitFor(() => q('[data-testid="usdc-blocked"]') === null), 'a normal recipient clears the message')
check(await waitFor(() => button('Review transfer')?.disabled === false, 30000), 'and Review turns on (real gas estimate against Arc)')

console.log('A confirmed transaction is checked against what it was meant to deliver')
const { TxStatus } = await import('../src/components/TxStatus')
const TOKEN = '0x3600000000000000000000000000000000000000' as const
const FROM = '0x1111111111111111111111111111111111111111' as const
const TO = '0x2222222222222222222222222222222222222222' as const
const log = (to: string, value: bigint) => ({ address: TOKEN, topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']), eventName: 'Transfer', args: { from: FROM, to: to as `0x${string}` } }), data: encodeAbiParameters([{ type: 'uint256' }], [value]) })
const expectation = { tokenAddress: TOKEN, symbol: 'USDC', decimals: 6, to: TO, amount: 5_000_000n }
const show = async (logs: unknown[]) => {
  trackerState.current = { phase: 'confirmed', elapsedMs: 900, attempts: 1, receipt: { blockNumber: 31_000_000n, logs } }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(React.createElement(TxStatus, { hash: `0x${'ab'.repeat(32)}`, chainId: 5042, title: 'Transfer', expect: expectation }))
  await waitFor(() => host.querySelector('[data-testid="delivery-check"]') !== null, 3000)
  const el = host.querySelector('[data-testid="delivery-check"]')
  const out = { status: el?.getAttribute('data-status'), text: (el?.textContent ?? '').replace(/\s+/g, ' '), confirmed: (host.textContent ?? '').includes('confirmed in block 31000000') }
  root.unmount()
  host.remove()
  return out
}
const ok = await show([log(TO, 5_000_000n)])
check(ok.confirmed && ok.status === 'verified' && /Verified in the receipt: 5 USDC arrived at 0x2222…2222/.test(ok.text), 'the exact amount arrived: "Verified in the receipt"', ok.text.slice(0, 70))
const bad = await show([log(TO, 4_900_000n)])
check(bad.status === 'mismatch' && /4\.9 USDC/.test(bad.text) && /5 USDC expected/.test(bad.text), 'a different amount is called out, with both numbers', bad.text.slice(0, 80))
const none = await show([log('0x3333333333333333333333333333333333333333', 5_000_000n)])
check(none.status === 'not-found' && /no USDC transfer to 0x2222…2222/.test(none.text), 'no transfer to the recipient is called out')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
