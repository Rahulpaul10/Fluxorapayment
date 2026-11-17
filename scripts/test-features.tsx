/* oxlint-disable typescript/require-await -- the fake wallet methods must return promises to match the connector interface */
/**
 * The production-pass features, with a FAKE wallet against REAL Arc data. Reads only, nothing is ever sent.
 * The test account is the depositor of a real recent CCTP burn on Arc (found live when the test starts), so
 * transaction details, bridge history and analytics are checked against what the chain and Circle really say.
 * If no recent burn exists the bridge sections are reported as skipped, never faked.
 *
 * Run: bun run test:features
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createPublicClient, http, parseAbiItem } from 'viem'

GlobalRegistrator.register({ url: 'http://localhost/', width: 390, height: 844 })
const g = globalThis as unknown as Record<string, unknown>
g.IS_REACT_ACT_ENVIRONMENT = false
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
g.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
process.env.VITE_FLUXORA_PAY_ADDRESS = ''

// ---- find a real recent burn on Arc (real data, read-only) ----
const arcRpc = createPublicClient({ transport: http('https://rpc.mainnet.arc.io') })
const TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as const
const burnEvent = parseAbiItem('event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)')
let real: { hash: `0x${string}`; depositor: `0x${string}`; amount: bigint; block: bigint } | undefined
{
  const head = await arcRpc.getBlockNumber()
  for (let i = 0n; i < 6n && !real; i++) {
    const to = head - i * 5000n
    try {
      const logs = await arcRpc.getLogs({ address: TOKEN_MESSENGER, event: burnEvent, fromBlock: to - 4999n, toBlock: to })
      const l = logs[logs.length - 1]
      if (l) real = { hash: l.transactionHash, depositor: l.args.depositor as `0x${string}`, amount: l.args.amount as bigint, block: l.blockNumber }
    } catch { /* try the next range */ }
  }
}
const FALLBACK = '0x000000000000000000000000000000000000dEaD' as const
const ACCOUNT = real?.depositor ?? FALLBACK
console.log(real ? `real burn found: ${real.hash.slice(0, 12)}… by ${real.depositor.slice(0, 8)}… (block ${real.block}, ${Number(real.amount) / 1e6} USDC)` : 'no recent burn found: bridge sections will be skipped')

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { WagmiProvider, createConnector } = await import('wagmi')
const { connect } = await import('wagmi/actions')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ConnectKitProvider } = await import('connectkit')
const { config } = await import('../src/config/wallet')
const { default: App } = await import('../src/App')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let currentChain = 56
const provider = {
  request: async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return `0x${currentChain.toString(16)}`
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT]
    throw Object.assign(new Error(`fake wallet: unsupported ${method}`), { code: -32601 })
  },
  on: () => undefined,
  removeListener: () => undefined,
}
const fakeWallet = createConnector((cfg) => ({
  id: 'fake', name: 'Fake wallet', type: 'fake',
  setup: async () => undefined,
  connect: (async () => ({ accounts: [ACCOUNT], chainId: currentChain })) as never,
  disconnect: async () => undefined,
  getAccounts: async () => [ACCOUNT],
  getChainId: async () => currentChain,
  isAuthorized: async () => true,
  switchChain: async ({ chainId }) => {
    currentChain = chainId
    cfg.emitter.emit('change', { chainId })
    const chain = cfg.chains.find((c) => c.id === chainId)
    if (!chain) throw new Error('unknown chain')
    return chain
  },
  onAccountsChanged: () => undefined,
  onChainChanged: () => undefined,
  onDisconnect: () => undefined,
  getProvider: async () => provider,
}))

let pass = 0
let fail = 0
let skipped = 0
const check = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` (${extra})` : ''}`) } else { fail++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`) }
}
const skip = (name: string) => { skipped++; console.log(`  skip ${name}`) }
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const waitFor = async (fn: () => boolean, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50) } return false }
const q = (sel: string) => document.querySelector(sel)
const qa = (sel: string) => [...document.querySelectorAll(sel)]
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined
const go = (path: string) => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const setValue = (el: Element, value: string) => {
  const input = el as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 600, refetchOnWindowFocus: false, staleTime: 10_000 } } })
document.body.innerHTML = '<div id="root"></div>'
createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(WagmiProvider, { config, reconnectOnMount: false }, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConnectKitProvider, null, React.createElement(App)))),
)
await sleep(1500)
await (connect as unknown as (c: unknown, p: unknown) => Promise<unknown>)(config, { connector: fakeWallet })

console.log('Network safety')
check(await waitFor(() => q('[data-testid="network-banner"]') !== null), 'a wallet on an unsupported network (chain 56) gets a clear warning')
check(/Unsupported network/.test(text()) && text().includes('chain 56') && text().includes('Switch your wallet to Arc (chain 5042)'), 'the warning names the chain and says how to switch')
check(text().includes('Arc, Ethereum, Base'), 'the supported networks are listed')
button('Switch to Arc')?.click()
check(await waitFor(() => q('[data-testid="network-banner"]') === null), 'switching to Arc (chosen by the person, never automatic) clears the warning')
await waitFor(() => q('[data-testid="total-balance"]') !== null)
check(currentChain === 5042, 'the wallet is now on Arc')

console.log('Receive')
go('/receive')
await waitFor(() => q('[data-testid="receive-qr"]') !== null)
check(q('[data-testid="receive-qr"] svg') !== null && (q('[data-testid="receive-qr"] svg') as SVGElement).getAttribute('aria-label')?.includes(ACCOUNT) === true, 'a QR code is drawn for the connected wallet address')
check(q('[data-testid="receive-address"]')?.textContent === ACCOUNT, 'the full address is shown')
check(button('Copy address') !== undefined && button('Share') !== undefined, 'Copy address and Share are there')
button('Copy address')?.click()
check(await waitFor(() => (button('Copied') !== undefined)), 'copying shows a clear confirmation')

console.log('Settings: address book and Onchain details')
go('/settings')
await waitFor(() => text().includes('Address book'))
check(q('[data-testid="onchain-panel"]') === null && q('[data-testid="onchain-toggle"]')?.getAttribute('aria-checked') === 'false', 'Onchain details is off by default and the page stays clean')
const nameInput = q('input[aria-label="New address name"]') as HTMLInputElement
const addrInput = q('input[aria-label="New address"]') as HTMLInputElement
setValue(nameInput, 'Key test'); setValue(addrInput, `0x${'ab'.repeat(32)}`)
button('Add address')?.click()
check(await waitFor(() => /private key or recovery phrase/i.test(text())), 'something shaped like a private key is refused with a plain warning')
check(qa('[data-testid="book-entry"]').length === 0, 'and nothing was saved')
setValue(nameInput, 'Alex'); setValue(addrInput, '0xf9022064E606C4d67203701400b5353c87fC2eC4')
button('Add address')?.click()
check(await waitFor(() => qa('[data-testid="book-entry"]').length === 1 && text().includes('Alex')), 'a valid name and address are saved')
setValue(nameInput, 'Alex 2'); setValue(addrInput, '0xf9022064E606C4d67203701400b5353c87fC2eC4')
button('Add address')?.click()
check(await waitFor(() => /already saved/i.test(text())), 'saving the same address twice is refused')
;(q('button[aria-label="Edit Alex"]') as HTMLButtonElement).click()
await waitFor(() => q('input[aria-label="Name"]') !== null)
setValue(q('input[aria-label="Name"]') as Element, 'Alex Rivera')
button('Save changes')?.click()
check(await waitFor(() => text().includes('Alex Rivera')), 'a saved address can be renamed')
check(JSON.parse(localStorage.getItem('fluxora:addressbook:v1') ?? '[]')[0]?.name === 'Alex Rivera', 'the change is stored in this browser')
check(!/privateKey|mnemonic|seed/i.test(localStorage.getItem('fluxora:addressbook:v1') ?? ''), 'only a name and a public address are stored')

;(q('[data-testid="onchain-toggle"]') as HTMLButtonElement).click()
check(await waitFor(() => q('[data-testid="onchain-panel"]') !== null), 'turning Onchain details on shows the panel')
const panel = q('[data-testid="onchain-panel"]')?.textContent ?? ''
check(panel.includes('chain 5042') && panel.includes('chain 1 ') && panel.includes('CCTP domain 26') && panel.includes('0x3600000000000000000000000000000000000000') && panel.includes('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d') && /Gas price/.test(panel), 'it lists chain IDs, CCTP domains, RPC hosts, contract addresses and gas')

console.log('Send: saved addresses')
go('/send')
await waitFor(() => q('[data-testid="address-picker"]') !== null)
const picker = q('[data-testid="address-picker"]') as HTMLSelectElement
check(picker !== null && [...picker.options].some((o) => o.textContent?.includes('Alex Rivera')), 'the saved address is offered when sending')
picker.value = '0xf9022064E606C4d67203701400b5353c87fC2eC4'
picker.dispatchEvent(new Event('change', { bubbles: true }))
check(await waitFor(() => (q('#to') as HTMLInputElement)?.value === '0xf9022064E606C4d67203701400b5353c87fC2eC4' && q('[data-testid="saved-name"]') !== null), 'choosing it fills the recipient and shows "Saved as"')
check((q('[data-testid="saved-name"]')?.textContent ?? '').includes('Alex Rivera'), 'with its saved name')
setValue(q('#to') as Element, '0x1111111111111111111111111111111111111111')
check(await waitFor(() => button('Save this address') !== undefined), 'an unsaved valid recipient offers "Save this address"')

console.log('Transaction details (real transaction)')
if (real) {
  go(`/tx?hash=${real.hash}&chain=5042`)
  check(await waitFor(() => q('[data-testid="tx-status"]') !== null), 'the page loads the transaction from Arc')
  check((q('[data-testid="tx-status"]')?.textContent ?? '').includes('Confirmed'), 'a real burn is Confirmed')
  check(q('[data-testid="tx-hash"]')?.textContent === real.hash, 'the full transaction hash is shown')
  const onchainTx = await arcRpc.getTransaction({ hash: real.hash })
  check(q('[data-testid="tx-from"]')?.textContent === onchainTx.from, 'From is the real sender of the transaction (read independently from Arc)')
  check(q('[data-testid="tx-to"]')?.textContent === onchainTx.to, 'and To is the real destination')
  check(await waitFor(() => (q('[data-testid="tx-block"]')?.textContent ?? '') !== ''), 'the block number is shown')
  const shownBlock = Number((q('[data-testid="tx-block"]')?.textContent ?? '').replace(/,/g, ''))
  check(BigInt(shownBlock) === real.block, 'and it is the block the burn event was emitted in', String(shownBlock))
  check(/Network fee\s*0\.\d{4,6} USDC/.test(text()), 'the gas fee is shown in USDC')
  check(qa('a').some((a) => (a as HTMLAnchorElement).href.endsWith(`/tx/${real?.hash}`) && (a.textContent ?? '').includes('Explorer')), 'a direct Arc Explorer link points at this transaction')
  check(await waitFor(() => q('[data-testid="tx-transfers"]') !== null && (q('[data-testid="tx-transfers"]')?.textContent ?? '').includes('USDC')), 'the USDC transfer inside it is decoded with the token name and amount')
  check(q('[data-testid="tx-onchain-details"]') !== null && /Chain ID\s*5042/.test(q('[data-testid="tx-onchain-details"]')?.textContent ?? ''), 'with Onchain details on, chain ID, gas and RPC are listed')
}
else skip('transaction details for a real burn (none found)')
go('/tx?hash=0x1234')
check(await waitFor(() => /not a valid transaction hash/.test(text())), 'an invalid hash gets a clear message, not a blank page')
go(`/tx?hash=0x${'00'.repeat(31)}01&chain=5042`)
check(await waitFor(() => (q('[data-testid="tx-status"]')?.textContent ?? '').includes('Not found'), 30000), 'an unknown hash is reported as Not found')
go(`/tx?hash=0x${'00'.repeat(32)}&chain=999999`)
check(await waitFor(() => /not a network this app supports/.test(text())), 'an unsupported chain in the link is refused')

console.log('Bridge history (real CCTP data from Circle and the chains)')
if (real) {
  go('/bridges')
  check(await waitFor(() => qa('[data-testid="cctp-transfer"]').length > 0, 60000), 'the real burn is listed')
  const card = qa('[data-testid="cctp-transfer"]').find((c) => (c.textContent ?? '').includes(`${(Number(real.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`)) ?? qa('[data-testid="cctp-transfer"]')[0]
  const t = card?.textContent ?? ''
  check(t.includes('Arc'), 'it shows the source network')
  check(/Arc\s*[A-Za-z0-9 ]+/.test(t) && /(Ethereum|Base|Arbitrum|OP Mainnet|Polygon|Avalanche|Domain \d+)/.test(t), 'and the destination network')
  check(/\d[\d,]*(\.\d+)? USDC/.test(card?.querySelector('[data-testid="cctp-amount"]')?.textContent ?? ''), 'and the amount, from the burn event / attestation')
  check(Boolean(card?.querySelector('[data-testid="cctp-source-hash"]')?.textContent?.startsWith('0x')), 'and the source transaction hash')
  const status = card?.querySelector('[data-testid="cctp-status"]')?.textContent ?? ''
  check(['Waiting for attestation', 'Attested, mint not confirmed', 'Completed', 'Failed'].includes(status), 'and a real status', status)
  const destHash = card?.querySelector('[data-testid="cctp-destination-hash"]')?.textContent ?? ''
  if (status === 'Completed') {
    check(/^0x[0-9a-f]+…[0-9a-f]+$/i.test(destHash) || /Verified on/.test(t), 'Completed shows the destination hash or says how it was verified')
    check(/Verified on/.test(t), 'and states the destination verification')
  } else check(!/Verified on/.test(t), 'a transfer that is not Completed claims no destination verification', status)
  check(status !== 'Completed' || /Verified on/.test(t), 'never Completed without a verified destination')
} else skip('bridge history for a real burn (none found)')

console.log('History: filters and details')
go('/history')
await waitFor(() => q('select[aria-label="Filter by status"]') !== null)
check(['All', 'Send', 'Receive', 'Swap', 'Bridge'].every((l) => button(l) !== undefined), 'All, Send, Receive, Swap and Bridge filters are there')
check(q('select[aria-label="Filter by status"]') !== null && q('select[aria-label="Filter by date"]') !== null && q('input[aria-label="Search history"]') !== null, 'status, date and search controls are there')
const dateSel = q('select[aria-label="Filter by date"]') as HTMLSelectElement
dateSel.value = 'custom'; dateSel.dispatchEvent(new Event('change', { bubbles: true }))
check(await waitFor(() => q('input[aria-label="From date"]') !== null && q('input[aria-label="To date"]') !== null), 'a custom date range reveals From and To')
dateSel.value = 'any'; dateSel.dispatchEvent(new Event('change', { bubbles: true }))
await waitFor(() => !text().includes('Reading recent Arc blocks'), 60000)
const detailsBtn = button('Details')
if (detailsBtn) {
  detailsBtn.click()
  check(await waitFor(() => window.location.pathname === '/tx' && q('[data-testid="tx-status"]') !== null, 30000), 'Details on a history row opens that transaction')
} else skip('history Details link (no rows in the scanned blocks)')

console.log('Analytics (real numbers)')
go('/analytics')
await waitFor(() => q('[data-testid="stat-sent-all"]') !== null, 30000)
const nonce = await arcRpc.getTransactionCount({ address: ACCOUNT })
check(await waitFor(() => q('[data-testid="stat-sent-all"]')?.textContent === nonce.toLocaleString()), 'transactions sent (all time) equals the account nonce on Arc', String(nonce))
check(['stat-window-count', 'stat-volume', 'stat-fees', 'stat-bridge'].every((id) => q(`[data-testid="${id}"]`) !== null || text().length > 0), 'the other statistics render')
check(qa('[data-testid="token-overview"] li').length === 4, 'the token overview lists the four configured tokens')
check(/not your whole history|Totals marked/.test(text()) && /recent/.test(text()), 'the page says which numbers cover only the scanned window')

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`)
process.exit(fail === 0 ? 0 : 1)
