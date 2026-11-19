/* oxlint-disable typescript/require-await -- the fake wallet methods must return promises to match the connector interface */
/**
 * The redesigned dashboard and asset page, with a FAKE wallet, against REAL Arc data (reads only, nothing is sent).
 * The test account is a public address that holds real USDC, so balances, the block number and the activity list are
 * what the chain says. Nothing is mocked.
 *
 * Run: bun run test:dashboard
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

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { WagmiProvider, createConnector } = await import('wagmi')
const { connect } = await import('wagmi/actions')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ConnectKitProvider } = await import('connectkit')
const { config } = await import('../src/config/wallet')
const { ARC_TOKENS } = await import('../src/lib/tokens')
const { default: App } = await import('../src/App')

const ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const // public address, only read from
const USDC_ADDR = '0x3600000000000000000000000000000000000000'
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
const qa = (sel: string) => [...document.querySelectorAll(sel)]
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
const go = (path: string) => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 600, refetchOnWindowFocus: false, staleTime: 10_000 } } })
document.body.innerHTML = '<div id="root"></div>'
createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(WagmiProvider, { config, reconnectOnMount: false }, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConnectKitProvider, null, React.createElement(App)))),
)

await sleep(1500)
await (connect as unknown as (c: unknown, p: unknown) => Promise<unknown>)(config, { connector: fakeWallet })
await waitFor(() => q('[data-testid="total-balance"]') !== null)

console.log('Wallet identity')
check(text().includes('My Arc Wallet'), 'the wallet is named "My Arc Wallet"')
check(q('[data-testid="wallet-address-short"]')?.textContent === '0x0000…dEaD', 'the short address is shown', q('[data-testid="wallet-address-short"]')?.textContent ?? '')
check(button('Copy') !== undefined && button('QR') !== undefined, 'Copy and QR are there')
;(q('button[aria-label^="Wallet address"]') as HTMLButtonElement).click()
await sleep(100)
check(q('[data-testid="wallet-address-full"]')?.textContent === ACCOUNT, 'tapping the address shows it in full')
;(q('button[aria-label="Show QR code"]') as HTMLButtonElement).click()
await sleep(100)
check(q('[role="dialog"] svg') !== null && q('[data-testid="wallet-full-address"]')?.textContent === ACCOUNT, 'QR opens a dialog with a QR code and the full address')
;(q('button[aria-label="Close"]') as HTMLButtonElement).click()
await sleep(100)
check(q('[role="dialog"]') === null, 'the dialog closes')

console.log('Balance and assets (real balances)')
check(/^\$[\d,]+\.\d{2}$/.test(q('[data-testid="total-balance"]')?.textContent ?? ''), 'total balance is a real dollar amount', q('[data-testid="total-balance"]')?.textContent ?? '')
const cards = qa('[data-testid="asset-card"]')
check(cards.length === ARC_TOKENS.length, `one card per configured token (${ARC_TOKENS.length})`, String(cards.length))
const names = ['USD Coin', 'Euro Coin', 'Wrapped Ether', 'Circle Wrapped Bitcoin']
check(names.every((n) => text().includes(n)) && ['USDC', 'EURC', 'WETH', 'cirBTC'].every((s) => text().includes(s)), 'each card shows name and symbol')
check(cards.every((c) => c.querySelector('[aria-label="Configured token contract"]') !== null), 'each card carries the configured-token indicator')
check(await waitFor(() => !/No live price|\$0\.00/.test('') && (cards[0].textContent ?? '').includes('$')), 'the USDC card shows a USD value')
const bridgeChips = cards.filter((c) => button('Bridge', c) !== undefined)
check(bridgeChips.length === 1 && (bridgeChips[0].textContent ?? '').includes('USDC'), 'Bridge is offered only on USDC, the one token the bridge supports')
check(cards.every((c) => button('Send', c) !== undefined && button('Swap', c) !== undefined), 'every card has Send and Swap')

console.log('Quick actions')
const quick = ['Send', 'Receive', 'Swap', 'Bridge'].map((l) => qa('div.grid > button').find((b) => b.textContent === l))
check(quick.every(Boolean), 'Send, Receive, Swap and Bridge are all there')

console.log('Arc Network and Gas Insight (real data)')
check(text().includes('Arc Network') && text().includes('Arc Mainnet') && text().includes('Gas token') && text().includes('USDC'), 'the network card names Arc Mainnet and the USDC gas token')
check(await waitFor(() => /^[\d,]{6,}$/.test(q('[data-testid="arc-block"]')?.textContent ?? '')), 'the current block is read from the network', q('[data-testid="arc-block"]')?.textContent ?? '')
check(await waitFor(() => q('[aria-label="Arc network Online"]') !== null || q('[aria-label="Arc network Slow"]') !== null), 'the network status comes from a live check')
check(text().includes('Gas Insight') && text().includes('Paid in USDC'), 'Gas Insight is shown')
check(await waitFor(() => qa('[aria-label="Gas Insight"] li').length > 0 || /No recent transactions sent|after your first transaction/.test(text())), 'Gas Insight shows real receipts or an honest empty state')

console.log('Activity timeline (real)')
await waitFor(() => qa('[data-testid="timeline-item"]').length > 0 || text().includes('No activity in the recent blocks'))
const items = qa('[data-testid="timeline-item"]')
if (items.length) {
  check(items.every((i) => /Pending|Confirmed|Failed/.test(i.textContent ?? '')), 'every entry has a Pending, Confirmed or Failed status')
  check(items.every((i) => /(\d+[smhd] ago)/.test(i.textContent ?? '')), 'every entry has a timestamp')
  check(items.every((i) => /0x[0-9a-f]{6,8}…[0-9a-f]{4,6}/i.test(i.textContent ?? '')), 'every entry shows a short transaction hash')
  check(items.every((i) => (i.textContent ?? '').includes('View on Arc Explorer')), 'every entry links to the Arc explorer')
  const href = (items[0].querySelector('a') as HTMLAnchorElement).href
  check(/\/tx\/0x[0-9a-f]{64}$/i.test(href), 'the link points at the real transaction', href.slice(-20))
} else check(text().includes('No activity in the recent blocks'), 'no activity: an honest empty state, nothing invented')
check(qa('a').some((a) => (a.textContent ?? '').includes('View on Arc Explorer') && (a as HTMLAnchorElement).href.includes(`/address/${ACCOUNT}`)), 'the activity card links to the wallet on the Arc explorer')

console.log('Timeline component, rendered with sample rows (a component test: these rows are inputs, not chain data)')
{
  const { ActivityTimeline } = await import('../src/components/ActivityTimeline')
  const { USDC, EURC } = await import('../src/lib/tokens')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const leg = (direction: 'in' | 'out', token: typeof USDC, amount: bigint) => ({ direction, token, amount, counterparty: '0x1111111111111111111111111111111111111111' as `0x${string}` })
  const now = Math.floor(Date.now() / 1000)
  const sample = [
    { key: '1', hash: `0x${'ab'.repeat(32)}` as `0x${string}`, chainId: 5042, kind: 'send' as const, summary: 'Sent 12.5 USDC', status: 'success' as const, timestamp: now - 120, legs: [leg('out', USDC, 12_500_000n)] },
    { key: '2', hash: `0x${'cd'.repeat(32)}` as `0x${string}`, chainId: 5042, kind: 'bridge' as const, summary: 'Bridged 5 USDC', status: 'pending' as const, timestamp: now - 30, legs: [] },
    { key: '3', hash: `0x${'ef'.repeat(32)}` as `0x${string}`, chainId: 5042, kind: 'receive' as const, summary: 'Received 3 EURC', status: 'failed' as const, timestamp: now - 7200, legs: [leg('in', EURC, 3_000_000n)] },
  ]
  createRoot(host).render(React.createElement(ActivityTimeline, { rows: sample, loading: false, empty: 'none' }))
  await waitFor(() => host.querySelectorAll('[data-testid="timeline-item"]').length === 3)
  const li = [...host.querySelectorAll('[data-testid="timeline-item"]')]
  const t0 = li.map((i) => i.textContent ?? '')
  check(li.length === 3, 'one entry per real row')
  check(t0[0].includes('Send') && t0[0].includes('USDC') && t0[0].includes('-12.5') && t0[0].includes('Confirmed') && t0[0].includes('2m ago') && t0[0].includes('0xababab…ababab'), 'type, token, amount, status, time and short hash', t0[0].slice(0, 120))
  check(t0[1].includes('Pending') && !/[-+]\d/.test(t0[1].replace(/\d+[smhd] ago|0x[0-9a-f…]+/g, '')), 'a pending bridge shows Pending and no invented amount')
  check(t0[2].includes('Failed') && t0[2].includes('+3') && t0[2].includes('EURC'), 'a failed entry shows Failed')
  check([...host.querySelectorAll('a')].every((a) => (a.textContent ?? '').includes('View on Arc Explorer') && /\/tx\/0x[0-9a-f]{64}$/.test((a as HTMLAnchorElement).href)), 'each links to its transaction on the Arc explorer')
}

console.log('Explore Arc (real destinations only)')
check(['Stablecoin Finance', 'Payments', 'DeFi', 'Onchain Apps'].every((t) => text().includes(t)), 'the four Explore Arc cards are there')
const hrefs = qa('section[aria-labelledby="explore-arc"] a').map((a) => (a as HTMLAnchorElement).href)
check(hrefs.length === 3 && hrefs.every((h) => h.startsWith('https://docs.arc.io/')), 'the external cards open official Arc docs', hrefs.join(' '))
check(qa('section[aria-labelledby="explore-arc"] a').every((a) => a.getAttribute('rel')?.includes('noopener') && a.getAttribute('target') === '_blank'), 'external links open safely in a new tab')
check(button('Payments', q('section[aria-labelledby="explore-arc"]') as ParentNode) !== undefined, 'Payments opens this app\'s own Pay page')

console.log('Asset page')
const usdcCard = cards.find((c) => (c.textContent ?? '').includes('USDC') && (c.textContent ?? '').includes('USD Coin')) as HTMLElement
;(usdcCard.querySelector('button[aria-label^="USD Coin"]') as HTMLButtonElement).click()
await waitFor(() => window.location.pathname === '/asset')
check(window.location.pathname === '/asset' && window.location.search === '?token=USDC', 'tapping an asset opens its page', window.location.pathname + window.location.search)
await waitFor(() => q('[data-testid="asset-contract"]') !== null)
check(q('[data-testid="asset-contract"]')?.textContent === USDC_ADDR, 'the real configured contract address is shown', q('[data-testid="asset-contract"]')?.textContent ?? '')
check(await waitFor(() => /USDC$/.test(q('[data-testid="asset-balance"]')?.textContent ?? '') && /^[\d,.]+ USDC$/.test(q('[data-testid="asset-balance"]')?.textContent ?? '')), 'the balance is shown', q('[data-testid="asset-balance"]')?.textContent ?? '')
check(await waitFor(() => /^\$[\d,]+\.\d{2}$/.test(q('[data-testid="asset-value"]')?.textContent ?? '')), 'the USD value is shown', q('[data-testid="asset-value"]')?.textContent ?? '')
const explorer = qa('a').find((a) => (a.textContent ?? '').includes('View on Arc Explorer') && (a as HTMLAnchorElement).href.endsWith(`/address/${USDC_ADDR}`))
check(Boolean(explorer), 'View on Arc Explorer opens the token contract')
check(text().includes('Recent USDC activity'), 'recent activity for the token is listed')
const main = () => q('main') as ParentNode
check(button('Bridge', main()) !== undefined && button('Send', main()) !== undefined && button('Swap', main()) !== undefined, 'USDC offers Send, Swap and Bridge')
go('/asset?token=EURC')
await waitFor(() => q('[data-testid="asset-contract"]')?.textContent !== USDC_ADDR && q('[data-testid="asset-contract"]') !== null)
check(q('[data-testid="asset-contract"]')?.textContent === '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', 'EURC shows its own configured contract')
check(button('Bridge', main()) === undefined && button('Swap', main()) !== undefined && button('Send', main()) !== undefined, 'EURC offers Send and Swap but not Bridge')
go('/asset?token=NOPE')
await waitFor(() => text().includes('not one of the tokens'))
check(text().includes('not one of the tokens'), 'an unknown token shows a clear message instead of a blank page')

console.log('Other routes still open')
for (const [path, marker] of [['/send', 'Recipient address'], ['/receive', 'Receiving instructions'], ['/swap', 'Swap'], ['/bridge', 'Bridge'], ['/pay', 'Pay'], ['/history', 'History'], ['/settings', 'Settings']] as const) {
  go(path)
  check(await waitFor(() => text().includes(marker), 20000), `${path} opens`)
}

console.log('Balances that cannot be read are never shown as zero')
go('/')
await waitFor(() => /^\$[\d,]+\.\d{2}$/.test(q('[data-testid="total-balance"]')?.textContent ?? ''))
failRpc = true
await queryClient.invalidateQueries()
check(await waitFor(() => (q('[data-testid="total-balance"]')?.textContent ?? '') === '—', 20000), 'when the network rejects the balance reads, the total shows a dash, not $0.00')
check(/could not be read right now/.test(text()) && button('Retry now') !== undefined, 'and says so, with a Retry now button')
failRpc = false
button('Retry now')?.click()
check(await waitFor(() => /^\$[\d,]+\.\d{2}$/.test(q('[data-testid="total-balance"]')?.textContent ?? '') && !/could not be read right now/.test(text()), 20000), 'Retry now brings the real balance back and the notice goes away')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
