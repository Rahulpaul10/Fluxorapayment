import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ArrowUpRight, Search } from 'lucide-react'
import { ARC_CONTENT, GROUPS, buildListings, type Group, type Listing } from '@/content/arcContent'
import { SourceTag } from './SourceTag'

const PAGE = 24
const PALETTE = ['#8257FF', '#27D9FF', '#FF55B8', '#20D6A0', '#FFB04D']
const colorFor = (name: string) => PALETTE[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length]

function Card({ l }: { l: Listing }) {
  const c = colorFor(l.name)
  return (
    <li>
      <a href={l.url} target="_blank" rel="noopener noreferrer" className="glass lift group flex h-full min-h-[150px] flex-col gap-2.5 rounded-2xl p-4" data-testid="eco-card">
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-bold text-[#ffffff]" style={{ background: `linear-gradient(135deg, ${c}, ${c}99)` }} aria-hidden="true">
            {l.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate font-display text-base font-semibold text-white">{l.name}</span>
          <ArrowUpRight size={16} className="shrink-0 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
        <span className="line-clamp-3 text-sm text-slate-400">{l.description || 'Listed by Arc as an ecosystem partner.'}</span>
        {l.groups.length > 0 && (
          <span className="mt-auto flex flex-wrap gap-1.5">
            {l.groups.map((g) => (
              <span key={g} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{g}</span>
            ))}
          </span>
        )}
        <span className="sr-only">Opens {l.name}'s website in a new tab</span>
      </a>
    </li>
  )
}

/** Every card comes from Arc's own ecosystem page or the provider lists in Arc's docs. The groups are Arc's own labels, nothing is guessed. */
export function Ecosystem() {
  const all = useMemo(() => buildListings(), [])
  const [group, setGroup] = useState<'all' | Group>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g, all.filter((l) => l.groups.includes(g)).length])) as Record<Group, number>, [all])
  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter((l) => (group === 'all' || l.groups.includes(group)) && (!term || l.name.toLowerCase().includes(term) || l.description.toLowerCase().includes(term)))
  }, [all, group, q])
  const chip = (id: 'all' | Group, label: string, n: number) => (
    <button
      key={id}
      type="button"
      aria-pressed={group === id}
      onClick={() => { setGroup(id); setShown(PAGE) }}
      className={clsx('min-h-[40px] shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors', group === id ? 'border-[var(--a)] bg-[var(--a)]/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10')}
    >
      {label} <span className="text-xs font-normal text-slate-400">{n}</span>
    </button>
  )
  return (
    <section id="ecosystem" aria-labelledby="eco-h" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="eco-h" className="font-display text-xl font-bold tracking-[-0.02em] text-white">Explore the ecosystem</h2>
        <SourceTag kind="snapshot" retrievedAt={ARC_CONTENT.retrievedAt} source="arc.io/ecosystem and docs.arc.io" />
      </div>
      <p className="px-1 text-sm text-slate-400">
        The {ARC_CONTENT.partnersListedByArc} partners on{' '}
        <a href={ARC_CONTENT.sources.ecosystem} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--a)] underline underline-offset-2">Arc's ecosystem page</a>
        , plus the providers Arc's developer docs list. Groups are Arc's own labels. Many partners have no group on Arc's page, so use search to find them.
      </p>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE) }} placeholder="Search partners, for example swap, wallet, custody" aria-label="Search the Arc ecosystem" className="field !pl-10" />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Ecosystem groups">
        {chip('all', 'All', all.length)}
        {GROUPS.map((g) => chip(g, g, counts[g]))}
      </div>
      {list.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-center text-sm text-slate-400" role="status">No listing matches. Try another word or group.</div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="eco-list">
          {list.slice(0, shown).map((l) => <Card key={l.name} l={l} />)}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" className="btn-ghost mx-auto flex !min-h-[44px]" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({list.length - shown} left)
        </button>
      )}
    </section>
  )
}
