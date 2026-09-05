import type { ReviewContext } from '../entities'
import type { ActivityStatsRepository } from '../ports/activity-stats-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { GradeResult, RatingSignals, ReviewSpec } from './rating'
import { clampForContext, feedsScheduler, toRating } from './rating'
import type { ReviewCard, ReviewCardResult } from './review-card'
import type { Grade } from './types'

/**
 * One graded activity → the reviews it produced.
 *
 * This is where §10's two halves meet: `toRating` turns the grade into a 1–4, and
 * `reviewCard` turns that into a card update and a `review_logs` row. It exists as its own
 * use case because of the sentence in §10 that neither half can honour alone —
 *
 * > A composite exercise generates reviews for the skills it uses.
 *
 * — and its consequence in §5 of `docs/spec/03-activities.md`: *"The scheduler schedules
 * **skills**"*, not screens. One `matching_pairs` grid over eight term–definition pairs is
 * one answer and eight skills; each gets its own card, its own D/S and its own log row, and
 * all of them carry the same `attemptId` so the eight rows can be recognised afterwards as
 * one thing the user did.
 *
 * The rating is computed **once**, from the whole grade, and applied to every skill. That
 * is the honest reading of a composite: the grader scored the answer, not each pair, and
 * splitting a 6/8 into "these six were right" would invent per-skill evidence the activity
 * never gathered. A type that genuinely knows which skill failed should emit one
 * `reviewActivity` call per skill with its own `GradeResult`.
 */

export interface ReviewActivityDeps {
  reviewCard: ReviewCard
  /**
   * The rolling per-type median (§10's "personal median"). Omit and speed simply stops
   * being evidence — `toRating` then never reads a time as fast or slow.
   */
  activityStats?: Pick<ActivityStatsRepository, 'medianMs'>
  /** Falls back to `ReviewLogRepository.medianDurationMs` for a type with no history of its
   *  own, so the very first `mcq_single` is still judged against how fast this user is. */
  reviewLogs?: Pick<ReviewLogRepository, 'medianDurationMs'>
}

export interface ReviewActivityInput {
  /** The activity type id — `review_logs.activity_type` and the median's key. */
  activityType: string
  /**
   * The cards the activity exercised, in the order the skills appear on it. One review log
   * each. Duplicates are ignored: a grid that asks about the same skill twice is still one
   * piece of evidence about it, and two logs would double-count it in the optimizer.
   */
  skills: readonly string[]
  result: GradeResult
  review: ReviewSpec
  /** Extra per-row signals §10 grades on — today only the ordering row's pair count. */
  signals?: RatingSignals
  /**
   * The `attempts` row this answer was recorded as, shared by every row written here — the
   * link that says the logs were one thing the user did.
   *
   * Defaults to `null`, and **must be a real `attempts.id`** when it is not:
   * `review_logs.attempt_id` is a foreign key and the database runs with
   * `PRAGMA foreign_keys = ON`, so an id minted here with no row behind it would fail every
   * insert. The activity host owns that row (sub-phase 5.2); this use case carries its id.
   */
  attemptId?: string | null
  /** Defaults to `review.context`, then to `daily`. */
  context?: ReviewContext
  now?: Date
  device?: string | null
  /**
   * Overrides the rating `toRating` derived — the M-self case, where the user pressed the
   * button, M-ai's "the rubric returns a rating and the user can correct it", and the
   * learner's self-rating after an `uncertain` grade.
   *
   * The *reason* for a correction travels on the grade itself
   * (`result.meta.ratingOverride`), where it is persisted with the attempt; this field is
   * only the number the scheduler is to act on.
   *
   * Still passes through §9's exam clamp: "do not use Easy in an exam" is a property of the
   * exam, not of how the rating was arrived at. Nothing else about it is second-guessed — a
   * deliberate press is exactly the case where the code should defer to the person.
   */
  rating?: Grade
}

export interface ReviewActivityResult {
  /** The rating every skill was reviewed with, or `null` when nothing was written. */
  rating: Grade | null
  /** The shared `attempt_id` on all of the rows below. */
  attemptId: string | null
  /** One entry per skill, in the order they were given. Empty when nothing was written. */
  reviews: readonly ReviewCardResult[]
  /**
   * Why no review was written, when `rating` is `null`:
   * - `not-eligible` — a lesson-only type or M-none: §10's games "do not feed the scheduler".
   * - `awaiting-user` — M-self: the rating is the user's to press, so call again with it.
   * - `uncertain` — the AI grader declined to commit (`docs/spec/04-path-generation.md`
   *   §12: it "affects neither Elo nor FSRS"). Like `awaiting-user`, it is resolved by
   *   calling again with the rating the learner picked.
   * - `no-skills` — the activity named no cards to schedule.
   */
  skipped: 'not-eligible' | 'awaiting-user' | 'uncertain' | 'no-skills' | null
}

export type ReviewActivity = (input: ReviewActivityInput) => Promise<ReviewActivityResult>

const NOTHING: readonly ReviewCardResult[] = Object.freeze([])

export function createReviewActivity(deps: ReviewActivityDeps): ReviewActivity {
  const { reviewCard } = deps

  /** The personal median for this type: its own if it has one, the overall one if not. */
  async function medianFor(activityType: string): Promise<number | null> {
    const own = (await deps.activityStats?.medianMs(activityType)) ?? null
    if (own !== null && own > 0) return own
    const overall = (await deps.reviewLogs?.medianDurationMs()) ?? null
    return overall !== null && overall > 0 ? overall : null
  }

  return async (input) => {
    if (typeof input.activityType !== 'string' || input.activityType.length === 0) {
      throw new TypeError('reviewActivity: activityType must be a non-empty string')
    }

    // De-duplicated in place so the caller's order survives: `skills` is the order the
    // renderer showed them in, and a stable order makes the rows reproducible in tests.
    const skills = [...new Set(input.skills)]

    if (!feedsScheduler(input.review)) {
      return { rating: null, attemptId: null, reviews: NOTHING, skipped: 'not-eligible' }
    }
    if (skills.length === 0) {
      return { rating: null, attemptId: null, reviews: NOTHING, skipped: 'no-skills' }
    }

    // Resolved once and used for both the mapping and the row. §9 changes the *mapping* for
    // a mock exam, and only the session knows it is one — deciding the context after
    // `toRating` had already read a different one would file a daily-rules rating (Easy and
    // all) under `context = 'exam_sim'`.
    const context: ReviewContext = input.context ?? input.review.context ?? 'daily'
    const review: ReviewSpec = { ...input.review, context }

    const personal = { medianMs: await medianFor(input.activityType) }
    const rating =
      input.rating === undefined
        ? toRating(input.result, review, personal, input.signals ?? {})
        : clampForContext(input.rating, review, input.result, personal)
    if (rating === null) {
      // Two things survive `feedsScheduler` without producing a rating: M-self, where the
      // button is the user's to press, and an `uncertain` AI grade, where the rubric
      // declined to commit. Both wait for the same input; only the reason differs, and the
      // UI says something different for each.
      const skipped = input.result.meta.uncertain === true ? 'uncertain' : 'awaiting-user'
      return { rating: null, attemptId: null, reviews: NOTHING, skipped }
    }

    const attemptId = input.attemptId ?? null

    /*
     * Sequential, one transaction per card, rather than one transaction over all of them.
     *
     * `reviewCard` owns its own transaction — it has to, because it reads the card and
     * writes it back under an optimistic-concurrency check — and nesting a second boundary
     * around a loop of them would hold the write lock across every policy resolution in the
     * batch, which is exactly what `UnitOfWork.transaction`'s contract forbids. Each skill
     * is independently valid: a failure part-way leaves the skills already written correctly
     * scheduled and the rest untouched, which is the same state as answering them one at a
     * time. The shared `attemptId` is what says they were one answer.
     */
    const reviews: ReviewCardResult[] = []
    for (const cardId of skills) {
      reviews.push(
        await reviewCard({
          cardId,
          rating,
          context,
          activityType: input.activityType,
          exerciseScore: input.result.score,
          durationMs: input.result.meta.timeMs > 0 ? input.result.meta.timeMs : null,
          attemptId,
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.device === undefined ? {} : { device: input.device }),
        }),
      )
    }

    return { rating, attemptId, reviews, skipped: null }
  }
}
