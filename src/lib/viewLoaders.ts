import type { View } from './router'

/**
 * One loader per page. App uses them for React.lazy, and the same loaders are used to prefetch pages, so the code
 * for a page is usually already in the browser before the user opens it. Calling a loader twice is free: the
 * browser module cache returns the same module.
 */

const RELOAD_KEY = 'fx:chunk-reload'

/**
 * A page's code is a separate file. After a new version is published, a tab that is still open asks for files that no
 * longer exist, and the page fails with "Failed to fetch dynamically imported module" (seen in real sessions). Try once
 * more, then reload ONCE (guarded, so it can never loop) to pick up the new version. The wallet stays connected.
 */
export function resilient<T>(load: () => Promise<T>, reload: () => void = () => window.location.reload()): () => Promise<T> {
  return async () => {
    try {
      const module = await load()
      try {
        sessionStorage.removeItem(RELOAD_KEY)
      } catch {
        // storage unavailable: nothing to clear
      }
      return module
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 600))
      try {
        return await load()
      } catch (error) {
        try {
          if (sessionStorage.getItem(RELOAD_KEY) !== '1') {
            sessionStorage.setItem(RELOAD_KEY, '1')
            reload()
            return await new Promise<T>(() => undefined) // the page is reloading
          }
        } catch {
          // storage unavailable: fall through to the error screen
        }
        throw error
      }
    }
  }
}

export const viewLoaders = {
  send: resilient(() => import('@/pages/Send').then((m) => ({ default: m.Send }))),
  receive: resilient(() => import('@/pages/Receive').then((m) => ({ default: m.Receive }))),
  swap: resilient(() => import('@/pages/Swap').then((m) => ({ default: m.Swap }))),
  bridge: resilient(() => import('@/pages/Bridge').then((m) => ({ default: m.Bridge }))),
  pay: resilient(() => import('@/pages/Pay').then((m) => ({ default: m.Pay }))),
  history: resilient(() => import('@/pages/History').then((m) => ({ default: m.History }))),
  settings: resilient(() => import('@/pages/Settings').then((m) => ({ default: m.Settings }))),
  asset: resilient(() => import('@/pages/Asset').then((m) => ({ default: m.Asset }))),
  explore: resilient(() => import('@/pages/Explore').then((m) => ({ default: m.Explore }))),
  analytics: resilient(() => import('@/pages/Analytics').then((m) => ({ default: m.Analytics }))),
  tx: resilient(() => import('@/pages/TxDetails').then((m) => ({ default: m.TxDetails }))),
  bridges: resilient(() => import('@/pages/BridgeHistory').then((m) => ({ default: m.BridgeHistory }))),
} as const

type LazyView = keyof typeof viewLoaders

const started = new Set<LazyView>()

/** Starts loading one page (and, for Bridge, the Circle bridge kit it needs). Safe to call repeatedly. */
export function prefetchView(view: View): void {
  if (!(view in viewLoaders)) return
  const key = view as LazyView
  if (started.has(key)) return
  started.add(key)
  void viewLoaders[key]().catch(() => started.delete(key)) // a failed prefetch is retried on the next hint
  if (key === 'bridge') void import('./bridgeKit').then((m) => m.preloadBridgeKit())
}

const ORDER: LazyView[] = ['send', 'swap', 'receive', 'pay', 'history', 'bridge', 'settings', 'asset', 'analytics', 'tx', 'bridges', 'explore']

/** After the first screen is interactive, warm the remaining pages one at a time while the browser is idle. */
export function prefetchAllViewsWhenIdle(): () => void {
  let cancelled = false
  let i = 0
  // Safari has no requestIdleCallback: fall back to a short timer.
  const idle = (cb: () => void) => {
    const ric = (window as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (typeof ric === 'function') ric(cb, { timeout: 4_000 })
    else globalThis.setTimeout(cb, 1_500)
  }
  const step = () => {
    if (cancelled || i >= ORDER.length) return
    prefetchView(ORDER[i++])
    idle(step)
  }
  idle(step)
  return () => {
    cancelled = true
  }
}
