import type { SecretStore } from '@retenia/core'

/** Injected so jitter is a value a test can pin, not a source of flake. */
export type Random = () => number

export interface Timers {
  setTimeout(fn: () => void, ms: number): void
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    setTimeout(fn, ms)
  },
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      function onAbort(): void {
        clearTimeout(timer)
        resolve()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}

/**
 * Narrowed from core's four-method `SecretStore`. `Pick`ed rather than redeclared so it
 * cannot drift, and narrowed so this layer structurally cannot write or delete a key —
 * only read the one it is about to use.
 */
export type SecretReader = Pick<SecretStore, 'getSecret'>
