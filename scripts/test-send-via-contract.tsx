/* oxlint-disable typescript/require-await -- the fake wallet methods must return promises to match the connector interface */
/**
 * Send through YOUR FluxoraPay contract, with a FAKE wallet.
 *
 * Proves what the wallet is asked to sign when VITE_FLUXORA_PAY_ADDRESS is set:
 *  - first an exact-amount `approve(FluxoraPay, amount)` on USDC when there is no allowance (real Arc state: the test account has none),
 *  - then `pay(recipient, amount, note)` addressed to the FluxoraPay contract,
 * and that each request is a standard one (only from, to and data). Nothing is broadcast: the fake wallet records the
 * request and rejects or returns a made-up hash.
 *
 * The "already approved" case needs an allowance the real chain does not hold for this test account, so those two
 * node answers (the allowance read and the gas estimate for `pay`) are answered locally and labelled as such below.
 *
 * Run: bun run test:pay
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register({ url: 'http://localhost/send', width: 390, height: 844 })
const g = globalThis as unknown as Record<string, unknown>
g.IS_REACT_ACT_ENVIRONMENT = false
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
g.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

const PAY = '0x4b986094f0258b83ef82cc866aB5c654FcFa52e1' as const
process.env.VITE_FLUXORA_PAY_ADDRESS = PAY

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { WagmiProvider, createConnector } = await import('wagmi')
const { connect } = await import('wagmi/actions')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ConnectKitProvider } = await import('connectkit')
const { encodeFunctionData, decodeFunctionData, encodeFunctionResult, parseAbi, erc20Abi } = await import('viem')
const { config } = await import('../src/config/wallet')
const { fluxoraPayAbi, payGasFallback, memoByteLength } = await import('../src/config/fluxoraPay')
const { default: App } = await import('../src/App')

const ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const // public address; only read from and used as the fake wallet's account
const RECIPIENT = '0x1111111111111111111111111111111111111111' as const
const USDC_ADDR = '0x3600000000000000000000000000000000000000'
const FAKE_HASH = `0x${'ab'.repeat(32)}`

interface Sent { tx: Record<string, string> }
const wallet = { chainId: 5042, account: ACCOUNT as string, mode: 'reject' as 'approve' | 'reject', sent: [] as Sent[] }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hex = (n: number) => `0x${n.toString(16)}`

// Local node answers, ONLY for the "already approved" scenario (see the file header).
const faked = { allowance: false, payGas: false }
interface Rpc { id: number; method: string; params?: Array<Record<string, string>> }
// viem batches contract reads into one Multicall3 call, so the allowance read arrives inside aggregate3.
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11'
const multicallAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)'])
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const body = typeof init?.body === 'string' ? init.body : ''
  if (!body || (!faked.allowance && !faked.payGas)) return realFetch(input, init)
  let parsed: Rpc | Rpc[]
  try { parsed = JSON.parse(body) as Rpc | Rpc[] } catch { return realFetch(input, init) }
  const one = async (r: Rpc): Promise<unknown> => {
    const p = r.params?.[0] ?? {}
    const data = (p.data ?? p.input ?? '').toLowerCase()
    if (faked.allowance && r.method === 'eth_call' && data.startsWith('0xdd62ed3e') && (p.to ?? '').toLowerCase() === USDC_ADDR)
      return { jsonrpc: '2.0', id: r.id, result: `0x${(10n ** 12n).toString(16).padStart(64, '0')}` }
    if (faked.payGas && r.method === 'eth_estimateGas' && (p.to ?? '').toLowerCase() === PAY.toLowerCase())
      return { jsonrpc: '2.0', id: r.id, result: hex(190_000) }
    if (faked.allowance && r.method === 'eth_call' && (p.to ?? '').toLowerCase() === MULTICALL3) {
      try {
        const decoded = decodeFunctionData({ abi: multicallAbi, data: data as `0x${string}` })
        const calls = decoded.args[0] as readonly { target: string; allowFailure: boolean; callData: `0x${string}` }[]
        if (calls.some((c) => c.callData.toLowerCase().startsWith('0xdd62ed3e') && c.target.toLowerCase() === USDC_ADDR)) {
          const results = await Promise.all(
            calls.map(async (c) => {
              if (c.callData.toLowerCase().startsWith('0xdd62ed3e') && c.target.toLowerCase() === USDC_ADDR)
                return { success: true, returnData: `0x${(10n ** 12n).toString(16).padStart(64, '0')}` as `0x${string}` }
              const res = await realFetch(input, { ...init, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.target, data: c.callData }, r.params?.[1] ?? 'latest'] }) })
              const j = (await res.json()) as { result?: `0x${string}` }
              return { success: j.result !== undefined, returnData: j.result ?? ('0x' as const) }
            }),
          )
          return { jsonrpc: '2.0', id: r.id, result: encodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', result: results }) }
        }
      } catch { /* not an aggregate3 call: fall through to the real node */ }
    }
    const res = await realFetch(input, { ...init, body: JSON.stringify(r) })
    return res.json()
  }
  const out = Array.isArray(parsed) ? await Promise.all(parsed.map(one)) : await one(parsed)
  return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const provider = {
  request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case 'eth_chainId': return hex(wallet.chainId)
      case 'eth_accounts':
      case 'eth_requestAccounts': return [wallet.account]
      case 'eth_sendTransaction': {
        wallet.sent.push({ tx: (params?.[0] ?? {}) as Record<string, string> })
        await sleep(300)
        if (wallet.mode === 'reject') throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        return FAKE_HASH
      }
      default: throw Object.assign(new Error(`fake wallet: unsupported ${method}`), { code: -32601 })
    }
  },
  on: () => undefined,
  removeListener: () => undefined,
}

const fakeWallet = createConnector((cfg) => ({
  id: 'fake',
  name: 'Fake wallet',
  type: 'fake',
  setup: async () => undefined,
  connect: (async () => ({ accounts: [wallet.account as `0x${string}`], chainId: wallet.chainId })) as never,
  disconnect: async () => undefined,
  getAccounts: async () => [wallet.account as `0x${string}`],
  getChainId: async () => wallet.chainId,
  isAuthorized: async () => true,
  switchChain: async ({ chainId }) => {
    wallet.chainId = chainId
    cfg.emitter.emit('change', { chainId })
    const chain = cfg.chains.find((c) => c.id === chainId)
    if (!chain) throw new Error('unknown chain')
    return chain
  },
  onAccountsChanged: (accounts: string[]) => cfg.emitter.emit('change', { accounts: accounts as `0x${string}`[] }),
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
const keys = (tx: Record<string, string>) => Object.keys(tx).sort().join(',')

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 500, refetchOnWindowFocus: false, staleTime: 0 } } })
document.body.innerHTML = '<div id="root"></div>'
createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(
    WagmiProvider,
    { config, reconnectOnMount: false },
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConnectKitProvider, null, React.createElement(App))),
  ),
)

async function openSend() {
  go('/receive')
  await sleep(300)
  go('/send')
  await waitFor(() => document.getElementById('to') !== null)
}
async function fill(to: string, amount: string, note = '') {
  setValue('to', to)
  setValue('amt', amount)
  if (note) setValue('memo', note)
  await sleep(1200) // debounced gas estimate
  await waitFor(() => button('Review transfer')?.disabled === false)
}

await sleep(1500)
await (connect as unknown as (c: unknown, p: unknown) => Promise<unknown>)(config, { connector: fakeWallet })
await waitFor(() => text().includes('0x0000…dEaD'))

console.log('Send page is configured for your contract')
await openSend()
check(text().includes('through your own FLUXORA Pay contract'), 'the page says USDC is paid through your contract')
check(document.getElementById('memo') !== null, 'there is a note field')
check(text().includes('Paid through') && text().includes('0x4b98…52e1'), 'the contract address is shown before you pay')

console.log('Note and recipient validation')
await fill(RECIPIENT, '0.01', 'x'.repeat(141))
check(text().includes('141 bytes') && button('Review transfer')?.disabled === true, 'a note over 140 bytes is refused')
setValue('memo', '€'.repeat(47)) // 47 x 3 bytes = 141 bytes although only 47 characters
await sleep(300)
check(text().includes('141 bytes'), 'the limit counts bytes, not characters', `${memoByteLength('€'.repeat(47))} bytes`)
setValue('to', PAY)
await sleep(300)
check(text().includes('That is your FLUXORA Pay contract'), 'paying the contract itself is refused')

console.log('No allowance yet: the first wallet request is an exact approval')
wallet.sent.length = 0
await openSend()
await fill(RECIPIENT, '0.01', 'order 17')
check(button('Review transfer')?.disabled === false, 'a valid payment can be reviewed')
button('Review transfer')?.click()
await waitFor(() => button('Confirm and sign') !== undefined)
check(text().includes('2: approve, then pay'), 'the review says two wallet prompts are needed')
check(text().includes('order 17'), 'the note is shown on the review')
button('Confirm and sign')?.click()
await waitFor(() => wallet.sent.length >= 1, 15000)
const approve = wallet.sent[0]?.tx ?? {}
const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PAY, 10_000n] })
check(wallet.sent.length === 1, 'the wallet got exactly one request')
check((approve.to ?? '').toLowerCase() === USDC_ADDR, 'the approval is addressed to USDC')
check((approve.data ?? '').toLowerCase() === approveData.toLowerCase(), 'it approves your contract for exactly 0.01 USDC (10000 units, no more)')
check((approve.from ?? '').toLowerCase() === ACCOUNT.toLowerCase(), 'sent from the connected account')
check(keys(approve) === 'data,from,to', 'a standard request: only from, to and data', keys(approve))
await sleep(1500)
check(wallet.sent.length === 1, 'when the approval is rejected, no payment is requested', `${wallet.sent.length} request`)
check(!text().includes('Step 2 of 2'), 'the page does not move on to step 2')

console.log('Already approved: the wallet request is the payment, through your contract')
faked.allowance = true
faked.payGas = true
wallet.sent.length = 0
await openSend()
await fill(RECIPIENT, '0.01', 'order 18')
button('Review transfer')?.click()
await waitFor(() => button('Confirm and sign') !== undefined)
check(text().includes('1: pay'), 'the review says one wallet prompt')
button('Confirm and sign')?.click()
await waitFor(() => wallet.sent.length >= 1, 15000)
const pay = wallet.sent[0]?.tx ?? {}
const payData = encodeFunctionData({ abi: fluxoraPayAbi, functionName: 'pay', args: [RECIPIENT, 10_000n, 'order 18'] })
check(wallet.sent.length === 1, 'the wallet got exactly one request')
check((pay.to ?? '').toLowerCase() === PAY.toLowerCase(), 'the payment is addressed to YOUR contract, not to USDC')
check((pay.data ?? '').toLowerCase() === payData.toLowerCase(), 'calldata is pay(recipient, 10000, "order 18")')
check((pay.from ?? '').toLowerCase() === ACCOUNT.toLowerCase(), 'sent from the connected account')
check(keys(pay) === 'data,from,to', 'a standard request: only from, to and data (no gas, fee or value fields)', keys(pay))
faked.allowance = false
faked.payGas = false

console.log('Settings tab shows your FluxoraPay contract')
go('/settings')
await waitFor(() => text().includes('Payment contract'))
check(text().includes('FluxoraPay'), 'the contract name is shown')
const shownAddress = document.querySelector('[data-testid="fluxorapay-address"]')?.textContent ?? ''
check(shownAddress.toLowerCase() === PAY.toLowerCase(), 'the full contract address is shown exactly', shownAddress)
check(text().includes('Copy address'), 'there is a copy button')
const explorerLink = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('View on explorer'))
check(explorerLink?.getAttribute('href')?.endsWith(`/address/${PAY}`) === true, 'the explorer link points at the contract', explorerLink?.getAttribute('href') ?? '')
check(await waitFor(() => text().includes('Live onchain'), 15000), 'the page confirms the contract is live on Arc mainnet')
check(text().includes('matches the app'), 'the page confirms it pays the same USDC as the app')
check(/Payments made through it\s*\d+/.test(text()), 'it shows the payment count read from the contract')
go('/')
await sleep(300)
check(document.querySelector('button[aria-label="Settings"]') !== null, 'the gear button is always in the top bar')
;(document.querySelector('button[aria-label="Settings"]') as HTMLButtonElement).click()
check(await waitFor(() => window.location.pathname === '/settings'), 'the gear opens /settings', window.location.pathname)

console.log('Gas model for the two steps')
check(payGasFallback(0) >= 188_526n && payGasFallback(11) >= 209_223n, 'the fallback is at least the measured gas for pay (188,526 / 209,223)')
check(payGasFallback(140) > payGasFallback(32) && payGasFallback(32) > payGasFallback(11), 'a longer note costs more gas')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
