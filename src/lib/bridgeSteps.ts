/**
 * The bridge as three steps a person can follow: Approve, Burn, Receive.
 *
 * The Circle kit reports four: approve, burn, fetchAttestation, mint (or approve, transfer, fetchAttestation,
 * forward for CCTPx tokens). Receive is the last two together: Circle signs the burn, then the USDC is minted on the
 * destination. Each state comes from what the kit really reported. Nothing here advances on a timer, and a step is
 * "Confirmed" only after the kit said it succeeded.
 */
export type StepState = 'waiting' | 'processing' | 'confirmed' | 'failed'
export type StepKey = 'approve' | 'burn' | 'receive'

export interface KitStep {
  name: string
  state: string
  txHash?: string
  explorerUrl?: string
  error?: string
}

export interface BridgeStepView {
  key: StepKey
  label: string
  state: StepState
  txHash?: string
  explorerUrl?: string
  /** true when the transaction hash belongs to the destination chain */
  onDestination?: boolean
  error?: string
  /** What is happening right now inside a step that is in progress (from the kit's own step reports) */
  detail?: string
}

const LABELS: Record<StepKey, string> = { approve: 'Approve', burn: 'Burn', receive: 'Receive' }

const isOk = (s: string) => s === 'success'
const isBad = (s: string) => s === 'error' || s === 'failed'

/** A kit step state to a visible state. Anything that is not a finished result is "processing". */
const fromKit = (step: KitStep | undefined): StepState | undefined => {
  if (!step) return undefined
  if (isOk(step.state)) return 'confirmed'
  if (isBad(step.state)) return 'failed'
  return 'processing'
}

export function bridgeSteps(steps: readonly KitStep[], running: boolean): BridgeStepView[] {
  const by = (...names: string[]) => steps.find((s) => names.includes(s.name))
  const approve = by('approve')
  const burn = by('burn', 'transfer')
  const attest = by('fetchAttestation')
  const mint = by('mint', 'forward')

  const approveState = fromKit(approve) ?? (running ? 'processing' : 'waiting')

  let burnState: StepState = fromKit(burn) ?? 'waiting'
  if (!burn && approveState === 'confirmed' && running) burnState = 'processing'

  // Receive: failed if either part failed; confirmed only when the mint (or forward) succeeded.
  let receiveState: StepState = 'waiting'
  const parts = [attest, mint].filter((s): s is KitStep => Boolean(s))
  if (parts.some((s) => isBad(s.state))) receiveState = 'failed'
  else if (mint && isOk(mint.state)) receiveState = 'confirmed'
  else if (parts.length > 0) receiveState = 'processing'
  else if (burnState === 'confirmed' && running) receiveState = 'processing'

  const view = (key: StepKey, state: StepState, step: KitStep | undefined, extra?: Partial<BridgeStepView>): BridgeStepView => ({
    key,
    label: LABELS[key],
    state,
    txHash: step?.txHash,
    explorerUrl: step?.explorerUrl,
    error: step?.error,
    ...extra,
  })
  // While Receive is in progress, say which half it is in: Circle's attestation, or the mint on the destination.
  const receiveDetail = receiveState === 'processing' ? (attest && isOk(attest.state) ? 'Circle has attested the burn. Minting on the destination now.' : 'Waiting for Circle to attest the burn.') : undefined
  const receiveStep = [attest, mint].find((s) => s && isBad(s.state)) ?? mint ?? attest
  return [
    view('approve', approveState, approve),
    view('burn', burnState, burn),
    view('receive', receiveState, receiveStep, { txHash: mint?.txHash, explorerUrl: mint?.explorerUrl, onDestination: true, detail: receiveDetail }),
  ]
}

/** True only while a real step is in flight. Drives the route animation: it never runs for a finished or failed bridge. */
export const isProcessing = (views: readonly BridgeStepView[]): boolean => views.some((v) => v.state === 'processing')

/** The step that failed, if any, with the headline the page shows for it. */
export function failureTitle(views: readonly BridgeStepView[]): { key: StepKey; title: string } | undefined {
  const failed = views.find((v) => v.state === 'failed')
  if (!failed) return undefined
  return { key: failed.key, title: failed.key === 'approve' ? 'Approval failed' : failed.key === 'burn' ? 'Burn failed' : 'Receive failed' }
}
