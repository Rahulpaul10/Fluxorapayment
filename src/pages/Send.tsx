import { useEffect, useState } from 'react'
import { erc20Abi, getAddress, isAddress, zeroAddress, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { useGuardedWrite } from '@/hooks/useGuardedWallet'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { Amount } from '@/onchain-money'
import { useTokenBalances } from '@/hooks/useBalances'
import { ARC_TOKENS, USDC, type TokenInfo } from '@/lib/tokens'
import { ARC_CHAIN_ID, explorerAddress } from '@/config/networks'
import { FLUXORA_PAY_ADDRESS, MAX_MEMO_BYTES, fluxoraPayAbi, memoByteLength, payGasFallback } from '@/config/fluxoraPay'
import { arcGasCostUsdc, fmtGasUsdc, getFees, prepaidGasReserveUsdc } from '@/lib/fees'
import { checkSend, maxSendable } from '@/lib/sendReserve'
import { verifySender } from '@/lib/accountSync'
import { fmtToken, shortAddr } from '@/lib/format'
import { parseTxError } from '@/lib/errors'
import { recordActivity } from '@/lib/activity'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { useUsdcCompliance } from '@/hooks/useUsdcCompliance'
import type { DeliveryExpectation } from '@/lib/circleUsdc'
import { AddressBookPicker } from '@/components/AddressBookParts'
import { ArcGate } from '@/components/Gate'
import { TokenButton, TokenPicker } from '@/components/TokenSelect'
import { WalletSpeedTest } from '@/components/WalletSpeedTest'
import { TxStatus } from '@/components/TxStatus'
import { Card, ExplorerLink, Notice, PageTitle, Row, Spinner } from '@/components/ui'

const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const SYSTEM_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe'
/** Only used to price gas before a recipient has been typed (a fresh account costs the most). It is never sent to. */
const ESTIMATE_RECIPIENT: Address = '0x2222222222222222222222222222222222222222'

/** Follows `value` after it has stopped changing for `ms`, so typing does not fire one RPC call per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function Send({ presetTo, presetAmount, presetToken }: { presetTo?: string; presetAmount?: string; presetToken?: string }) {
  return (
    <>
      <PageTitle
        title="Send"
        subtitle={
          FLUXORA_PAY_ADDRESS
            ? 'Send USDC through your own FLUXORA Pay contract, or any supported token with a standard transfer.'
            : 'Send USDC or any supported token on Arc. On Arc, USDC is the native asset, so it is sent with a standard token transfer.'
        }
      />
      <ArcGate feature="Send">
        <SendForm presetTo={presetTo} presetAmount={presetAmount} presetToken={presetToken} />
      </ArcGate>
    </>
  )
}

function SendForm({ presetTo, presetAmount, presetToken }: { presetTo?: string; presetAmount?: string; presetToken?: string }) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  // The wallet prices a plain transfer itself: the request carries only from, to and data (no gas or fee fields), so its
  // own simulation and fee estimate run on a standard request. The page still estimates gas to catch a transfer that
  // would revert, and keeps a USDC reserve for the gas the wallet will prepay.
  const { writeContractAsync } = useGuardedWrite({ walletManagedFees: true })
  const balances = useTokenBalances()

  const [symbol, setSymbol] = useState(ARC_TOKENS.find((t) => t.symbol === presetToken)?.symbol ?? USDC.symbol)
  const [to, setTo] = useState(presetTo ?? '')
  const [amount, setAmount] = useState(presetAmount ?? '')
  const [picker, setPicker] = useState(false)
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [busy, setBusy] = useState(false)
  const once = useSingleFlight()
  // What the confirmed transfer should have delivered, fixed at the moment it is sent (the form may change afterwards).
  const [delivery, setDelivery] = useState<DeliveryExpectation>()
  const [hash, setHash] = useState<Hex>()
  const [error, setError] = useState<string>()
  const [hint, setHint] = useState<string>()
  const [memo, setMemo] = useState('')
  const [phase, setPhase] = useState<'approve' | 'pay' | 'pay-after-approve'>()

  const row = balances.rows.find((r) => r.token.symbol === symbol) ?? balances.rows[0]
  const token: TokenInfo = row.token
  const usdcRow = balances.rows.find((r) => r.token.symbol === 'USDC')
  const balance = row.raw

  // USDC goes through your own FluxoraPay contract when its address is configured; every other token is a plain transfer.
  const payAddr = FLUXORA_PAY_ADDRESS
  const viaPay = Boolean(payAddr) && token.address.toLowerCase() === USDC.address.toLowerCase()
  const note = memo.trim()
  const noteBytes = memoByteLength(note)

  // What the gas estimate is priced on: the real recipient and amount once they are valid and affordable, otherwise a
  // placeholder recipient and 1 unit. Never a transfer to yourself, which costs less than a transfer to another account.
  const trimmedTo = to.trim()
  const draftRecipient = isAddress(trimmedTo) ? getAddress(trimmedTo) : undefined
  const draftRaw = (() => {
    try {
      const a = Amount.parse(amount, token.decimals)
      return a.isPositive() ? a.raw : undefined
    } catch {
      return undefined
    }
  })()
  const estimateTo = useDebounced(draftRecipient ?? ESTIMATE_RECIPIENT, 300)
  const estimateAmount = useDebounced(draftRaw !== undefined && balance !== undefined && draftRaw <= balance ? draftRaw : 1n, 300)
  const estimateNote = useDebounced(note, 300)

  // How much USDC the FluxoraPay contract may already pull from this account. Without enough, an approval comes first.
  const allowanceQ = useQuery({
    queryKey: ['send-allowance', address, payAddr],
    enabled: Boolean(client && address && viaPay && payAddr),
    refetchInterval: 15_000,
    queryFn: () => {
      if (!client || !address || !payAddr) throw new Error('no client')
      return client.readContract({ address: token.address, abi: erc20Abi, functionName: 'allowance', args: [address, payAddr] })
    },
  })
  const allowance = allowanceQ.data

  // Real gas estimate, priced in USDC. For a plain transfer that is the transfer itself. Through FluxoraPay it is the
  // approval (when one is needed) plus the payment. `reserve` is the USDC the chain takes up front (estimate x the
  // wallet's gas multiplier x max fee, rounded up) and is what must stay in the account.
  const gas = useQuery({
    queryKey: ['send-gas', address, token.address, estimateTo, estimateAmount.toString(), viaPay ? `${payAddr}:${allowance}:${estimateNote}` : 'plain'],
    enabled: Boolean(client && address) && (!viaPay || allowance !== undefined),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !address) throw new Error('no client')
      const feesP = getFees(client, ARC_CHAIN_ID)
      feesP.catch(() => undefined) // awaited below; this only stops an early estimate failure leaving it unhandled
      let units: bigint
      let needsApproval = false
      if (viaPay && payAddr && allowance !== undefined) {
        needsApproval = allowance < estimateAmount
        if (needsApproval) {
          // The payment cannot be simulated until the approval is mined, so it is priced from a measured constant.
          const approveUnits = await client.estimateContractGas({ account: address, address: token.address, abi: erc20Abi, functionName: 'approve', args: [payAddr, estimateAmount] })
          units = approveUnits + payGasFallback(memoByteLength(estimateNote))
        } else {
          units = await client.estimateContractGas({ account: address, address: payAddr, abi: fluxoraPayAbi, functionName: 'pay', args: [estimateTo, estimateAmount, estimateNote] })
        }
      } else {
        units = await client.estimateContractGas({ account: address, address: token.address, abi: erc20Abi, functionName: 'transfer', args: [estimateTo, estimateAmount] })
      }
      const fees = await feesP
      return { units, fees, needsApproval, cost: arcGasCostUsdc(units, fees.maxFeePerGas), reserve: prepaidGasReserveUsdc(units, fees.maxFeePerGas) }
    },
  })

  const check = (() => {
    const result: { recipient?: Address; raw?: bigint; toError?: string; amountError?: string; noteError?: string; warn?: string } = {}
    const t = to.trim()
    if (viaPay && noteBytes > MAX_MEMO_BYTES) result.noteError = `The note is ${noteBytes} bytes. The limit is ${MAX_MEMO_BYTES} bytes (some characters use more than one).`
    if (t) {
      if (!isAddress(t)) result.toError = 'Enter a valid 0x wallet address.'
      else {
        const lower = t.toLowerCase()
        if (lower === zeroAddress) result.toError = 'Sending to the zero address is not allowed on Arc.'
        else if (payAddr && lower === payAddr.toLowerCase()) result.toError = 'That is your FLUXORA Pay contract. It cannot receive payments.'
        else if (lower === NATIVE_SENTINEL || lower === SYSTEM_EMITTER) result.toError = 'That is a system address, not a wallet.'
        else if (ARC_TOKENS.some((x) => x.address.toLowerCase() === lower))
          result.toError = 'That is a token contract. Tokens sent to it would be lost.'
        else {
          result.recipient = getAddress(t)
          if (address && lower === address.toLowerCase()) result.warn = 'This is your own address.'
        }
      }
    }
    if (amount) {
      try {
        const a = Amount.parse(amount, token.decimals)
        if (!a.isPositive()) result.amountError = 'Amount must be greater than zero.'
        else {
          const verdict = checkSend({ isUsdc: token.symbol === 'USDC', amount: a.raw, tokenBalance: balance, usdcBalance: usdcRow?.raw, reserve: gas.data?.reserve })
          if (verdict.kind === 'ok') result.raw = a.raw
          else if (verdict.kind === 'insufficient-balance') result.amountError = `Insufficient balance. You have ${fmtToken(balance ?? 0n, token.decimals)} ${token.symbol}.`
          else if (verdict.kind === 'insufficient-gas') {
            const reserve = fmtToken(verdict.reserve, 6, 6)
            result.amountError =
              token.symbol !== 'USDC'
                ? `Not enough USDC to pay the network fee. Keep about ${reserve} USDC for gas.`
                : verdict.max > 0n
                  ? `Not enough USDC once the network fee (about ${reserve} USDC) is reserved. The most you can send is ${fmtToken(verdict.max, 6, 6)} USDC.`
                  : `Not enough USDC to cover the network fee (about ${reserve} USDC).`
          } else if (gas.isError && !gas.isFetching) {
            // No fee, no proof the transfer can succeed: do not let it through. Say why when the node did.
            result.amountError = `The network fee could not be estimated, so this transfer cannot be checked. ${parseTxError(gas.error).message}`
          }
        }
      } catch {
        result.amountError = `Enter a number with up to ${token.decimals} decimals.`
      }
    }
    return result
  })()

  // Circle's USDC compliance list and pause flag, read before the wallet opens (a blocked transfer would revert after signing).
  const compliance = useUsdcCompliance({ sender: address, recipient: check.recipient }, token.symbol === 'USDC')
  const complianceBlock = compliance.blocked?.message
  const ready = Boolean(check.recipient && check.raw && !check.toError && !check.amountError && !check.noteError && !complianceBlock)

  const setMax = () => {
    if (balance === undefined) return
    let max = balance
    if (token.symbol === 'USDC') {
      // Leave the full prepaid gas (not just the estimated cost): the chain reserves gasLimit x maxFee up front.
      const reserve = gas.data?.reserve
      if (reserve === undefined) {
        setHint('The network fee is still being estimated. Try Max again in a moment.')
        return
      }
      max = maxSendable(balance, reserve)
    }
    setHint(undefined)
    setAmount(Amount.fromRaw(max, token.decimals).toString())
  }

  const submit = async () => {
    if (!client || !address || !check.recipient || !check.raw) return
    setBusy(true)
    setError(undefined)
    try {
      let h: Hex
      if (viaPay && payAddr) {
        // Through your FluxoraPay contract. It pulls USDC with transferFrom, so it needs an allowance first. Read it fresh:
        // the allowance the page showed may be a few seconds old.
        const current = await client.readContract({ address: token.address, abi: erc20Abi, functionName: 'allowance', args: [address, payAddr] })
        if (current < check.raw) {
          setPhase('approve')
          // Approve exactly this payment, no more. The guard refuses the request if the wallet is on another account.
          const approveHash = await writeContractAsync({ chainId: ARC_CHAIN_ID, account: address, address: token.address, abi: erc20Abi, functionName: 'approve', args: [payAddr, check.raw] })
          recordActivity({ hash: approveHash, kind: 'approve', chainId: ARC_CHAIN_ID, account: address, summary: `Approved ${fmtToken(check.raw, token.decimals, 4)} ${token.symbol} for FLUXORA Pay` })
          // The payment is simulated against the chain, so the approval must be mined before it can be requested.
          const receipt = await client.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 })
          if (receipt.status !== 'success') throw new Error('The approval failed onchain, so nothing was paid.')
          void allowanceQ.refetch()
          setPhase('pay-after-approve')
        } else setPhase('pay')
        h = await writeContractAsync({ chainId: ARC_CHAIN_ID, account: address, address: payAddr, abi: fluxoraPayAbi, functionName: 'pay', args: [check.recipient, check.raw, note] })
      } else {
        // The guarded wallet estimates gas first (a call that would revert never reaches the wallet).
        h = await writeContractAsync({
          chainId: ARC_CHAIN_ID,
          // The same account whose balance was checked on this page. The guard refuses the request if the wallet is
          // on a different account, so the sender can never silently differ from the one shown.
          account: address,
          address: token.address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [check.recipient, check.raw],
        })
      }
      setDelivery({ tokenAddress: token.address, symbol: token.symbol, decimals: token.decimals, to: check.recipient, amount: check.raw })
      setHash(h)
      // Read the transaction back: if the wallet signed from another account than the one shown, say so loudly.
      void verifySender(client, h, address).then((v) => {
        if (v.status === 'mismatch') {
          toast.error(`The wallet sent this transfer from ${shortAddr(v.actual)}, not from ${shortAddr(address)} as shown. Check your wallet before sending again.`, { duration: 30_000 })
        }
      })
      recordActivity({
        hash: h,
        kind: 'send',
        chainId: ARC_CHAIN_ID,
        account: address,
        summary: `Sent ${fmtToken(check.raw, token.decimals, 4)} ${token.symbol} to ${shortAddr(check.recipient)}${viaPay ? ' via FLUXORA Pay' : ''}`,
      })
    } catch (e) {
      const parsed = parseTxError(e)
      if (parsed.rejected) toast('Transaction cancelled')
      else setError(parsed.message)
    } finally {
      setBusy(false)
      setPhase(undefined)
    }
  }

  if (hash) {
    return (
      <Card className="space-y-4">
        <TxStatus hash={hash} chainId={ARC_CHAIN_ID} title="Transfer" expect={delivery} onSettled={() => void balances.refetch()} />
        <button
          className="btn-ghost w-full"
          onClick={() => {
            setHash(undefined)
            setStep('edit')
            setAmount('')
            setTo('')
            setMemo('')
          }}
        >
          Send another
        </button>
      </Card>
    )
  }

  return (
    <Card className="mx-auto max-w-xl space-y-5">
      {step === 'edit' ? (
        <>
          <div>
            <label className="label" htmlFor="to">
              Recipient address
            </label>
            <input
              id="to"
              className="field mt-2 font-mono text-sm"
              placeholder="0x…"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <AddressBookPicker value={to} onPick={(a) => setTo(a)} />
            {check.toError && <p className="mt-1.5 text-sm text-flux-pink">{check.toError}</p>}
            {complianceBlock && <p className="mt-1.5 text-sm text-flux-pink" role="alert" data-testid="usdc-blocked">{complianceBlock}</p>}
            {check.warn && <p className="mt-1.5 text-sm text-amber-300">{check.warn}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="amt">
                Amount
              </label>
              <button className="-my-3.5 py-3.5 text-xs font-semibold text-[var(--a)] hover:brightness-125" onClick={setMax} type="button">
                Balance {balance === undefined ? '…' : fmtToken(balance, token.decimals, 4)} · Max
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-navy-950/60 p-2 pl-4 focus-within:border-volt/70">
              <input
                id="amt"
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent font-display text-3xl font-semibold text-white outline-none placeholder:text-slate-600 tabular"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setHint(undefined)
                  setAmount(e.target.value.replace(/,/g, '.'))
                }}
              />
              <TokenButton token={token} onClick={() => setPicker(true)} />
            </div>
            {(check.amountError ?? hint) && <p className="mt-1.5 text-sm text-flux-pink">{check.amountError ?? hint}</p>}
          </div>

          {viaPay && (
            <div>
              <label className="label" htmlFor="memo">
                Note (optional, public onchain)
              </label>
              <input
                id="memo"
                className="field mt-2 text-sm"
                placeholder="What is this payment for?"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
              />
              {check.noteError && <p className="mt-1.5 text-sm text-flux-pink">{check.noteError}</p>}
            </div>
          )}

          <Row label="From" value={address ? shortAddr(address) : ''} mono />
          {viaPay && payAddr && <Row label="Paid through" value={`FLUXORA Pay ${shortAddr(payAddr)}`} mono />}
          <Row
            label="Network fee (estimate)"
            value={gas.data ? `${fmtGasUsdc(gas.data.cost)} USDC` : gas.isLoading ? <Spinner /> : 'Unavailable'}
          />

          <button className="btn-primary w-full" disabled={!ready} onClick={() => setStep('review')}>
            Review transfer
          </button>
          <WalletSpeedTest />
        </>
      ) : (
        <>
          <button className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white" onClick={() => setStep('edit')}>
            <ArrowLeft size={16} /> Edit
          </button>
          <div className="glass-inner rounded-2xl p-4 text-center">
            <p className="label">You are sending</p>
            <p className="mt-1 font-display text-4xl font-bold tabular">
              {check.raw ? fmtToken(check.raw, token.decimals, token.decimals) : ''} {token.symbol}
            </p>
          </div>
          <div className="divide-y divide-white/5">
            <Row label="Network" value="Arc mainnet" />
            <Row label="From" value={address ? shortAddr(address) : ''} mono />
            <Row label="To" value={check.recipient ? shortAddr(check.recipient, 10, 8) : ''} mono />
            {viaPay && payAddr && <Row label="Paid through" value={`FLUXORA Pay ${shortAddr(payAddr, 10, 8)}`} mono />}
            {viaPay && note && <Row label="Note" value={note} />}
            {viaPay && <Row label="Wallet prompts" value={gas.data?.needsApproval ? '2: approve, then pay' : '1: pay'} />}
            <Row label="Amount" value={check.raw ? `${fmtToken(check.raw, token.decimals, token.decimals)} ${token.symbol}` : ''} />
            <Row label="Network fee (estimate)" value={gas.data ? `${fmtGasUsdc(gas.data.cost)} USDC` : '—'} />
            <Row
              label="Total"
              value={
                !check.raw || !gas.data
                  ? '—'
                  : token.symbol === 'USDC'
                    ? `${fmtToken(check.raw + gas.data.cost.raw, 6, 6)} USDC`
                    : `${fmtToken(check.raw, token.decimals, token.decimals)} ${token.symbol} + ${fmtGasUsdc(gas.data.cost)} USDC`
              }
            />
            <Row label="Recipient receives" value={check.raw ? `${fmtToken(check.raw, token.decimals, token.decimals)} ${token.symbol}` : ''} />
          </div>
          {check.recipient && <ExplorerLink href={explorerAddress(ARC_CHAIN_ID, check.recipient)}>Inspect recipient</ExplorerLink>}
          <Notice tone="warn">Transfers on Arc mainnet are final. Check the address character by character before you confirm.</Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn-primary w-full" disabled={busy} onClick={() => void once(submit)}>
            {busy ? (
              <>
                <Spinner /> {phase === 'approve' ? 'Step 1 of 2: approve in your wallet…' : phase === 'pay-after-approve' ? 'Step 2 of 2: confirm the payment…' : 'Confirm in your wallet…'}
              </>
            ) : (
              <>
                <ArrowUpRight size={18} /> Confirm and sign
              </>
            )}
          </button>
        </>
      )}

      <TokenPicker open={picker} onClose={() => setPicker(false)} rows={balances.rows} onSelect={(t) => setSymbol(t.symbol)} />
    </Card>
  )
}
