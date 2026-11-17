import { useSyncExternalStore } from 'react'
import { getAddress, isAddress, type Address } from 'viem'

/**
 * Saved wallet addresses with custom names. Stored only in this browser (localStorage), and only PUBLIC data:
 * a name and an address. Input that looks like a private key or a seed phrase is refused so it can never be
 * stored by accident.
 */
export interface AddressBookEntry {
  id: string
  name: string
  address: Address
  createdAt: number
}

export const MAX_NAME_LENGTH = 40
const KEY = 'fluxora:addressbook:v1'
const listeners = new Set<() => void>()
let cache: AddressBookEntry[] | null = null

const PRIVATE_KEY_LIKE = /^(0x)?[0-9a-fA-F]{64}$/
const looksLikeSeedPhrase = (text: string) => text.trim().split(/\s+/).length >= 12

export type EntryCheck = { ok: true; name: string; address: Address } | { ok: false; field: 'name' | 'address'; message: string }

/** Pure validation, used by the form and by tests. `others` are the entries that are NOT being edited. */
export function validateEntry(nameInput: string, addressInput: string, others: readonly AddressBookEntry[] = []): EntryCheck {
  const name = nameInput.trim().replace(/\s+/g, ' ')
  const raw = addressInput.trim()
  if (PRIVATE_KEY_LIKE.test(raw) || PRIVATE_KEY_LIKE.test(name) || looksLikeSeedPhrase(name) || looksLikeSeedPhrase(raw)) {
    return { ok: false, field: 'address', message: 'That looks like a private key or recovery phrase. Never enter those here. Save a public wallet address (42 characters, starts with 0x).' }
  }
  if (!name) return { ok: false, field: 'name', message: 'Give this address a name.' }
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is being rejected
  if (name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) return { ok: false, field: 'name', message: `Use a name of up to ${MAX_NAME_LENGTH} characters, without special control characters.` }
  if (!isAddress(raw, { strict: false })) return { ok: false, field: 'address', message: 'Enter a valid wallet address: 42 characters starting with 0x.' }
  const address = getAddress(raw.toLowerCase())
  if (/^0x0{40}$/.test(address.toLowerCase())) return { ok: false, field: 'address', message: 'The zero address cannot be saved.' }
  // A mixed-case address carries a checksum: a typo is caught here instead of sending funds to the wrong place.
  if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase().replace('0X', '0x') && raw !== address) {
    return { ok: false, field: 'address', message: 'The address checksum does not match. Re-copy it from the source to avoid a typo.' }
  }
  if (others.some((e) => e.address.toLowerCase() === address.toLowerCase())) return { ok: false, field: 'address', message: 'This address is already saved.' }
  if (others.some((e) => e.name.toLowerCase() === name.toLowerCase())) return { ok: false, field: 'name', message: 'You already have an address with this name.' }
  return { ok: true, name, address }
}

function read(): AddressBookEntry[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    cache = Array.isArray(parsed)
      ? parsed.filter((e): e is AddressBookEntry => typeof e?.id === 'string' && typeof e?.name === 'string' && typeof e?.address === 'string' && isAddress(e.address))
      : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: AddressBookEntry[]) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage blocked or full: the in-memory copy still works for this visit
  }
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const useAddressBook = (): AddressBookEntry[] => useSyncExternalStore(subscribe, read, read)

export function addEntry(name: string, address: string): EntryCheck {
  const check = validateEntry(name, address, read())
  if (!check.ok) return check
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  write([...read(), { id, name: check.name, address: check.address, createdAt: Math.floor(Date.now() / 1000) }])
  return check
}

export function updateEntry(id: string, name: string, address: string): EntryCheck {
  const check = validateEntry(name, address, read().filter((e) => e.id !== id))
  if (!check.ok) return check
  write(read().map((e) => (e.id === id ? { ...e, name: check.name, address: check.address } : e)))
  return check
}

export function removeEntry(id: string) {
  write(read().filter((e) => e.id !== id))
}

/** The saved name for an address, if any (used to label transfers). */
export const nameFor = (entries: readonly AddressBookEntry[], address: string | undefined) =>
  address ? entries.find((e) => e.address.toLowerCase() === address.toLowerCase())?.name : undefined

/** Test helper: forget the in-memory copy so the next read comes from storage. */
export function resetAddressBookCache() {
  cache = null
  listeners.forEach((l) => l())
}
