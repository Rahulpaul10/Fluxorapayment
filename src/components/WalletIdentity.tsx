import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, QrCode, X } from 'lucide-react'
import { toast } from 'sonner'
import { ARC_CHAIN_ID, explorerAddress } from '@/config/networks'
import { shortAddr } from '@/lib/format'
import { CopyButton, ExplorerLink } from '@/components/ui'

const HUES = [265, 190, 330, 160]
/** A stable colour for an address, so the wallet is recognisable at a glance. */
const avatar = (address: string) => {
  const n = parseInt(address.slice(2, 8), 16)
  return `linear-gradient(135deg, hsl(${HUES[n % 4]} 85% 60%), hsl(${HUES[(n >> 3) % 4]} 85% 52%))`
}

function QrDialog({ address, onClose }: { address: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Wallet QR code"
        className="glass animate-rise w-full max-w-sm rounded-t-[28px] p-5 sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">My Arc Wallet</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="mx-auto mt-3 w-fit rounded-2xl bg-[#ffffff] p-3">
          <QRCodeSVG value={address} size={190} level="M" bgColor="#FFFFFF" fgColor="#070B1F" />
        </div>
        <p className="mt-3 break-all text-center font-mono text-xs text-slate-300" data-testid="wallet-full-address">
          {address}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <CopyButton value={address} label="Copy address" />
          <div className="flex items-center justify-center">
            <ExplorerLink href={explorerAddress(ARC_CHAIN_ID, address)}>Arc Explorer</ExplorerLink>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">Send only Arc mainnet assets to this address.</p>
      </div>
    </div>
  )
}

/** "My Arc Wallet", the short address, Copy and QR. Tapping the address shows it in full. */
export function WalletIdentity({ address, className }: { address: string; className?: string }) {
  const [full, setFull] = useState(false)
  const [qr, setQr] = useState(false)
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <span className="h-9 w-9 shrink-0 rounded-full" style={{ background: avatar(address) }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">My Arc Wallet</p>
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          aria-expanded={full}
          aria-label={`Wallet address ${address}. Tap to ${full ? 'shorten' : 'show in full'}`}
          title={address}
          className="-my-1 block max-w-full py-1 text-left font-mono text-sm text-white"
        >
          {full ? <span className="break-all" data-testid="wallet-address-full">{address}</span> : <span data-testid="wallet-address-short">{shortAddr(address, 6, 4)}</span>}
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="btn-ghost !min-h-[44px] !px-3"
          onClick={() => {
            navigator.clipboard
              .writeText(address)
              .then(() => toast.success('Address copied'))
              .catch(() => toast.error('Copy failed. Open the QR view and copy from there.'))
          }}
          aria-label="Copy address"
        >
          <Copy size={15} /> Copy
        </button>
        <button type="button" className="btn-ghost !min-h-[44px] !px-3" onClick={() => setQr(true)} aria-label="Show QR code">
          <QrCode size={15} /> QR
        </button>
      </div>
      {qr && <QrDialog address={address} onClose={() => setQr(false)} />}
    </div>
  )
}
