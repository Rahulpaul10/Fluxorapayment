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
const qa = (sel: string) => [...document.querySelectorAll(sel)]
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
const go = (path: string) => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 600, refetchOnWindowFocus: false, staleTime: 10_000 } } })
document.body.innerHTML = '<div id="root"></div>'
createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(WagmiProvider, { config, reconnectOnMount: false }, React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConnectKitProvider, null, React.createElement(App)))),
)

await sleep(1500)
const { ARC_CONTENT, buildListings, GROUPS } = await import('../src/content/arcContent')
// Reading Arc's public pages from the test needs the test browser's same-origin rule off (the app itself never fetches these pages).
;(window as unknown as { happyDOM: { settings: { fetch: { disableSameOriginPolicy: boolean } } } }).happyDOM.settings.fetch.disableSameOriginPolicy = true

/* ===== 1. The saved content is Arc's own and well formed (no network) ===== */
console.log('Saved content: shape and provenance')
{
  const c = ARC_CONTENT
  check(c.partners.length === c.partnersListedByArc, 'every partner card Arc lists was saved', `${c.partners.length} of ${c.partnersListedByArc}`)
  check(new Set(c.partners.map((p) => p.name)).size === c.partners.length, 'partner names are unique')
  check(c.partners.every((p) => /^https:\/\//.test(p.url)), 'every partner link is https')
  check(c.posts.length > 0 && c.posts.every((p) => p.url.startsWith('https://www.arc.io/blog/') && !Number.isNaN(Date.parse(p.publishedAt))), 'every post links to arc.io/blog and has a real date')
  check(c.posts.every((p, i) => i === 0 || c.posts[i - 1].publishedAt >= p.publishedAt), 'posts are newest first')
  check(c.posts.every((p) => Date.parse(p.publishedAt) <= Date.parse(c.retrievedAt)), 'no post is dated after the day the list was saved')
  const docLinks = Object.values(c.docs).flat()
  check(docLinks.length >= 15 && docLinks.every((d) => d.url.startsWith('https://docs.arc.io/') && d.summary.length > 10), 'documentation entries are Arc docs pages with Arc\'s own descriptions', String(docLinks.length))
  check(c.tools.every((t) => t.providers.length > 0 && t.providers.every((p) => /^https:\/\//.test(p.url) && p.description.length > 5)), 'every provider in the tool lists has a link and a description')
  const listings = buildListings(c)
  check(new Set(listings.map((l) => l.name.toLowerCase())).size === listings.length, 'the combined listing has no duplicates', String(listings.length))
  check(GROUPS.every((g) => listings.some((l) => l.groups.includes(g))), 'each group has at least one listing')
  check(listings.filter((l) => l.groups.length).every((l) => l.groups.every((g) => (GROUPS as readonly string[]).includes(g))), 'only Arc\'s own groups are used')
}

/* ===== 2. The saved copy still matches the live official pages (read only) ===== */
console.log('Saved content vs the live official sources')
{
  const ua = { 'user-agent': 'Mozilla/5.0 (FLUXORA test)' }
  const eco = await (await realFetch(ARC_CONTENT.sources.ecosystem, { headers: ua })).text()
  const liveNames = new Set([...eco.matchAll(/<div data-check="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").trim().toLowerCase()))
  const missing = ARC_CONTENT.partners.filter((p) => !liveNames.has(p.name.toLowerCase()))
  check(missing.length === 0, 'every saved partner is still on Arc\'s ecosystem page', missing.map((m) => m.name).join(', '))
  check(Math.abs(liveNames.size - ARC_CONTENT.partnersListedByArc) <= 5, 'the page lists about the same number of partners as the saved copy', `${liveNames.size} now, ${ARC_CONTENT.partnersListedByArc} saved`)
  const docs = await Promise.all(Object.values(ARC_CONTENT.docs).flat().map(async (d) => ({ d, s: (await realFetch(d.url, { headers: ua })).status })))
  check(docs.every((x) => x.s === 200), 'all documentation links answer 200', docs.filter((x) => x.s !== 200).map((x) => `${x.d.url} ${x.s}`).join(', '))
  const posts = await Promise.all(ARC_CONTENT.posts.map(async (p) => {
    const r = await realFetch(p.url, { headers: ua })
    const html = r.ok ? await r.text() : ''
    const m = html.match(/"datePublished":\s*"([^"]+)"/)
    return { p, status: r.status, date: m?.[1] }
  }))
  check(posts.every((x) => x.status === 200), 'every saved news link answers 200', posts.filter((x) => x.status !== 200).map((x) => x.p.url).join(', '))
  check(posts.every((x) => x.date && new Date(x.date).toISOString() === x.p.publishedAt), 'every saved date equals the article\'s own published date')
  const reach = await Promise.all(ARC_CONTENT.partners.map(async (p) => {
    try { return { p, s: (await realFetch(p.url, { headers: ua, redirect: 'follow', signal: AbortSignal.timeout(15_000) })).status } } catch { return { p, s: 0 } }
  }))
  // Many sites refuse automated requests with 403/405/429 while working in a browser: those still count as reachable.
  const dead = reach.filter((r) => r.s === 0 || r.s === 404 || r.s >= 500)
  console.log(`      partner sites: ${reach.length - dead.length} of ${reach.length} answered${dead.length ? `; no answer from ${dead.map((d) => `${d.p.name} (${d.s})`).join(', ')}` : ''}`)
  check(dead.length <= Math.ceil(reach.length * 0.1), 'at least 90% of partner sites answer', `${dead.length} did not`)
}

/* ===== 3. The page, with no wallet connected ===== */
console.log('Explore Arc with no wallet connected')
{
  go('/')
  check(await waitFor(() => text().includes('Everything about Arc, in one wallet.'), 20000), 'the home page is Explore Arc')
  check(!text().includes('One Wallet. Every Possibility.'), 'there is no separate connect landing page')
  check(await waitFor(() => text().includes('MetaMask') && text().includes('WalletConnect')), 'MetaMask and WalletConnect are still offered on the page')
  const header = q('header') as HTMLElement
  check(Boolean(header && [...header.querySelectorAll('button')].some((b) => /connect/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))), 'Connect wallet is in the top bar')
  for (const h of ['What is Arc?', 'Arc network', 'Explore the ecosystem', 'Developer hub', 'Latest from Arc']) check(text().includes(h), `section: ${h}`)
  check(text().includes('Arc Mainnet') && text().includes('Chain ID') && (q('[data-testid="explore-chain-id"]')?.textContent ?? '').startsWith('5042'), 'Arc Mainnet and Chain ID 5042 are shown')
  check(await waitFor(() => /^\d[\d,]*$/.test((q('[data-testid="explore-block"]')?.textContent ?? '').trim()), 20000), 'the current block is a real number read from Arc', q('[data-testid="explore-block"]')?.textContent ?? '')
  check(await waitFor(() => /same chain/.test(q('[data-testid="explore-chain-id"]')?.textContent ?? ''), 20000), 'the RPC reports chain 5042')
  check(qa('[data-source="live"]').length >= 3 && qa('[data-source="snapshot"]').length >= 4, 'live data and saved copies are labelled differently', `${qa('[data-source="live"]').length} live, ${qa('[data-source="snapshot"]').length} saved`)
  check(text().includes(`${ARC_CONTENT.partnersListedByArc} partners`), 'the ecosystem intro states the number Arc lists')
  check(qa('[data-testid="eco-card"]').length === 24, 'the first 24 ecosystem cards show', String(qa('[data-testid="eco-card"]').length))
  check(qa('[data-testid="news-item"]').length === ARC_CONTENT.posts.length, 'every saved post is listed', String(qa('[data-testid="news-item"]').length))
  check(qa('time').length === ARC_CONTENT.posts.length && qa('time').every((t) => !Number.isNaN(Date.parse(t.getAttribute('datetime') ?? ''))), 'every post shows a dated time element')
  const ext = qa('main a[href^="http"]') as HTMLAnchorElement[]
  check(ext.length > 40 && ext.every((a) => a.target === '_blank' && /noopener/.test(a.rel)), 'every external link opens in a new tab with noopener', String(ext.length))
  check(ext.every((a) => a.href.startsWith('https://')), 'every external link is https')

  // search and groups
  const search = q('input[type="search"]') as HTMLInputElement
  const setVal = (el: HTMLInputElement, v: string) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d?.set?.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
  setVal(search, 'aave')
  check(await waitFor(() => qa('[data-testid="eco-card"]').length >= 1 && qa('[data-testid="eco-card"]').length < 5), 'searching narrows the cards')
  check(qa('[data-testid="eco-card"]').some((c) => /Aave/.test(c.textContent ?? '')), 'Aave is found')
  setVal(search, 'zzzzqqqq')
  check(await waitFor(() => text().includes('No listing matches')), 'a search with no result shows an empty state')
  setVal(search, '')
  const grp = button('Stablecoins and tokenized assets') as HTMLButtonElement
  grp.click()
  check(await waitFor(() => grp.getAttribute('aria-pressed') === 'true'), 'a group chip can be selected')
  const n = qa('[data-testid="eco-card"]').length
  check(n > 0 && n < 24, 'the group filter shows only that group', String(n))
  ;(button('All', q('[role="group"]') as ParentNode) as HTMLButtonElement).click()
  await waitFor(() => qa('[data-testid="eco-card"]').length === 24)
  button('Show more')?.click()
  check(await waitFor(() => qa('[data-testid="eco-card"]').length === 48), 'Show more reveals the next 24')

  // section chips
  let scrolled = ''
  const real = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element) { scrolled = this.id }
  ;(q('nav[aria-label="Sections of this page"] button:nth-child(5)') as HTMLButtonElement).click()
  check(scrolled === 'latest', 'the Latest chip jumps to the Latest section')
  Element.prototype.scrollIntoView = real
}

/* ===== 4. Connected: the wallet home is unchanged and Explore stays reachable ===== */
console.log('Explore Arc with a wallet connected')
{
  await (connect as unknown as (c: unknown, p: unknown) => Promise<unknown>)(config, { connector: fakeWallet })
  go('/')
  check(await waitFor(() => text().includes('Total balance')), 'a connected wallet sees the dashboard at the home page')
  check(!text().includes('Everything about Arc, in one wallet.'), 'the dashboard is not replaced by Explore Arc')
  check(Boolean([...document.querySelectorAll('aside nav button')].some((b) => b.textContent?.trim() === 'Explore')), 'the sidebar has an Explore entry')
  button('Explore all')?.click()
  check(await waitFor(() => text().includes('Everything about Arc, in one wallet.')), 'Explore all on the dashboard opens Explore Arc')
  check(window.location.pathname === '/explore', 'its address is /explore', window.location.pathname)
  check(Boolean(button('Open my wallet')), 'a connected wallet gets an Open my wallet shortcut')
  check(!text().includes('Connect to use your wallet'), 'the connect card is hidden once connected')
  button('Open my wallet')?.click()
  check(await waitFor(() => text().includes('Total balance')), 'Open my wallet returns to the dashboard')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
