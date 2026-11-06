import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, ExternalLink, Info, Loader2 } from 'lucide-react'
import { TokenEURC, TokenETH, TokenUSDC } from '@web3icons/react'
import clsx from 'clsx'
import { toast } from 'sonner'
import type { TokenInfo } from '@/lib/tokens'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('glass rounded-3xl p-5 sm:p-6', className)}>{children}</section>
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-white sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-prose text-pretty text-sm text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

type NoticeTone = 'info' | 'warn' | 'error' | 'success'
const toneStyles: Record<NoticeTone, string> = {
  info: 'border-neon/30 bg-neon/10 text-white',
  warn: 'border-amber-300/30 bg-amber-300/10 text-white',
  error: 'border-flux-pink/40 bg-flux-pink/10 text-white',
  success: 'border-flux-green/40 bg-flux-green/10 text-white',
}

export function Notice({ tone = 'info', children, action }: { tone?: NoticeTone; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : AlertTriangle
  return (
    <div className={clsx('flex items-start gap-3 rounded-2xl border p-3.5 text-sm', toneStyles[tone])}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
      {action}
    </div>
  )
}

export function TokenIcon({ token, size = 32 }: { token: Pick<TokenInfo, 'symbol' | 'color'>; size?: number }) {
  if (token.symbol === 'USDC') return <TokenUSDC variant="branded" size={size} />
  if (token.symbol === 'EURC') return <TokenEURC variant="branded" size={size} />
  if (token.symbol === 'WETH') return <TokenETH variant="branded" size={size} />
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display text-xs font-bold text-[#ffffff]"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${token.color}, #0B1230)` }}
    >
      {token.symbol.slice(0, 2).toUpperCase()}
    </span>
  )
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={clsx('btn-ghost', className)}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setDone(true)
            toast.success('Copied')
            setTimeout(() => setDone(false), 1500)
          })
          .catch(() => toast.error('Copy failed. Select the text and copy it manually.'))
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
      {done ? 'Copied' : label}
    </button>
  )
}

export function ExplorerLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="-my-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-neon hover:brightness-125"
    >
      {children ?? 'View on explorer'}
      <ExternalLink size={14} />
    </a>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className)} size={18} />
}

export function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={clsx('min-w-0 text-right font-medium text-white tabular', mono && 'font-mono text-[13px]')}>{value}</span>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="glass-inner inline-flex w-full rounded-xl p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'min-h-[42px] flex-1 rounded-xl px-3 text-sm font-semibold transition',
            value === o.value ? 'theme-chip' : 'text-slate-400 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
