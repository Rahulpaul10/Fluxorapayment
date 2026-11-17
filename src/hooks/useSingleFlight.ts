import { useCallback, useRef } from 'react'

/**
 * Runs an async action at most once at a time. A second call while the first is still running is ignored, so a
 * double tap can never submit a transaction twice. `disabled` on a button is not enough: it only applies after
 * React re-renders, and two taps can arrive before that.
 */
export function useSingleFlight() {
  const flying = useRef(false)
  return useCallback(async (action: () => Promise<unknown>) => {
    if (flying.current) return
    flying.current = true
    try {
      await action()
    } finally {
      flying.current = false
    }
  }, [])
}
