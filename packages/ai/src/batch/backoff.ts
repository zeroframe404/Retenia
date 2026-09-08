import type { Random } from '../ports'

/**
 * How often to ask whether a batch is done.
 *
 * The shape of the problem, from `docs/spec/06-ai-providers.md` §2: "most finish in under
 * 1 h, maximum 24 h". So the first minute matters — a small batch really can come back in
 * seconds and the user is watching a tray row — and everything after that does not, because
 * a poll is a free HTTP call whose only cost is a rate limit shared with the calls that are
 * doing actual work.
 *
 * Exponential from 5 s, doubling, capped at 5 minutes: about a dozen polls in the first ten
 * minutes and twelve an hour thereafter, which is 300-odd requests across the 24 h ceiling.
 * Jitter is ±20 % so that fifteen batches submitted by one generation run do not all wake at
 * the same instant for the next day.
 */

export const POLL_BASE_MS = 5_000
export const POLL_MAX_MS = 5 * 60_000
/** ±20 %, spread rather than a thundering herd. */
export const POLL_JITTER = 0.2

/**
 * The delay before poll number `attempt` (1-based: `attempt = 1` is the first poll after
 * submission).
 *
 * `retryAfterMs` wins outright when the provider sent one. That is the whole reason
 * `retry.ts` says "7.3's batch polling is the first caller that will [read `Retry-After`]":
 * a 429 on a poll is the provider telling us exactly how long to wait, and guessing shorter
 * than it asked is how a polite backoff becomes a rate-limit spiral.
 */
export function pollDelayMs(
  attempt: number,
  random: Random = Math.random,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, POLL_MAX_MS * 2)
  }
  const step = Math.max(1, Math.floor(attempt))
  // `2 ** 40` overflows into Infinity long before a day of polling would reach it; the min
  // is taken first so the exponent stays small regardless of how long a batch has been stuck.
  const uncapped = POLL_BASE_MS * 2 ** Math.min(step - 1, 20)
  const base = Math.min(uncapped, POLL_MAX_MS)
  const jitter = 1 + (random() * 2 - 1) * POLL_JITTER
  return Math.max(1_000, Math.round(base * jitter))
}
