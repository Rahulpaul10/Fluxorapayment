import clsx from 'clsx'
import { fmtDate } from '@/content/arcContent'

/** Says where a piece of information comes from, so live network data is never confused with a saved copy of Arc's pages. */
export function SourceTag({ kind, retrievedAt, source }: { kind: 'live' | 'snapshot' | 'config'; retrievedAt?: string; source?: string }) {
  if (kind === 'live') {
    return (
      <span className="pill !text-[11px]" data-source="live" title="Read from the Arc network right now">
        <span className={clsx('relative h-1.5 w-1.5 rounded-full bg-flux-green dot-live')} /> Live
      </span>
    )
  }
  if (kind === 'config') {
    return (
      <span className="pill !text-[11px]" data-source="config" title="Fixed network setting used by this app">
        App setting
      </span>
    )
  }
  return (
    <span className="pill !text-[11px]" data-source="snapshot" title={`Saved copy of ${source ?? 'Arc'}${retrievedAt ? `, retrieved ${fmtDate(retrievedAt)}` : ''}`}>
      Saved copy{retrievedAt ? ` · ${fmtDate(retrievedAt)}` : ''}
    </span>
  )
}
