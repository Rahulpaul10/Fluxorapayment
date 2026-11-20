import { ArrowUpRight, Newspaper } from 'lucide-react'
import { ARC_CONTENT, fmtDate } from '@/content/arcContent'
import { SourceTag } from './SourceTag'

/** Posts from Arc's own blog. Titles, topics, links and dates are read from arc.io; nothing is written here by hand. */
export function LatestNews() {
  const posts = ARC_CONTENT.posts
  return (
    <section id="latest" aria-labelledby="news-h" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="news-h" className="flex items-center gap-2 font-display text-xl font-bold tracking-[-0.02em] text-white"><Newspaper size={18} className="text-[var(--a)]" /> Latest from Arc</h2>
        <SourceTag kind="snapshot" retrievedAt={ARC_CONTENT.retrievedAt} source="arc.io/blog" />
      </div>
      <p className="px-1 text-xs text-slate-400">
        Saved from{' '}
        <a href={ARC_CONTENT.sources.blog} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--a)] underline underline-offset-2">the Arc blog</a>
        {' '}on {fmtDate(ARC_CONTENT.retrievedAt)}. Newer posts may exist: open the blog for the latest.
      </p>
      {posts.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-center text-sm text-slate-400" role="status">No posts were saved. Open the Arc blog to read the latest.</div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {posts.map((p, i) => (
            <li key={p.url} className={i === 0 ? 'sm:col-span-2' : undefined}>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className={`glass lift group flex h-full flex-col gap-2 rounded-2xl p-4 ${i === 0 ? 'surface-hero' : ''}`} data-testid="news-item">
                <span className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">{p.topic}</span>
                  <time dateTime={p.publishedAt}>{fmtDate(p.publishedAt)}</time>
                  <span aria-hidden="true">·</span>
                  <span>arc.io</span>
                </span>
                <span className={`font-display font-semibold text-white ${i === 0 ? 'text-lg sm:text-xl' : 'text-base'}`}>{p.title}</span>
                <span className="mt-auto flex items-center gap-1 text-xs font-semibold text-[var(--a)]">Read on arc.io <ArrowUpRight size={13} aria-hidden="true" /></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
