import { ArrowLeft } from 'lucide-react'
import { goBack, type View } from '@/lib/router'

/** "Back" at the top of every page except the dashboard. */
export function BackButton({ navigate }: { navigate: (v: View) => void }) {
  return (
    <button
      type="button"
      onClick={() => goBack(navigate)}
      className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
    >
      <ArrowLeft size={18} /> Back
    </button>
  )
}
