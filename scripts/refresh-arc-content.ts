/**
 * Builds src/content/arc-content.json from Arc's own public pages. Nothing is typed in by hand: the partner list,
 * blog posts and documentation entries are read from arc.io and docs.arc.io, every entry keeps its source link, and
 * the file records when it was read. Run `bun run content:refresh` to update it (the app shows the retrieval date).
 */
import { writeFileSync } from 'node:fs'

const SITE = 'https://www.arc.io'
const DOCS = 'https://docs.arc.io'
const UA = { 'user-agent': 'Mozilla/5.0 (FLUXORA content refresh)' }

const get = async (url: string) => {
  const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(25_000) })
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`)
  return r.text()
}
const status = async (url: string) => {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    return r.status
  } catch {
    return 0
  }
}
const unescapeHtml = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].flatMap((m) => { try { const d = JSON.parse(m[1]); return d['@graph'] ?? [d] } catch { return [] } })

// ---- ecosystem partners ----
const ecoHtml = await get(`${SITE}/ecosystem`)
const officialNames = new Set<string>(
  (jsonLd(ecoHtml).find((n) => n['@type'] === 'ItemList')?.itemListElement ?? []).map((i: { name: string }) => unescapeHtml(i.name)),
)
const partners: { name: string; description: string; url: string; tags: string[] }[] = []
for (const part of ecoHtml.split('<div data-check="').slice(1)) {
  const name = part.match(/class="subhead-large u-mb-0">([^<]+)</)?.[1]
  const url = part.match(/<a [^>]*class="u-link-cover[^"]*"[^>]*href="(https?:\/\/[^"]+)"/)?.[1] ?? part.match(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*class="u-link-cover/)?.[1]
  if (!name || !url) continue
  const description = unescapeHtml(part.match(/<p class="u-hide">([^<]*)<\/p>/)?.[1] ?? '')
  const hidden = part.match(/<div class="u-hide"><div class="w-dyn-list">(.*?)<div fs-list-nest/s)?.[1] ?? ''
  const tags = [...hidden.matchAll(/<div role="listitem"[^>]*>(.*?)<\/div>/gs)].map((m) => unescapeHtml(m[1].replace(/<[^>]+>/g, ' '))).filter(Boolean)
  const n = unescapeHtml(name)
  if (partners.some((p) => p.name === n)) continue
  partners.push({ name: n, description, url: url.replace(/&amp;/g, '&').split('?utm_')[0], tags })
}
// The page's own cards are the complete list. Its structured-data list is shorter (it lags the page), so it is only recorded for reference.
// Arc's page links a few partners with http://. Use https:// when the site answers on it, otherwise keep Arc's link as published.
for (const p of partners) {
  if (!p.url.startsWith('http://')) continue
  const https = p.url.replace(/^http:\/\//, 'https://')
  const s = await status(https)
  if ((s >= 200 && s < 400) || s === 403 || s === 405) p.url = https
  else console.warn(`kept Arc's http link for ${p.name} (https answered ${s})`)
}
const listed = partners
const cardCount = ecoHtml.split('<div data-check="').length - 1
if (listed.length < cardCount - 3) throw new Error(`parsed ${listed.length} of ${cardCount} partner cards: the page layout changed, check the parser`)

// ---- latest blog posts (dates come from each article's own structured data) ----
const blogHtml = await get(`${SITE}/blog`)
const cards = [...blogHtml.matchAll(/<div class="blog-card_topic-row"><div>([^<]*)<\/div>.*?<h2 class="blog-card_header">([^<]+)<\/h2>.*?href="(\/blog\/[^"#?]+)" class="u-link-cover/gs)]
const posts: { title: string; url: string; topic: string; publishedAt: string }[] = []
for (const [, topic, , path] of cards.slice(0, 14)) {
  const page = await get(`${SITE}${path}`)
  const post = jsonLd(page).find((n) => n['@type'] === 'BlogPosting')
  if (!post?.datePublished || !post.headline) continue
  posts.push({ title: unescapeHtml(post.headline), url: `${SITE}${path}`, topic: unescapeHtml(topic), publishedAt: new Date(post.datePublished).toISOString() })
}
posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

// ---- documentation entries: titles and one-line descriptions are Arc's own, links are checked ----
const llms = await get(`${DOCS}/llms.txt`)
const entries = new Map<string, { title: string; summary: string }>()
for (const m of llms.matchAll(/^- \[([^\]]+)\]\((https:\/\/docs\.arc\.io\/[^)]+?)\.md\): (.+)$/gm)) entries.set(m[2], { title: m[1], summary: m[3].trim() })
const pick = (paths: string[]) => paths.map((p) => `${DOCS}/${p}`).filter((u) => entries.has(u)).map((u) => ({ ...entries.get(u)!, url: u }))
const sections = {
  overview: pick(['arc/concepts/stablecoin-native-model', 'arc/concepts/stable-fee-design', 'arc/concepts/deterministic-finality', 'arc/concepts/system-overview', 'arc/concepts/opt-in-privacy', 'arc/concepts/post-quantum-security']),
  network: pick(['arc/references/connect-to-arc', 'arc/references/rpc-endpoints', 'arc/references/contract-addresses', 'arc/references/gas-and-fees', 'arc/references/evm-differences']),
  developer: pick(['arc/tutorials/deploy-on-arc', 'arc/tutorials/deploy-contracts', 'arc/references/sample-applications', 'arc/tutorials/monitor-contract-events', 'arc/tutorials/send-usdc-with-transaction-memo', 'ai/mcp']),
  tools: pick(['arc/tools/account-abstraction', 'arc/tools/compliance-vendors', 'arc/tools/data-indexers', 'arc/tools/node-providers']),
}
const linkChecks = await Promise.all(Object.values(sections).flat().map(async (d) => ({ url: d.url, status: await status(d.url) })))
const brokenDocs = linkChecks.filter((l) => l.status !== 200)
if (brokenDocs.length) throw new Error(`documentation links that do not answer 200: ${brokenDocs.map((l) => `${l.url} ${l.status}`).join(', ')}`)

// ---- providers Arc's own docs list, by tool category (names, links and descriptions are the docs' own) ----
const TOOL_PAGES = [
  { id: 'node-providers', group: 'Infrastructure' },
  { id: 'data-indexers', group: 'Infrastructure' },
  { id: 'account-abstraction', group: 'Wallets and account abstraction' },
  { id: 'compliance-vendors', group: 'Compliance' },
] as const
const tools = []
for (const t of TOOL_PAGES) {
  const md = await get(`${DOCS}/arc/tools/${t.id}.md`)
  const title = md.match(/^# (.+)$/m)?.[1] ?? t.id
  const providers = [...md.matchAll(/^### \[([^\]]+)\]\((https?:\/\/[^)]+)\)\n([\s\S]*?)(?=\n\* |\n### |\n## |(?![\s\S]))/gm)].map((m) => ({ name: m[1].trim(), url: m[2], description: m[3].replace(/\s+/g, ' ').trim() }))
  if (!providers.length) throw new Error(`no providers parsed from ${t.id}: the docs layout changed`)
  tools.push({ id: t.id, group: t.group, title, url: `${DOCS}/arc/tools/${t.id}`, providers })
}

const out = {
  retrievedAt: new Date().toISOString(),
  sources: { ecosystem: `${SITE}/ecosystem`, blog: `${SITE}/blog`, docs: `${DOCS}/llms.txt`, home: SITE },
  partnersListedByArc: cardCount,
  partnersInStructuredData: officialNames.size,
  partners: listed,
  posts: posts.slice(0, 12),
  docs: sections,
  tools,
}
writeFileSync(new URL('../src/content/arc-content.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`partners ${listed.length}/${cardCount} cards (${listed.filter((p) => p.tags.length).length} with Arc's own tags), posts ${out.posts.length} (newest ${out.posts[0]?.publishedAt.slice(0, 10)}), docs ${Object.values(sections).flat().length} links all 200, tool providers ${tools.reduce((n, t) => n + t.providers.length, 0)}`)
