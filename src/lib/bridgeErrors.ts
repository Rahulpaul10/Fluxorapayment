import type { Hex } from 'viem'

/** The parts of a bridge step the page needs. The kit's own step type is wider. */
export interface StepLike {
  name: string
  state: string
  txHash?: string
  error?: unknown
}

/** The first step that failed, or undefined when none did. */
export const failedStep = (steps: readonly StepLike[]): StepLike | undefined => steps.find((s) => s.state === 'error')

/** First line of whatever the kit or the node reported, so the screen shows the real reason and not a paraphrase. */
export function errorText(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : (error as { message?: unknown }).message
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines.find((l) => /reason|revert|rejected|exceed|insufficient|fee|amount|limit|paused|allowance/i.test(l)) ?? lines[0]).slice(0, 300)
}

/** The three reads needed to explain a transaction. A viem public client satisfies it; a test double can too. */
export interface TxReader {
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint }>
  getTransaction(args: { hash: Hex }): Promise<{ from: Hex; to?: Hex | null; input: Hex; value: bigint }>
  call(args: { account: Hex; to?: Hex; data: Hex; value: bigint; blockNumber: bigint }): Promise<unknown>
}

/** Circle's fee or attestation service (or an RPC) refusing a request because too many came too fast. Transient: nothing was burned. */
export const isRateLimited = (text: string | undefined): boolean => Boolean(text && /\b429\b|too many requests|rate.?limit/i.test(text))

/** How long Retry waits after the n-th rate limit in a row: 8s, 16s, 32s, then 32s. */
export const rateLimitWaitMs = (consecutive: number): number => Math.min(32_000, 8_000 * 2 ** Math.max(0, consecutive - 1))

export type TxOutcome =
  | { status: 'success' }
  | { status: 'reverted'; reason?: string }
  /** No receipt yet. The transaction may still be mined, so another burn must not be started. */
  | { status: 'pending' }
  /** The node could not be asked (rate limit, network). Treated like pending: do not submit another burn. */
  | { status: 'unknown'; reason: string }

/** The revert reason inside a viem error, from the node's own words. */
function revertReasonOf(e: unknown): string | undefined {
  const err = e as { details?: unknown; shortMessage?: unknown; message?: unknown; cause?: { details?: unknown; reason?: unknown; shortMessage?: unknown } }
  const candidates = [err.cause?.reason, err.details, err.cause?.details, err.cause?.shortMessage, err.shortMessage, err.message]
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const m = /execution reverted:?\s*(.*)/i.exec(c)
    if (m?.[1]?.trim()) return m[1].split('\n')[0].trim().slice(0, 200)
  }
  return undefined
}

/**
 * Ask the chain what really happened to a transaction: its receipt, and for a reverted one the node's own
 * revert reason (the call is replayed on the block before it was mined). Nothing here sends anything.
 */
export async function explainTx(client: TxReader, hash: Hex): Promise<TxOutcome> {
  try {
    const receipt = await client.getTransactionReceipt({ hash })
    if (receipt.status === 'success') return { status: 'success' }
    try {
      const tx = await client.getTransaction({ hash })
      await client.call({
        account: tx.from,
        to: tx.to ?? undefined,
        data: tx.input,
        value: tx.value,
        blockNumber: receipt.blockNumber > 0n ? receipt.blockNumber - 1n : receipt.blockNumber,
      })
      return { status: 'reverted' }
    } catch (e) {
      return { status: 'reverted', reason: revertReasonOf(e) }
    }
  } catch (e) {
    const name = (e as { name?: string }).name ?? ''
    if (name.includes('TransactionReceiptNotFound') || name.includes('TransactionNotFound')) return { status: 'pending' }
    return { status: 'unknown', reason: errorText(e) ?? 'The node did not answer.' }
  }
}

export type ResumeCheck = { ok: true; from: string } | { ok: false; message: string }

/**
 * Whether "Retry" may run. It only ever resumes the step that really failed. A burn whose transaction might still
 * be mined is never retried: a second burn would move the money twice.
 */
export function canResume(steps: readonly StepLike[], burn?: TxOutcome): ResumeCheck {
  const failed = failedStep(steps)
  if (!failed) return { ok: false, message: 'Nothing failed, so there is nothing to retry.' }
  if (failed.name === 'burn' || failed.name === 'transfer') {
    if (!failed.txHash) return { ok: true, from: failed.name } // never submitted: safe to start the burn again
    if (!burn || burn.status === 'pending') return { ok: false, message: 'The burn transaction has no receipt yet. Wait for it to be mined before retrying, so the money is not burned twice.' }
    if (burn.status === 'unknown') return { ok: false, message: `The burn transaction could not be checked (${burn.reason}). Retrying now could burn twice. Try again in a moment.` }
    if (burn.status === 'success') return { ok: false, message: 'The burn transaction succeeded onchain. Your USDC is already burned and will arrive after attestation: do not burn again.' }
  }
  return { ok: true, from: failed.name }
}
