import raw from './arc-content.json'

/** What `bun run content:refresh` reads from arc.io and docs.arc.io. Each entry keeps the link to where it came from. */
export interface DocLink { title: string; summary: string; url: string }
export interface Partner { name: string; description: string; url: string; tags: string[] }
export interface Post { title: string; url: string; topic: string; publishedAt: string }
export interface ToolProvider { name: string; url: string; description: string }
export interface ToolCategory { id: string; group: string; title: string; url: string; providers: ToolProvider[] }
export interface ArcContent {
  retrievedAt: string
  sources: { ecosystem: string; blog: string; docs: string; home: string }
  partnersListedByArc: number
  partners: Partner[]
  posts: Post[]
  docs: { overview: DocLink[]; network: DocLink[]; developer: DocLink[]; tools: DocLink[] }
  tools: ToolCategory[]
}

export const ARC_CONTENT = raw as ArcContent

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })

/** Ecosystem groups. Only Arc's own labels are used: its ecosystem page tags, and the tool categories in its docs. */
export const GROUPS = ['Stablecoins and tokenized assets', 'Infrastructure', 'Wallets and account abstraction', 'Analytics and data', 'Compliance'] as const
export type Group = (typeof GROUPS)[number]
const TAG_GROUP: Record<string, Group> = {
  'Stablecoin Issuers': 'Stablecoins and tokenized assets',
  'Tokenized Assets': 'Stablecoins and tokenized assets',
  'RPC Providers': 'Infrastructure',
  Validators: 'Infrastructure',
  Analytics: 'Analytics and data',
}
export interface Listing { name: string; description: string; url: string; groups: Group[]; fromPartnerPage: boolean }

export function buildListings(c: ArcContent = ARC_CONTENT): Listing[] {
  const map = new Map<string, Listing>()
  for (const p of c.partners) {
    const groups = [...new Set(p.tags.map((t) => TAG_GROUP[t]).filter((g): g is Group => Boolean(g)))]
    map.set(p.name.toLowerCase(), { name: p.name, description: p.description, url: p.url, groups, fromPartnerPage: true })
  }
  for (const t of c.tools) {
    const group = t.group as Group
    for (const pr of t.providers) {
      const key = pr.name.toLowerCase()
      const hit = map.get(key)
      if (hit) {
        if (!hit.groups.includes(group)) hit.groups.push(group)
        if (!hit.description) hit.description = pr.description
      } else map.set(key, { name: pr.name, description: pr.description, url: pr.url, groups: [group], fromPartnerPage: false })
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}
