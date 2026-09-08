import type { AbortSignalLike } from '@retenia/core'

/**
 * Turn core's structural `AbortSignalLike` into a real `AbortSignal` where there is one.
 *
 * A genuine signal passes through **unwrapped** — same object, no listener added — so a
 * long-lived signal shared across many calls accumulates nothing.
 *
 * Anything else yields `undefined` and is checked once before dispatch instead. There is
 * deliberately **no polling timer**: `AbortSignalLike` is `{ readonly aborted: boolean }`
 * with no event to subscribe to, its only producer today is `LibraryService`'s option, and
 * `contextualize.ts` already checks `signal.aborted` between chunks — so mid-flight
 * cancellation has no caller, and a 50 ms poll would leak one interval per cancelled call
 * for the life of the process.
 */
export function toAbortSignal(like: AbortSignalLike | undefined): AbortSignal | undefined {
  if (like === undefined) return undefined
  return typeof (like as AbortSignal).addEventListener === 'function'
    ? (like as AbortSignal)
    : undefined
}

/** Whether a caller has already cancelled, for either signal shape. */
export function isAborted(like: AbortSignalLike | undefined): boolean {
  return like?.aborted === true
}
