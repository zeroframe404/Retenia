/**
 * §10 "Deferred verification" (and §11's remediation trigger of the same shape): a module the
 * diagnostic marked known is re-opened when its cards say otherwise — **2 lapses in 14 days**
 * over the module's cards, or a **mean R < 0.7**.
 *
 * Pure: the caller hands in the review logs of the window and the retrievability of each
 * card; this decides. A lapse is what `ts-fsrs` counts as one — an Again on a card that was in
 * Review — so an Again during the learning steps does not re-open anything.
 */

export const REOPEN_WINDOW_DAYS = 14
export const REOPEN_LAPSES = 2
export const REOPEN_MEAN_R = 0.7

const DAY_MS = 86_400_000
const RATING_AGAIN = 1
const STATE_NEW = 0
const STATE_REVIEW = 2

export interface ReopenLog {
  readonly rating: number
  /** The card's state *before* the review (`review_logs.state`). */
  readonly state: number
  readonly review: Date
}

export interface ReopenCard {
  readonly state: number
  /** R now, from the scheduler. */
  readonly retrievability: number
}

export interface ReopenInput {
  readonly now: Date
  readonly logs: readonly ReopenLog[]
  readonly cards: readonly ReopenCard[]
}

export type ReopenReason = 'lapses' | 'low_retention'

export interface ReopenVerdict {
  readonly reopen: boolean
  readonly reason: ReopenReason | null
  readonly lapses: number
  /** Over the cards that have been reviewed at all; `null` when none has. */
  readonly meanR: number | null
}

export function shouldReopen(input: ReopenInput): ReopenVerdict {
  const since = input.now.getTime() - REOPEN_WINDOW_DAYS * DAY_MS
  const lapses = input.logs.filter(
    (log) =>
      log.rating === RATING_AGAIN &&
      log.state === STATE_REVIEW &&
      log.review.getTime() >= since &&
      log.review.getTime() <= input.now.getTime(),
  ).length
  const reviewed = input.cards.filter((card) => card.state !== STATE_NEW)
  const meanR =
    reviewed.length === 0
      ? null
      : reviewed.reduce((sum, card) => sum + card.retrievability, 0) / reviewed.length

  if (lapses >= REOPEN_LAPSES) return { reopen: true, reason: 'lapses', lapses, meanR }
  if (meanR !== null && meanR < REOPEN_MEAN_R) {
    return { reopen: true, reason: 'low_retention', lapses, meanR }
  }
  return { reopen: false, reason: null, lapses, meanR }
}
