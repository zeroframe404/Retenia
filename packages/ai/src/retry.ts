import type { AiError } from './errors'
import type { Random } from './ports'

/**
 * When to try the same target again, when to move on, and when to stop
 * (`docs/spec/06-ai-providers.md` §6: "ordered fallback on 429/5xx/timeout").
 */

/**
 * Two, not three. Every attempt writes an `ai_calls` row, so attempts are visible and
 * costed; the point of a second one is to ride out a single blip, and past that the next
 * provider is a better bet than a longer wait.
 */
export const MAX_ATTEMPTS_PER_TARGET = 2

export const RETRY_BASE_MS = 500
/** Full jitter can draw 3 ms; a floor stops a "retry" being a second hammer. */
export const MIN_RETRY_MS = 50

export type Verdict = 'retry' | 'next-target' | 'give-up'

/**
 * `attempt` is 1-based and names the attempt that just failed.
 *
 * **A 429 is never retried against the same target.** The next target is a different key
 * on a different service and is available *now*, and when the whole chain is exhausted the
 * repo already owns the minutes-scale answer: the job queue re-runs the job in 2, 4, 8
 * minutes (`packages/core/src/jobs/backoff.ts`). Waiting inside the call would hold a
 * worker and a socket open to no purpose. That is also why there is no `Retry-After`
 * parser here — nothing would read it. 7.3's batch polling is the first caller that will.
 */
export function classify(error: AiError, attempt: number): Verdict {
  switch (error.code) {
    case 'budget_exceeded':
    case 'aborted':
      // Both are decisions, not failures: trying elsewhere would defeat them.
      return 'give-up'
    case 'server_error':
    case 'network':
      return attempt < MAX_ATTEMPTS_PER_TARGET ? 'retry' : 'next-target'
    default:
      // auth, rate_limited, bad_request, not_configured, model_not_priced,
      // all_targets_failed: the same target cannot fix any of them by being asked twice.
      return 'next-target'
  }
}

/** Full jitter over `[MIN_RETRY_MS, RETRY_BASE_MS)` — spread, not a thundering herd. */
export function retryDelayMs(random: Random = Math.random): number {
  return Math.max(MIN_RETRY_MS, Math.floor(random() * RETRY_BASE_MS))
}
