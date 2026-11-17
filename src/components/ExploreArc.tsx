import type { ReactNode } from 'react'
import { Boxes, Coins, ExternalLink, Layers, WalletCards } from 'lucide-react'
import type { View } from '@/lib/router'

/**
 * Where to go next. Every destination is real: the Payments card opens this app's Pay page, and the others open
 * pages that exist in the official Arc documentation (checked when this was written). No projects are listed.
 */
const ITEMS: { title: string; blurb: string; icon: ReactNode; href?: string; view?: View }[] = [
  { title: 'Stablecoin Finance', blurb: 'How Arc treats USDC and EURC as native assets', icon: <Coins size={18} />, href: 'https://docs.arc.io/arc/concepts/stablecoin-native-model' },
  { title: 'Payments', blurb: 'Request, collect and receipt payments here', icon: <WalletCards size={18} />, view: 'pay' },
  { title: 'DeFi', blurb: 'Port pools and protocols to Arc', icon: <Layers size={18} />, href: 'https://docs.arc.io/integrate/defi' },
  { title: 'Onchain Apps', blurb: 'Build with Arc and the App Kits', icon: <Boxes size={18} />, href: 'https://docs.arc.io/app-kit' },
]

const card = 'glass tap flex min-h-[88px] flex-col justify-between gap-2 rounded-2xl p-3.5 text-left hover:border-white/20'

export function ExploreArc({ navigate }: { navigate: (view: View, search?: string) => void }) {
  return (
    <section aria-labelledby="explore-arc">
      <h2 id="explore-arc" className="label mb-2 px-1">
        Explore Arc
      </h2>
      <ul className="grid grid-cols-2 gap-2.5">
        {ITEMS.map((i) => {
          const body = (
            <>
              <span className="flex items-center justify-between text-[var(--a)]">
                {i.icon}
                {i.href && <ExternalLink size={13} className="text-slate-500" aria-hidden="true" />}
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">{i.title}</span>
                <span className="mt-0.5 block text-pretty text-[11px] leading-snug text-slate-400">{i.blurb}</span>
              </span>
            </>
          )
          return (
            <li key={i.title} className="min-w-0">
              {i.href ? (
                <a className={card} href={i.href} target="_blank" rel="noopener noreferrer">
                  {body}
                </a>
              ) : (
                <button type="button" className={`${card} w-full`} onClick={() => i.view && navigate(i.view)}>
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
