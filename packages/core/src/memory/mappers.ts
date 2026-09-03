import type {
  Card as FsrsCard,
  Rating as FsrsRating,
  ReviewLog as FsrsReviewLog,
  State as FsrsState,
} from 'ts-fsrs'
import type { Card, CardState, Rating, ReviewLog } from '../entities'
import { type ReviewLogDraft, SCHEDULER_ALGORITHM_VERSION } from './types'

/**
 * The 1:1 mapping between the domain `Card`/`ReviewLog` and `ts-fsrs`'s (`CLAUDE.md`,
 * "FSRS fields mirror ts-fsrs 1:1"). Same names modulo casing, same units (days, `Date`),
 * same semantics — including `ReviewLog.due` being the card's previous `last_review`.
 *
 * Two things do not cross: `Card.elapsed_days`, which `ts-fsrs` 5 still carries but
 * recomputes from `last_review` on every review and drops in 6.0 (§5), and
 * `ReviewLog.last_elapsed_days`, its deprecated twin. Both are written as 0 on the way in
 * and ignored on the way out.
 */

/** The nine FSRS fields of a `Card`. */
export type FsrsCardFields = Pick<
  Card,
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'scheduledDays'
  | 'learningSteps'
  | 'reps'
  | 'lapses'
  | 'state'
  | 'lastReview'
>

/** The nine FSRS fields of a `ReviewLog`. */
export type FsrsReviewLogFields = Pick<
  ReviewLog,
  | 'rating'
  | 'state'
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'elapsedDays'
  | 'scheduledDays'
  | 'learningSteps'
  | 'review'
>

function copyDate(date: Date): Date {
  return new Date(date.getTime())
}

function toCardState(state: number): CardState {
  if (state === 0 || state === 1 || state === 2 || state === 3) return state
  throw new RangeError(`ts-fsrs returned an unknown card state ${String(state)}`)
}

function toRating(rating: number): Rating {
  if (rating === 0 || rating === 1 || rating === 2 || rating === 3 || rating === 4) return rating
  throw new RangeError(`ts-fsrs returned an unknown rating ${String(rating)}`)
}

/** Domain card → `ts-fsrs` card. Dates are copied, never shared. */
export function toFsrsCard(card: FsrsCardFields): FsrsCard {
  return {
    due: copyDate(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: 0,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as FsrsState,
    last_review: card.lastReview === null ? undefined : copyDate(card.lastReview),
  }
}

/** `ts-fsrs` card → the domain card, keeping everything of `base` that is not FSRS's. */
export function fromFsrsCard<T extends FsrsCardFields>(fsrsCard: FsrsCard, base: T): T {
  return {
    ...base,
    due: copyDate(fsrsCard.due),
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    scheduledDays: fsrsCard.scheduled_days,
    learningSteps: fsrsCard.learning_steps,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    state: toCardState(fsrsCard.state),
    lastReview: fsrsCard.last_review === undefined ? null : copyDate(fsrsCard.last_review),
  }
}

/** Domain log → `ts-fsrs` log (what `rollback` and `reschedule` consume). */
export function toFsrsReviewLog(log: FsrsReviewLogFields): FsrsReviewLog {
  return {
    rating: log.rating as FsrsRating,
    state: log.state as FsrsState,
    due: copyDate(log.due),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsedDays,
    last_elapsed_days: 0,
    scheduled_days: log.scheduledDays,
    learning_steps: log.learningSteps,
    review: copyDate(log.review),
  }
}

/** `ts-fsrs` log → the FSRS half of a `review_logs` row, stamped with the algorithm. */
export function fromFsrsReviewLog(log: FsrsReviewLog, cardId: string): ReviewLogDraft {
  return {
    cardId,
    rating: toRating(log.rating),
    state: toCardState(log.state),
    due: copyDate(log.due),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsedDays: log.elapsed_days,
    scheduledDays: log.scheduled_days,
    learningSteps: log.learning_steps,
    review: copyDate(log.review),
    algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
  }
}
