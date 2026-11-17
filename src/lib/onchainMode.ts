import { useSyncExternalStore } from 'react'

/** Optional "Onchain Details" view. Off by default so the normal interface stays clean. Stored only in this browser. */
const KEY = 'fluxora:onchain-details:v1'
const listeners = new Set<() => void>()
let cache: boolean | null = null

function read(): boolean {
  if (cache === null) {
    try {
      cache = localStorage.getItem(KEY) === '1'
    } catch {
      cache = false
    }
  }
  return cache
}

export function setOnchainDetails(on: boolean) {
  cache = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // storage blocked: the setting still applies for this visit
  }
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const useOnchainDetails = (): boolean => useSyncExternalStore(subscribe, read, read)
