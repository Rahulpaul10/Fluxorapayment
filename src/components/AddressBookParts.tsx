import { useState } from 'react'
import { isAddress } from 'viem'
import { BookUser, Pencil, Trash2 } from 'lucide-react'
import { addEntry, MAX_NAME_LENGTH, nameFor, removeEntry, updateEntry, useAddressBook, type AddressBookEntry } from '@/lib/addressBook'
import { shortAddr } from '@/lib/format'

/** Under the recipient field in Send: pick a saved address, see its name, or save a new one. Public data only. */
export function AddressBookPicker({ value, onPick }: { value: string; onPick: (address: string) => void }) {
  const book = useAddressBook()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const trimmed = value.trim()
  const saved = nameFor(book, trimmed)
  const canOffer = isAddress(trimmed) && !saved

  return (
    <div className="mt-2 space-y-2">
      {book.length > 0 && (
        <label className="block text-xs font-medium text-slate-400">
          Saved addresses
          <select className="field mt-1" value="" onChange={(e) => e.target.value && onPick(e.target.value)} aria-label="Choose a saved address" data-testid="address-picker">
            <option value="">Choose a saved address…</option>
            {book.map((e) => <option key={e.id} value={e.address}>{e.name} · {shortAddr(e.address)}</option>)}
          </select>
        </label>
      )}
      {saved && <p className="flex items-center gap-1.5 text-sm text-flux-green" data-testid="saved-name"><BookUser size={14} /> Saved as {saved}</p>}
      {canOffer && !saving && (
        <button type="button" className="min-h-[44px] text-sm font-medium text-[var(--a)] hover:brightness-125" onClick={() => setSaving(true)}>Save this address</button>
      )}
      {canOffer && saving && (
        <div className="glass-inner space-y-2 rounded-2xl p-3">
          <input className="field" placeholder="Name, for example Alex" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => { setName(e.target.value); setError(undefined) }} aria-label="Name for this address" />
          {error && <p className="text-sm text-flux-pink">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary !min-h-[44px]" onClick={() => { const r = addEntry(name, trimmed); if (r.ok) { setSaving(false); setName('') } else setError(r.message) }}>Save</button>
            <button type="button" className="btn-ghost !min-h-[44px]" onClick={() => { setSaving(false); setError(undefined) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EntryRow({ entry }: { entry: AddressBookEntry }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entry.name)
  const [address, setAddress] = useState<string>(entry.address)
  const [error, setError] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  if (editing) {
    return (
      <li className="glass-inner space-y-2 rounded-2xl p-3" data-testid="book-entry">
        <input className="field" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <input className="field font-mono text-xs" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} aria-label="Address" />
        {error && <p className="text-sm text-flux-pink">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary !min-h-[44px]" onClick={() => { const r = updateEntry(entry.id, name, address); if (r.ok) setEditing(false); else setError(r.message) }}>Save changes</button>
          <button className="btn-ghost !min-h-[44px]" onClick={() => { setEditing(false); setName(entry.name); setAddress(entry.address); setError(undefined) }}>Cancel</button>
        </div>
      </li>
    )
  }
  return (
    <li className="glass-inner flex flex-wrap items-center gap-2 rounded-2xl p-3" data-testid="book-entry">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{entry.name}</p>
        <p className="break-all font-mono text-xs text-slate-400">{entry.address}</p>
      </div>
      <button className="btn-ghost !min-h-[44px] !px-3" onClick={() => setEditing(true)} aria-label={`Edit ${entry.name}`}><Pencil size={16} /></button>
      <button className={confirm ? 'btn-primary !min-h-[44px] !px-3' : 'btn-ghost !min-h-[44px] !px-3'} onClick={() => { if (confirm) removeEntry(entry.id); else { setConfirm(true); setTimeout(() => setConfirm(false), 4000) } }} aria-label={confirm ? `Confirm delete ${entry.name}` : `Delete ${entry.name}`}>
        <Trash2 size={16} /> {confirm && 'Confirm'}
      </button>
    </li>
  )
}

/** Settings: the full address book, with add, edit and delete. */
export function AddressBookManager() {
  const book = useAddressBook()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string>()
  return (
    <div className="space-y-3">
      {book.length === 0 ? <p className="text-sm text-slate-400">No saved addresses yet. Add one below, or save a recipient while sending.</p> : <ul className="space-y-2">{book.map((e) => <EntryRow key={e.id} entry={e} />)}</ul>}
      <form
        className="space-y-2"
        onSubmit={(e) => { e.preventDefault(); const r = addEntry(name, address); if (r.ok) { setName(''); setAddress(''); setError(undefined) } else setError(r.message) }}
      >
        <input className="field" placeholder="Name" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} aria-label="New address name" />
        <input className="field font-mono text-xs" placeholder="0x… wallet address" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoComplete="off" aria-label="New address" />
        {error && <p className="text-sm text-flux-pink" role="alert">{error}</p>}
        <button type="submit" className="btn-primary !min-h-[44px]">Add address</button>
      </form>
      <p className="text-xs text-slate-500">Saved only in this browser. Only a name and a public address are stored, never keys or recovery phrases.</p>
    </div>
  )
}
