import clsx from 'clsx'
import { Check, CircleDashed, X } from 'lucide-react'
import { explorerTx } from '@/config/networks'
import { isProcessing, type BridgeStepView, type StepState } from '@/lib/bridgeSteps'
import { ExplorerLink, Spinner } from '@/components/ui'

const STATE_TEXT: Record<StepState, string> = { waiting: 'Waiting', processing: 'Processing', confirmed: 'Confirmed', failed: 'Failed' }
const STATE_STYLE: Record<StepState, string> = {
  waiting: 'bg-white/5 text-slate-400',
  processing: 'bg-amber-300/15 text-amber-300',
  confirmed: 'bg-flux-green/15 text-flux-green',
  failed: 'bg-flux-pink/15 text-flux-pink',
}

function Dot({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
        state === 'confirmed' && 'border-flux-green/40 bg-flux-green/15 text-flux-green',
        state === 'failed' && 'border-flux-pink/40 bg-flux-pink/15 text-flux-pink',
        state === 'processing' && 'soft-ring border-[var(--a)]/50 bg-[var(--a)]/15 text-[var(--a)]',
        state === 'waiting' && 'border-white/10 bg-white/5 text-slate-400',
      )}
      aria-hidden="true"
    >
      {state === 'confirmed' ? <Check size={16} /> : state === 'failed' ? <X size={16} /> : state === 'processing' ? <Spinner className="!h-4 !w-4" /> : n}
    </span>
  )
}

/** Approve, Burn, Receive. Each state is what the bridge really reported; nothing advances on its own. */
export function BridgeStepper({ steps, fromId, toId }: { steps: BridgeStepView[]; fromId: number; toId: number }) {
  return (
    <ol className="space-y-2.5" aria-label="Bridge progress">
      {steps.map((s, i) => {
        const chain = s.onDestination ? toId : fromId
        return (
          <li key={s.key} className="glass-inner rounded-2xl p-3" data-testid={`bridge-step-${s.key}`} data-state={s.state}>
            <div className="flex items-center gap-3">
              <Dot state={s.state} n={i + 1} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{s.label}</p>
                <p className="text-xs text-slate-400">
                  {s.key === 'approve' ? 'Allow the bridge to use this amount of USDC' : s.key === 'burn' ? 'USDC is burned on the source network' : 'Circle signs the burn, then USDC is minted on the destination'}
                </p>
              </div>
              <span className={clsx('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', STATE_STYLE[s.state])}>{STATE_TEXT[s.state]}</span>
            </div>
            {(s.txHash || s.error) && (
              <div className="mt-2 pl-12 text-xs">
                {s.txHash && (
                  <div className="flex flex-wrap items-center gap-x-3">
                    <span className="break-all font-mono text-slate-400">{s.txHash.slice(0, 10)}…{s.txHash.slice(-6)}</span>
                    <ExplorerLink href={s.explorerUrl ?? explorerTx(chain, s.txHash)}>View transaction</ExplorerLink>
                  </div>
                )}
                {s.error && <p className="mt-1 break-words text-flux-pink">{s.error}</p>}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Node({ name, tone }: { name: string; tone: 'network' | 'circle' }) {
  return (
    <span className={clsx('glass-inner inline-flex min-h-[40px] min-w-[132px] items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white', tone === 'circle' && 'soft-glow')}>
      {tone === 'circle' && <CircleDashed size={15} className="text-[var(--a)]" />}
      {name}
    </span>
  )
}

function lineClass(state: 'idle' | 'active' | 'done' | 'failed') {
  return clsx('route-line', state === 'active' && 'is-active', state === 'done' && 'is-done', state === 'failed' && 'is-failed')
}

/**
 * Arc, Circle CCTP, Ethereum. A line moves only while a real step is processing, turns green when that leg is
 * confirmed and pink if it failed. Before anything is sent the route is static.
 */
export function BridgeRoute({ fromName, toName, steps }: { fromName: string; toName: string; steps: BridgeStepView[] }) {
  const [approve, burn, receive] = steps
  const first = burn.state === 'confirmed' ? 'done' : burn.state === 'failed' || approve.state === 'failed' ? 'failed' : approve.state === 'processing' || burn.state === 'processing' ? 'active' : 'idle'
  const second = receive.state === 'confirmed' ? 'done' : receive.state === 'failed' ? 'failed' : receive.state === 'processing' ? 'active' : 'idle'
  return (
    <div className="flex flex-col items-center py-1" role="img" aria-label={`Route: ${fromName}, Circle CCTP, ${toName}${isProcessing(steps) ? '. Transfer in progress' : ''}`} data-testid="bridge-route" data-active={isProcessing(steps)}>
      <Node name={fromName} tone="network" />
      <span className={lineClass(first)} />
      <Node name="Circle CCTP" tone="circle" />
      <span className={lineClass(second)} />
      <Node name={toName} tone="network" />
    </div>
  )
}
