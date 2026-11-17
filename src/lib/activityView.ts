import { fmtToken, shortHash } from '@/lib/format'
import type { HistoryRow } from '@/hooks/useHistoryRows'
import { kindLabel } from '@/components/HistoryKindBadge'
import { tokenByAddress } from '@/lib/tokens'

export type TimelineStatus = 'Pending' | 'Confirmed' | 'Failed'

export interface TimelineEntry {
  key: string
  /** Send, Receive, Swap, Bridge, Payment, ... */
  type: string
  /** Token symbol(s), or undefined when the record carries no token data (nothing is guessed). */
  token?: string
  /** Signed amount text such as "-12.5" or "+3", or undefined when unknown. */
  amount?: string
  direction?: 'in' | 'out' | 'swap'
  timestamp: number
  status: TimelineStatus
  /** Why a Failed entry failed, in words the user can act on. */
  statusNote?: string
  hash?: string
  shortHash?: string
  chainId: number
  summary: string
}

/**
 * One row of the real activity list, shaped for the timeline. Everything comes from the row: onchain Transfer legs,
 * or what this app recorded when it submitted the transaction. A field the row does not have stays undefined.
 */
export function toTimelineEntry(row: HistoryRow): TimelineEntry {
  const outs = row.legs.filter((l) => l.direction === 'out')
  const ins = row.legs.filter((l) => l.direction === 'in')
  let token: string | undefined
  let amount: string | undefined
  let direction: TimelineEntry['direction']
  if (outs.length && ins.length) {
    token = `${outs[0].token.symbol} → ${ins[0].token.symbol}`
    amount = `-${fmtToken(outs[0].amount, outs[0].token.decimals, 4)} / +${fmtToken(ins[0].amount, ins[0].token.decimals, 4)}`
    direction = 'swap'
  } else if (outs.length) {
    token = outs[0].token.symbol
    amount = `-${fmtToken(outs[0].amount, outs[0].token.decimals, 4)}`
    direction = 'out'
  } else if (ins.length) {
    token = ins[0].token.symbol
    amount = `+${fmtToken(ins[0].amount, ins[0].token.decimals, 4)}`
    direction = 'in'
  } else if (row.receipt) {
    // A payment receipt read from the contract has no Transfer leg here, but it does state token and amount.
    const t = tokenByAddress(row.receipt.token)
    token = t?.symbol
    amount = `${row.receipt.direction === 'sent' ? '-' : '+'}${fmtToken(row.receipt.amount, t?.decimals ?? 6, 4)}`
    direction = row.receipt.direction === 'sent' ? 'out' : 'in'
  }
  const status: TimelineStatus = row.status === 'pending' ? 'Pending' : row.status === 'success' ? 'Confirmed' : 'Failed'
  return {
    key: row.key,
    type: kindLabel(row.kind),
    token,
    amount,
    direction,
    timestamp: row.timestamp,
    status,
    statusNote: row.status === 'dropped' ? 'The network never saw this transaction.' : undefined,
    hash: row.hash,
    shortHash: row.hash ? shortHash(row.hash) : undefined,
    chainId: row.chainId,
    summary: row.summary,
  }
}

/** Rows that moved a given token (by symbol), for the asset page. Rows without token data are not guessed into a token. */
export function rowsForToken(rows: HistoryRow[], symbol: string): HistoryRow[] {
  return rows.filter((r) => r.legs.some((l) => l.token.symbol === symbol))
}
