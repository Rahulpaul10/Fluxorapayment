import { ArrowUpRight, Gauge, Layers, ShieldCheck, Sparkles, Timer, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ARC_CONTENT } from '@/content/arcContent'
import { SourceTag } from './SourceTag'

const ICONS: LucideIcon[] = [Wallet, Gauge, Timer, Layers, ShieldCheck, Sparkles]

/** "What is Arc?" in Arc's own words: every sentence below is a description published in Arc's documentation, with its link. */
export function Overview() {
  const docs = ARC_CONTENT.docs.overview
  const [lead, ...rest] = docs
  if (!lead) return null
  return (
    <section id="overview" aria-labelledby="ov-h" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="ov-h" className="font-display text-xl font-bold tracking-[-0.02em] text-white">What is Arc?</h2>
        <SourceTag kind="snapshot" retrievedAt={ARC_CONTENT.retrievedAt} source="docs.arc.io" />
      </div>
      <figure className="surface-hero rounded-3xl p-5">
        <blockquote className="text-pretty font-display text-lg font-semibold leading-snug text-white sm:text-xl">{lead.summary}</blockquote>
        <figcaption className="mt-3 text-xs text-slate-400">
          From Arc's documentation:{' '}
          <a href={lead.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--a)] underline underline-offset-2">
            {lead.title}
          </a>
        </figcaption>
      </figure>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((d, i) => {
          const Icon = ICONS[(i + 1) % ICONS.length]
          return (
            <li key={d.url}>
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="glass lift group flex h-full min-h-[132px] flex-col gap-2 rounded-2xl p-4">
                <span className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--a)]/15 text-[var(--a)]"><Icon size={18} /></span>
                  <ArrowUpRight size={16} className="text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="font-display text-base font-semibold text-white">{d.title}</span>
                <span className="line-clamp-4 text-sm text-slate-400">{d.summary}</span>
                <span className="sr-only">Opens Arc documentation in a new tab</span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
