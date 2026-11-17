import { decodeFunctionData, erc20Abi, formatGwei, isHash, parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { fluxoraPayAbi } from '@/config/fluxoraPay'
import { tokenByAddress, type TokenInfo } from '@/lib/tokens'
import { arcGasCostUsdc } from '@/lib/fees'

export type TxStatus = 'success' | 'failed' | 'pending' | 'not-found'

export interface TxTransfer {
  token: TokenInfo | undefined
  tokenAddress: Address
  from: Address
  to: Address
  amount: bigint
}

export interface TxDetails {
  hash: Hex
  status: TxStatus
  from?: Address
  to?: Address | null
  /** Native value in 18-decimal units; on Arc this is USDC moved natively (usually 0 for token transfers) */
  nativeValue?: bigint
  blockNumber?: bigint
  timestamp?: number
  nonce?: number
  gasLimit?: bigint
  gasUsed?: bigint
  effectiveGasPrice?: bigint
  /** The network fee paid, in 6-decimal USDC units (Arc's gas token) */
  feeUsdc?: bigint
  /** Known function called, if the selector is recognised */
  method?: string
  transfers: TxTransfer[]
}

/** Minimal client surface, so the logic can be tested without a network. */
export interface TxReader {
  getTransaction(args: { hash: Hex }): Promise<{ from: Address; to?: Address | null; value: bigint; nonce: number; gas: bigint; input: Hex }>
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint; logs: Log[] }>
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>
}

export const parseTxHash = (value: string | null | undefined): Hex | undefined => (value && isHash(value) ? (value as Hex) : undefined)

function methodName(input: Hex | undefined): string | undefined {
  if (!input || input === '0x') return 'Native transfer'
  for (const abi of [erc20Abi, fluxoraPayAbi] as const) {
    try {
      return (decodeFunctionData({ abi: abi as never, data: input }) as { functionName: string }).functionName
    } catch {
      // not this ABI
    }
  }
  return `Contract call (${input.slice(0, 10)})`
}

const isNotFound = (e: unknown) => /could not be found|not found|TransactionNotFound|TransactionReceiptNotFound/i.test(String((e as Error)?.name ?? '') + String((e as Error)?.message ?? ''))

/**
 * Everything shown on the details page is read from the chain: the transaction, its receipt and its block.
 * Nothing is inferred when a lookup fails: a network error is thrown so the page can offer Retry, and only a
 * genuine "not found" answer is reported as not found.
 */
export async function loadTxDetails(client: TxReader, hash: Hex): Promise<TxDetails> {
  let tx: Awaited<ReturnType<TxReader['getTransaction']>>
  try {
    tx = await client.getTransaction({ hash })
  } catch (e) {
    if (!isNotFound(e)) throw e
    return { hash, status: 'not-found', transfers: [] }
  }

  let receipt: Awaited<ReturnType<TxReader['getTransactionReceipt']>> | undefined
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (e) {
    if (!isNotFound(e)) throw e
  }

  const base = {
    hash,
    from: tx.from,
    to: tx.to,
    nativeValue: tx.value,
    nonce: tx.nonce,
    gasLimit: tx.gas,
    method: methodName(tx.input),
  }
  if (!receipt) return { ...base, status: 'pending', transfers: [] }

  let timestamp: number | undefined
  try {
    timestamp = Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp)
  } catch {
    // the block time is optional: everything else is still real
  }

  const logs = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs as never })
  const transfers: TxTransfer[] = logs.map((l) => ({
    token: tokenByAddress(l.address),
    tokenAddress: l.address,
    from: l.args.from,
    to: l.args.to,
    amount: l.args.value,
  }))

  return {
    ...base,
    status: receipt.status === 'success' ? 'success' : 'failed',
    blockNumber: receipt.blockNumber,
    timestamp,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    feeUsdc: arcGasCostUsdc(receipt.gasUsed, receipt.effectiveGasPrice).raw,
    transfers,
  }
}

export const gweiText = (price: bigint | undefined) => (price === undefined ? '—' : `${Number(formatGwei(price)).toLocaleString(undefined, { maximumFractionDigits: 4 })} gwei`)
