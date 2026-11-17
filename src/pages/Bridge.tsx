import { useEffect, useMemo, useRef, useState } from 'react'
import { erc20Abi, isAddress, type EIP1193Provider, type Hex } from 'viem'
import { useAccount, usePublicClient, useReadContract, useSwitchChain } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { AppKit, BridgeResult } from '@circle-fin/app-kit'
import { loadBridgeKit, loadViemAdapter } from '@/lib/bridgeKit'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { getUsdc } from '@/onchain-facts'
import { Amount } from '@/onchain-money'
import { NETWORKS, networkById, asChainId, type NetworkInfo } from '@/config/networks'
import { fmtToken } from '@/lib/format'
import { parseTxError } from '@/lib/errors'
import type { View } from '@/lib/router'
import { checkReceive, gasUsdcRaw, networkFeeSummary, rawToUsdc } from '@/lib/bridgeMath'
import { fetchOfficialFeeTiers, isFresh, unusualFeeWarning, verifyForwardingFee, verifyRoute, type KitChainDef } from '@/lib/cctpFees'
import { CCTP_DOMAINS } from '@/lib/cctpHistory'
import { useNow } from '@/hooks/useNow'
import { bridgeSteps } from '@/lib/bridgeSteps'
import { BridgeRoute, BridgeStepper } from '@/components/BridgeFlow'
import { canResume, errorText, explainTx, failedStep, isRateLimited, rateLimitWaitMs, type StepLike, type TxOutcome, type TxReader } from '@/lib/bridgeErrors'
import { recordActivity, updateActivity } from '@/lib/activity'
import { Card, Notice, PageTitle, Row, Segmented, Spinner, TokenIcon } from '@/components/ui'
import { USDC } from '@/lib/tokens'
import { ConnectKitButton } from 'connectkit'

type Speed = 'FAST' | 'SLOW'
interface StepView {
  name: string
  state: string
  txHash?: string
  explorerUrl?: string
  error?: string
}

function NetworkPick({ label, value, onChange, exclude }: { label: string; value: number; onChange: (id: number) => void; exclude?: number }) {
  return (
    <div className="glass-inner rounded-2xl p-4">
      <label className="label" htmlFor={`net-${label}`}>
        {label}
      </label>
      <select
        id={`net-${label}`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="field mt-2 !bg-navy-900"
      >
        {NETWORKS.filter((n) => n.id !== exclude).map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Bridge({ navigate }: { navigate?: (view: View, search?: string) => void } = {}) {
  const { address, isConnected, chainId, connector } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()

  const [fromId, setFromId] = useState(NETWORKS[1].id) // Ethereum -> Arc by default
  const [toId, setToId] = useState(NETWORKS[0].id)
  const [amount, setAmount] = useState('')
  const [speed, setSpeed] = useState<Speed>('FAST')
  const [recipient, setRecipient] = useState('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<StepView[]>([])
  const [result, setResult] = useState<BridgeResult<string>>()
  const [error, setError] = useState<string>()
  const adapterRef = useRef<Awaited<ReturnType<typeof createViemAdapterFromProvider>>>()
  // One bridge action at a time, even if the button is pressed twice before React has re-rendered: a second burn would move the money twice.
  const inFlight = useRef(false)
  // The last known fate of the burn transaction, so Retry can refuse to burn twice.
  const burnOutcome = useRef<TxOutcome>()
  // How many rate-limit failures in a row, so Retry waits a little longer each time instead of hammering the service.
  const rateLimits = useRef(0)
  const sourceClient = usePublicClient({ chainId: asChainId(fromId) }) as unknown as TxReader | undefined

  const from = networkById(fromId) as NetworkInfo
  const to = networkById(toId) as NetworkInfo
  const usdcFact = getUsdc(fromId)

  const balance = useReadContract({
    address: usdcFact?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: asChainId(fromId),
    query: { enabled: Boolean(address && usdcFact), refetchInterval: 20_000 },
  })

  const parsed = useMemo(() => {
    if (!amount) return { raw: undefined as bigint | undefined, error: undefined as string | undefined }
    try {
      const a = Amount.parse(amount, USDC.decimals)
      if (!a.isPositive()) return { raw: undefined, error: 'Amount must be greater than zero.' }
      if (balance.data !== undefined && a.raw > balance.data) return { raw: undefined, error: `Insufficient USDC on ${from.name}.` }
      return { raw: a.raw, error: undefined }
    } catch {
      return { raw: undefined, error: 'Enter a number with up to 6 decimals.' }
    }
  }, [amount, balance.data, from.name])

  const recipientError = recipient && !isAddress(recipient) ? 'Enter a valid 0x address, or leave empty to use your wallet.' : undefined
  const destination = recipient && !recipientError ? recipient : address
  const onSource = chainId === fromId

  const getAdapter = async () => {
    if (!connector) throw new Error('Wallet not connected')
    const provider = (await connector.getProvider()) as EIP1193Provider
    const { createViemAdapterFromProvider } = await loadViemAdapter()
    const adapter = await createViemAdapterFromProvider({ provider })
    adapterRef.current = adapter
    return adapter
  }

  // Real quote from Circle's bridge service. Requires the wallet to be on the source chain.
  const [debounced, setDebounced] = useState<{ raw?: bigint; speed: Speed }>({ speed })
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ raw: parsed.raw, speed }), 600)
    return () => clearTimeout(t)
  }, [parsed.raw, speed])

  const quote = useQuery({
    queryKey: ['bridge-quote', fromId, toId, debounced.raw?.toString(), debounced.speed, destination],
    enabled: Boolean(debounced.raw && address && destination && onSource && !recipientError && fromId !== toId),
    // A quote only reads. A rate limit or a dropped request is retried with a growing pause; a burn is never retried here.
    retry: 2,
    retryDelay: (attempt) => 700 * 2 ** attempt,
    staleTime: 20_000,
    queryFn: async () => {
      if (!debounced.raw || !destination) throw new Error('missing input')
      const [adapter, kit] = await Promise.all([getAdapter(), loadBridgeKit()])
      return kit.estimateBridge({
        from: { adapter, chain: from.kit },
        to: { chain: to.kit, recipientAddress: destination, useForwarder: true },
        amount: Amount.fromRaw(debounced.raw, USDC.decimals).toString(),
        config: { transferSpeed: debounced.speed },
      })
    },
  })

  const fees = quote.data?.fees ?? []
  const stale = parsed.raw !== debounced.raw || speed !== debounced.speed
  const q = quote.data
  const fromDomain = CCTP_DOMAINS[fromId]
  const toDomain = CCTP_DOMAINS[toId]
  const now = useNow(5_000)

  // The route itself: both networks must be mainnets whose ids and CCTP domains agree with the bridge kit's own data.
  const route = useQuery({
    queryKey: ['bridge-route', from.kit, to.kit],
    staleTime: Infinity,
    queryFn: async () => verifyRoute((await loadBridgeKit()).getSupportedChains() as unknown as KitChainDef[], from, to, CCTP_DOMAINS),
  })
  // Circle's own fee service, asked separately from the kit, so the kit's quote can be checked against it.
  const tiers = useQuery({
    queryKey: ['cctp-fee-tiers', fromDomain, toDomain],
    enabled: Boolean(parsed.raw && onSource && fromDomain !== undefined && toDomain !== undefined && fromId !== toId),
    retry: 2,
    retryDelay: (attempt) => 700 * 2 ** attempt,
    staleTime: 15_000,
    queryFn: () => fetchOfficialFeeTiers(fromDomain, toDomain),
  })
  // If the latest read of Circle's fee service failed, an older answer is NOT reused: the fee counts as unverified.
  const officialTiers = tiers.isError ? undefined : tiers.data
  const verdict = verifyForwardingFee(q?.fees, officialTiers, speed)
  const fresh = isFresh(quote.dataUpdatedAt, now * 1000)
  /** Why the fee can't be trusted right now, in plain words. undefined when it can. */
  const feeBlock =
    route.data && !route.data.ok
      ? route.data.message
      : tiers.isError
        ? tiers.error instanceof Error ? tiers.error.message : "The fee could not be verified against Circle's fee service."
        : q && officialTiers && !verdict.ok
          ? verdict.message
          : q && !stale && !quote.isFetching && !fresh
            ? 'This quote is more than a minute old, so it is not trusted for a transfer. It is refreshing; wait a moment.'
            : undefined
  const feeVerified = Boolean(route.data?.ok && officialTiers && verdict.ok && fresh)
  // What really arrives: the amount minus Circle's fee, in exact units. Not valid (and Bridge stays off) until both are known and the amount is above the fee.
  const receive = checkReceive(parsed.raw, q?.fees)
  const views = bridgeSteps(steps, running)
  const started = steps.length > 0 || running
  const canBridge = Boolean(q && !stale && !running && onSource && parsed.raw && !recipientError && !result && receive.ok && feeVerified)

  /** Say what really happened to a failed step: the kit's own message, and for a mined transaction the node's revert reason. */
  const explainFailure = async (res: BridgeResult<string>): Promise<TxOutcome | undefined> => {
    const steps = res.steps as StepLike[]
    const failed = failedStep(steps)
    if (!failed) return undefined
    let detail = errorText(failed.error)
    let outcome: TxOutcome | undefined
    if (failed.txHash && sourceClient) {
      outcome = await explainTx(sourceClient, failed.txHash as Hex)
      if (outcome.status === 'reverted') detail = outcome.reason ?? detail ?? 'The transaction reverted.'
      else if (outcome.status === 'pending') detail = detail ?? 'The transaction has no receipt yet.'
    }
    const tooSmall = detail && /max fee must be less than amount/i.test(detail) ? " (the amount is not larger than Circle's fee for this route)" : ''
    const limited = isRateLimited(detail)
    rateLimits.current = limited ? rateLimits.current + 1 : 0
    setError(
      `${failedLabel(failed.name)}${detail ? `: ${detail}` : ''}${tooSmall}. ${limited ? "Circle's service is rate limiting this connection, so the step was not sent. " : ''}${failed.txHash ? 'Transaction hash is in the progress list below. ' : 'Nothing was sent for this step. '}Your funds are safe: Retry resumes only from this step${limited ? ' and waits a few seconds first' : ''}.`,
    )
    return outcome
  }

  /** The kit says the burn worked: confirm it against the chain before telling the user so. */
  const confirmBurn = async (res: BridgeResult<string>) => {
    const burn = (res.steps as StepLike[]).find((st) => (st.name === 'burn' || st.name === 'transfer') && st.state === 'success' && st.txHash)
    if (!burn?.txHash || !sourceClient) return true
    const outcome = await explainTx(sourceClient, burn.txHash as Hex)
    if (outcome.status === 'reverted') {
      setError(`The burn transaction was mined but reverted${outcome.reason ? `: ${outcome.reason}` : ''}. No USDC was burned.`)
      return false
    }
    return true
  }

  const showResult = (res: BridgeResult<string>) => {
    setResult(res)
    setSteps((res.steps as Array<StepLike & { explorerUrl?: string }>).map((st) => ({ name: st.name, state: st.state, txHash: st.txHash, explorerUrl: st.explorerUrl, error: errorText(st.error) })))
    for (const st of res.steps) {
      if ((st.name === 'burn' || st.name === 'transfer') && st.txHash) updateActivity(st.txHash as `0x${string}`, fromId, st.state === 'success' ? 'success' : 'failed')
    }
  }

  const run = async () => {
    if (inFlight.current || !address || !destination || !parsed.raw || !receive.ok) return
    inFlight.current = true
    rateLimits.current = 0
    setRunning(true)
    setError(undefined)
    setSteps([])
    setResult(undefined)
    const handler = (payload: unknown) => {
      const p = payload as { method?: string; values?: { state?: string; txHash?: string; transactionHash?: string; explorerUrl?: string; error?: unknown } }
      if (!p.method || !p.values) return
      const name = p.method
      const txHash = p.values.txHash ?? p.values.transactionHash
      setSteps((prev) => {
        const next = prev.filter((st) => st.name !== name)
        next.push({ name, state: p.values?.state ?? 'success', txHash, explorerUrl: p.values?.explorerUrl, error: errorText(p.values?.error) })
        return next
      })
      if ((name === 'burn' || name === 'transfer') && txHash) {
        recordActivity({
          hash: txHash as `0x${string}`, kind: 'bridge', chainId: fromId, account: address,
          summary: `Bridged ${amount} USDC from ${from.name} to ${to.name}`,
          note: 'Funds arrive on the destination after Circle attestation',
        })
      }
    }
    let kit: AppKit | undefined
    try {
      kit = await loadBridgeKit()
      // Re-read the fee right before the burn. Nothing is sent on a quote that cannot be verified or that no longer covers the amount.
      const [freshQuote, freshTiers] = await Promise.all([quote.refetch(), tiers.refetch()])
      const freshReceive = checkReceive(parsed.raw, freshQuote.data?.fees)
      const freshVerdict = verifyForwardingFee(freshQuote.data?.fees, freshTiers.data, speed)
      if (!route.data?.ok) throw new Error(route.data && !route.data.ok ? route.data.message : 'The route could not be verified, so nothing was sent.')
      if (!freshVerdict.ok) throw new Error(`${freshVerdict.message} Nothing was sent.`)
      if (!freshReceive.ok) {
        throw new Error(
          freshReceive.reason === 'fee-covers-amount' && freshReceive.feeRaw !== undefined
            ? `The fee just rose to ${rawToUsdc(freshReceive.feeRaw)} USDC, which is not below your ${amount} USDC. Nothing was sent. Enter at least ${rawToUsdc(freshReceive.minRaw ?? 0n)} USDC.`
            : 'The fee could not be priced just now, so nothing was sent.',
        )
      }
      kit.on('*', handler)
      const adapter = adapterRef.current ?? (await getAdapter())
      const res = await kit.bridge({
        from: { adapter, chain: from.kit },
        to: { chain: to.kit, recipientAddress: destination, useForwarder: true },
        amount: Amount.fromRaw(parsed.raw, USDC.decimals).toString(),
        config: { transferSpeed: speed },
      })
      showResult(res)
      if (res.state === 'error') {
        burnOutcome.current = await explainFailure(res)
      } else if (await confirmBurn(res)) void balance.refetch()
    } catch (e) {
      const p = parseTxError(e)
      if (p.rejected) toast('Bridge cancelled')
      else setError(p.message)
    } finally {
      kit?.off('*', handler)
      inFlight.current = false
      setRunning(false)
    }
  }

  const retry = async () => {
    if (!result || inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(undefined)
    try {
      if (!onSource) {
        setError(`Switch your wallet to ${from.name} first, then retry.`)
        return
      }
      const failed = failedStep(result.steps as StepLike[])
      const burning = failed?.name === 'burn' || failed?.name === 'transfer'
      // A burn that failed for the amount cannot succeed on the same amount again: fix the amount instead of resending.
      if (burning && !receive.ok) {
        setError(
          receive.reason === 'fee-covers-amount' && receive.minRaw
            ? `Retry would fail the same way: the amount is too close to Circle's fee. Enter at least ${rawToUsdc(receive.minRaw)} USDC.`
            : 'Retry is paused until a fresh fee quote is available.',
        )
        return
      }
      // Ask the chain again about the burn instead of trusting an old answer.
      const fresh = failed?.txHash && sourceClient ? await explainTx(sourceClient, failed.txHash as Hex) : burnOutcome.current
      const gate = canResume(result.steps as StepLike[], fresh)
      if (!gate.ok) {
        setError(gate.message)
        return
      }
      if (rateLimits.current > 0) {
        const wait = rateLimitWaitMs(rateLimits.current)
        setError(`Waiting ${Math.round(wait / 1000)} seconds for the rate limit to ease before resuming…`)
        await new Promise((resolve) => setTimeout(resolve, wait))
        setError(undefined)
      }
      const kit = await loadBridgeKit()
      const adapter = await getAdapter()
      const res = await kit.retryBridge(result, { from: adapter, to: adapter })
      showResult(res)
      if (res.state === 'error') burnOutcome.current = await explainFailure(res)
      else if (await confirmBurn(res)) void balance.refetch()
    } catch (e) {
      setError(parseTxError(e).message)
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }

  const swapDirection = () => {
    setFromId(toId)
    setToId(fromId)
    setResult(undefined)
    setSteps([])
  }

  return (
    <>
      <PageTitle
        title="Bridge"
        subtitle="Move USDC between Arc and other networks with Circle CCTP. Only networks officially supported by Circle are listed."
      />
      <Card className="mx-auto max-w-xl space-y-4">
        <Notice tone="warn">Mainnet. Bridging burns USDC on the source network and mints it on the destination. It cannot be undone.</Notice>

        <NetworkPick label="From" value={fromId} onChange={(id) => { setFromId(id); if (id === toId) setToId(fromId) }} exclude={toId} />
        <div className="relative z-10 -my-6 flex justify-center">
          <button onClick={swapDirection} className="rounded-xl border border-white/10 bg-navy-800 p-2.5 text-[var(--a)] shadow-cyan hover:bg-navy-700" aria-label="Swap direction">
            <ArrowDown size={18} />
          </button>
        </div>
        <NetworkPick label="To" value={toId} onChange={(id) => { setToId(id); if (id === fromId) setFromId(toId) }} exclude={fromId} />

        <div className="glass-inner rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="bridge-amt">Amount</label>
            <button
              className="-my-3.5 py-3.5 text-xs font-semibold text-[var(--a)]"
              onClick={() => balance.data !== undefined && setAmount(Amount.fromRaw(balance.data, USDC.decimals).toString())}
            >
              Balance {balance.data === undefined ? (isConnected ? '…' : '—') : fmtToken(balance.data, USDC.decimals)} · Max
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input
              id="bridge-amt"
              inputMode="decimal"
              className="min-w-0 flex-1 bg-transparent font-display text-3xl font-semibold text-white outline-none placeholder:text-slate-600 tabular"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/,/g, '.'))
                setResult(undefined)
                setSteps([])
              }}
            />
            <span className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 font-semibold">
              <TokenIcon token={USDC} size={22} /> USDC
            </span>
          </div>
          {parsed.error && <p className="mt-2 text-sm text-flux-pink">{parsed.error}</p>}
        </div>

        <div>
          <p className="label mb-2">Transfer speed</p>
          <Segmented value={speed} onChange={setSpeed} options={[{ value: 'FAST', label: 'Fast' }, { value: 'SLOW', label: 'Standard (lower fee)' }]} />
        </div>

        <div>
          <label className="label" htmlFor="bridge-rcpt">Recipient on {to.name} (optional)</label>
          <input id="bridge-rcpt" className="field mt-2 font-mono text-sm" placeholder={address ?? '0x…'} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} spellCheck={false} />
          {recipientError && <p className="mt-1.5 text-sm text-flux-pink">{recipientError}</p>}
        </div>

        {!isConnected ? (
          <ConnectKitButton.Custom>
            {({ show }) => <button className="btn-primary w-full" onClick={show}>Connect wallet</button>}
          </ConnectKitButton.Custom>
        ) : !onSource ? (
          <button
            className="btn-primary w-full"
            disabled={switching}
            onClick={() => {
              switchChainAsync({ chainId: asChainId(fromId) }).catch(() => toast.error(`Could not switch to ${from.name}.`))
            }}
          >
            {switching ? 'Check your wallet…' : `Switch wallet to ${from.name}`}
          </button>
        ) : (
          <>
            {/* Before anything is sent: the summary. After: the three steps. */}
            {parsed.raw && !started && (
              <div className="glass-inner rounded-2xl p-4" data-testid="bridge-summary" aria-live="polite">
                <p className="label mb-1">Bridge summary</p>
                {quote.isFetching || stale ? (
                  <div className="space-y-2.5 py-2" aria-busy="true" aria-label="Getting a live quote">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="skeleton h-5" />
                    ))}
                    <p className="flex items-center gap-2 text-xs text-slate-400"><Spinner className="!h-3.5 !w-3.5" /> Getting a live quote…</p>
                  </div>
                ) : quote.isError ? (
                  <p className="py-2 text-sm text-amber-200">No quote available for this route or amount: {quote.error instanceof Error ? quote.error.message.split('\n')[0] : 'unknown error'}</p>
                ) : q ? (
                  <div className="divide-y divide-white/5">
                    <Row label="From" value={from.name} />
                    <Row label="To" value={to.name} />
                    <Row label="Transfer amount" value={`${q.amount} USDC`} />
                    <Row label="Network fee" value={networkFeeSummary(q.gasFees) ?? 'n/a'} />
                    {fees.map((f, i) => (
                      <Row key={i} label={`${f.type === 'forwarder' ? 'Circle forwarding' : f.type === 'kit' ? 'Service' : 'Protocol'} fee`} value={f.amount ? `${f.amount} ${f.token}` : 'n/a'} />
                    ))}
                    <Row
                      label="Total wallet deduction"
                      value={parsed.raw === undefined ? '—' : from.gas === 'USDC' && gasUsdcRaw(q.gasFees) !== undefined ? `${rawToUsdc(parsed.raw + (gasUsdcRaw(q.gasFees) ?? 0n))} USDC` : `${rawToUsdc(parsed.raw)} USDC + ${networkFeeSummary(q.gasFees) ?? 'network fee'}`}
                    />
                    <Row label="Estimated receive" value={receive.ok ? `≈ ${rawToUsdc(receive.receiveRaw)} USDC` : '—'} />
                    <Row label="Minimum required amount" value={receive.ok || receive.reason === 'fee-covers-amount' ? `${rawToUsdc(receive.minRaw ?? 0n)} USDC` : '—'} />
                    <Row label="Estimated arrival" value={speed === 'FAST' ? 'Typically under a minute' : 'Typically 15 to 20 minutes'} />
                    <Row label="Route" value={`${from.name} → Circle CCTP → ${to.name}`} />
                  </div>
                ) : null}
              </div>
            )}
            {parsed.raw && q && !stale && !quote.isFetching && !receive.ok && receive.reason !== 'no-amount' && !started && (
              <Notice tone="warn">
                {receive.reason === 'fee-covers-amount' && receive.feeRaw !== undefined && receive.minRaw !== undefined
                  ? `This amount is too small. Circle's fee for ${from.name} to ${to.name} is ${rawToUsdc(receive.feeRaw)} USDC, taken out of the amount, and the burn is only accepted when the amount is larger than that fee. Enter at least ${rawToUsdc(receive.minRaw)} USDC. The fee is re-checked right before you confirm. Nothing was sent.`
                  : 'The fee for this route could not be priced, so the bridge is paused until a quote is available.'}
              </Notice>
            )}
            {parsed.raw && !stale && !quote.isFetching && !started && feeBlock && (
              <Notice tone="error">
                <p className="font-semibold">Fee could not be verified</p>
                <p className="mt-0.5 text-sm">{feeBlock} The bridge stays off until the fee is verified.</p>
              </Notice>
            )}
            {parsed.raw && q && !stale && !quote.isFetching && !started && verdict.ok && (() => {
              const w = unusualFeeWarning(parsed.raw, verdict.forwardingRaw, verdict.tier, to.name)
              return w ? (
                <Notice tone="warn" >
                  <p className="font-semibold">{w.title}</p>
                  <p className="mt-0.5 text-sm">{w.detail}</p>
                </Notice>
              ) : null
            })()}
            {Number(amount) > 100 && !started && <Notice tone="warn">Large transfer. Double-check networks and recipient before confirming.</Notice>}

            {/* The route. It moves only while a real step is processing. */}
            <div className="glass-inner rounded-2xl p-3">
              <p className="label mb-1 text-center">Route</p>
              <BridgeRoute fromName={from.name} toName={to.name} steps={views} />
            </div>

            {started && <BridgeStepper steps={views} fromId={fromId} toId={toId} />}

            <button className="btn-primary w-full" disabled={!canBridge} onClick={() => void run()}>
              {running ? <><Spinner /> Bridging, follow your wallet prompts…</> : <>Bridge to {to.name} <ArrowRight size={18} /></>}
            </button>
          </>
        )}

        {error && (
          <Notice tone="error" action={result?.state === 'error' ? <button className="btn-ghost !min-h-[44px]" disabled={running} onClick={() => void retry()}>Retry</button> : undefined}>
            {error}
          </Notice>
        )}
        {result?.state === 'success' && (
          <Notice tone="success" action={<button className="btn-ghost !min-h-[44px]" onClick={() => { setResult(undefined); setSteps([]); setAmount('') }}>New bridge</button>}>
            Bridge complete. USDC was delivered on {to.name}.
          </Notice>
        )}
        {navigate && (
          <button className="mx-auto block min-h-[44px] text-sm font-medium text-[var(--a)] hover:brightness-125" onClick={() => navigate('bridges')}>
            View bridge history
          </button>
        )}
        <p className="text-center text-xs text-slate-500">Powered by Circle CCTP. Arrival times depend on source-chain finality and Circle attestation.</p>
      </Card>
    </>
  )
}

/** "Burn failed", "Approval failed", "Receive failed": the headline for the step that did not finish. */
function failedLabel(name: string) {
  return name === 'approve' ? 'Approval failed' : name === 'burn' || name === 'transfer' ? 'Burn failed' : 'Receive failed'
}

