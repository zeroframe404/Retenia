/**
 * Retry policy for failed jobs: "backoff of 2ⁿ minutes"
 * (`docs/spec/07-architecture.md` §7).
 *
 * The *decision* to retry belongs to `JobRepository.fail`, which already compares `attempts`
 * against `maxAttempts`. This module only answers "and when?".
 */

/** `docs/spec/07-architecture.md` §5: the `jobs.max_attempts` column defaults to 3. */
export const DEFAULT_MAX_ATTEMPTS = 3

const MINUTE_MS = 60_000

/** One hour. Without a ceiling a job whose `maxAttempts` was raised would schedule its
 *  later retries days out, which is never what anyone wants from a desktop app. */
export const MAX_BACKOFF_MS = 60 * MINUTE_MS

export interface BackoffOptions {
  /** Delay after the first failure. Doubles from there. Defaults to one minute, so the
   *  first retry lands 2 minutes out. */
  baseMs?: number
  maxMs?: number
}

/**
 * How long to wait after `attempts` failures: 2ⁿ minutes, capped.
 *
 * `attempts` is the value the row carries *after* the failed run (the claim increments it),
 * so the first failure gives 2 minutes, the second 4, the third 8.
 */
export function backoffDelayMs(attempts: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? MINUTE_MS
  const max = options.maxMs ?? MAX_BACKOFF_MS
  const exponent = Math.max(1, Math.floor(attempts))
  // 2**exponent grows past Number.MAX_SAFE_INTEGER around 1024; clamping the exponent keeps
  // the arithmetic finite for an absurd `maxAttempts` without changing any real answer,
  // since everything past a handful of attempts is capped anyway.
  const factor = 2 ** Math.min(exponent, 32)
  return Math.min(base * factor, max)
}

/** When a job that has failed `attempts` times becomes eligible again. */
export function nextRetryAt(attempts: number, now: Date, options: BackoffOptions = {}): Date {
  return new Date(now.getTime() + backoffDelayMs(attempts, options))
}
