import type { SchedulerProfile } from '../entities'
import type { OptimizerEvaluation } from '../ports/optimizer'
import { DAY_MS } from './study-day'

/**
 * When to offer an optimization, and whether to keep its result
 * (`docs/spec/02-memory-system.md` §16).
 *
 * Pure policy, deliberately separate from the training itself: these are the two decisions
 * the product makes, and neither should require a native binary to test.
 */

/** §6: Anki 24.06+ needs no minimum and RemNote suggests ≥ 1,000; §16 settles on offering
 *  from ~400 reviews on. */
export const OPTIMIZER_MIN_REVIEWS = 400

/** §16: "re-optimize every 2ⁿ reviews (512, 1,024, 2,048…)". */
export const OPTIMIZER_CADENCE_BASE = 512

/** §16's "or monthly". */
export const OPTIMIZER_MAX_AGE_MS = 30 * DAY_MS

/**
 * The next 2ⁿ review count at or above `OPTIMIZER_CADENCE_BASE` that is strictly greater
 * than `trainedOnReviews` — the threshold the *next* optimization waits for.
 */
export function nextOptimizationThreshold(trainedOnReviews: number): number {
  let threshold = OPTIMIZER_CADENCE_BASE
  while (threshold <= trainedOnReviews) threshold *= 2
  return threshold
}

export type OptimizerOfferReason =
  /** Enough history, and never optimized. */
  | 'first'
  /** The review count crossed the next 2ⁿ threshold. */
  | 'reviews'
  /** A month has passed since the last run. */
  | 'monthly'

export interface OptimizerOffer {
  offered: boolean
  reason: OptimizerOfferReason | null
  /** Reviews needed for the next count-driven offer — what the settings screen counts
   *  toward. */
  nextThresholdReviews: number
}

/**
 * Whether to put "Optimize now" in front of the user.
 *
 * It never blocks a manual run: the settings screen's button stays enabled once there is
 * any history at all. This is about when the app *suggests* it.
 */
export function optimizationOffer(input: {
  /** Live reviews excluding rating 0 — what the training set would hold. */
  nReviews: number
  profile: Pick<SchedulerProfile, 'trainedAt' | 'nReviews'> | null
  now: Date
}): OptimizerOffer {
  const { nReviews, profile, now } = input
  const trainedOn = profile?.nReviews ?? 0
  const nextThresholdReviews = nextOptimizationThreshold(trainedOn)
  if (nReviews < OPTIMIZER_MIN_REVIEWS) {
    return { offered: false, reason: null, nextThresholdReviews }
  }
  const trainedAt = profile?.trainedAt ?? null
  if (trainedAt === null) return { offered: true, reason: 'first', nextThresholdReviews }
  if (nReviews >= nextThresholdReviews) {
    return { offered: true, reason: 'reviews', nextThresholdReviews }
  }
  if (now.getTime() - trainedAt.getTime() >= OPTIMIZER_MAX_AGE_MS) {
    return { offered: true, reason: 'monthly', nextThresholdReviews }
  }
  return { offered: false, reason: null, nextThresholdReviews }
}

export type HealthCheckReason = 'improved' | 'log_loss_not_better'

export interface HealthCheck {
  /** Whether the trained parameters may replace the current ones. */
  improved: boolean
  reason: HealthCheckReason
  /** `before − after`: positive when the new model predicts better. */
  logLossDelta: number
  rmseDelta: number
}

/**
 * Anki's "health check", and §16's rule: accept the new parameters **only if they improve**.
 *
 * Log loss alone decides. RMSE is reported because §13 shows it as model quality, but it is
 * not a second gate: it is a calibration summary over bins, and letting it veto a genuine
 * log-loss improvement would reject models that predict better.
 *
 * Equal is not better. Re-training on unchanged history reproduces the same parameters, and
 * rewriting the profile with them would reset `trained_at` and restart the monthly clock for
 * nothing.
 */
export function healthCheck(before: OptimizerEvaluation, after: OptimizerEvaluation): HealthCheck {
  const logLossDelta = before.logLoss - after.logLoss
  const rmseDelta = before.rmse - after.rmse
  const improved = after.logLoss < before.logLoss
  return {
    improved,
    reason: improved ? 'improved' : 'log_loss_not_better',
    logLossDelta,
    rmseDelta,
  }
}
