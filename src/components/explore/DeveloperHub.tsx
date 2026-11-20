import { ArrowUpRight, BookOpen, Code2, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ARC_CONTENT, type DocLink } from '@/content/arcContent'
import { SourceTag } from './SourceTag'

/** Official starting points that arc.io itself links from its navigation. */
const OFFICIAL = [
  { title: 'Arc documentation', url: 'https://docs.arc.io', note: 'Guides, APIs and specs' },
  { title: 'Arc Studio', url: 'https://studio.arc.io/', note: 'Build AI-powered Arc apps' },
  { title: 'Circle faucet', url: 'https://faucet.circle.com/', note: 'Testnet USDC and EURC' },
] as const

function Block({ title, icon: Icon, links }: { title: string; icon: LucideIcon; links: DocLink[] }) {
  return (
    <div className="glass rounded-3xl p-4">
      <h3 className="mb-2 flex items-center gap-2 font-display text-base font-semibold text-white"><Icon size={16} className="text-[var(--a)]" /> {title}</h3>
      <ul className="divide-y divide-white/5">
        {links.map((d) => (
          <li key={d.url}>
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="group flex min-h-[56px] items-start justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{d.title}</span>
                <span className="line-clamp-2 text-xs text-slate-400">{d.summary}</span>
              </span>
              <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              <span className="sr-only">Opens in a new tab</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DeveloperHub() {
  const d = ARC_CONTENT.docs
  return (
    <section id="developers" aria-labelledby="dev-h" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="dev-h" className="font-display text-xl font-bold tracking-[-0.02em] text-white">Developer hub</h2>
        <SourceTag kind="snapshot" retrievedAt={ARC_CONTENT.retrievedAt} source="docs.arc.io" />
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-3">
        {OFFICIAL.map((o) => (
          <li key={o.url}>
            <a href={o.url} target="_blank" rel="noopener noreferrer" className="surface-hero lift flex min-h-[72px] items-center justify-between gap-3 rounded-2xl p-4">
              <span>
                <span className="block font-display text-base font-semibold text-white">{o.title}</span>
                <span className="text-xs text-slate-400">{o.note}</span>
              </span>
              <ArrowUpRight size={16} className="shrink-0 text-[var(--a)]" aria-hidden="true" />
              <span className="sr-only">Opens in a new tab</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 lg:grid-cols-3">
        <Block title="Build and deploy" icon={Code2} links={d.developer} />
        <Block title="Network references" icon={BookOpen} links={d.network} />
        <Block title="Tools and providers" icon={Wrench} links={d.tools} />
      </div>
    </section>
  )
}
