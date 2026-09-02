import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

/**
 * Whether the renderer currently has a network connection
 * (`docs/spec/08-ux.md` §1.6 "offline without surprises").
 *
 * `navigator.onLine` only reports whether the OS has *a* network interface up, not whether
 * any provider is actually reachable — it is the cheap, always-available signal for the
 * ambient indicator. Real per-provider reachability comes with the AI layer in F7, which
 * owns the connection status shown next to a cost estimate.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server snapshot: unused in Electron (no SSR), but `useSyncExternalStore` requires one
    // for the types, and "online" is the right default for a first paint.
    () => true,
  )
}
