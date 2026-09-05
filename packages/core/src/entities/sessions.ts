import type { Entity, JsonObject, JsonValue } from './_common'
import type {
  AttemptContext,
  AttemptMode,
  CardState,
  ConfidenceLevel,
  LessonSessionStatus,
  Rating,
  ReviewContext,
  ReviewSessionStatus,
} from './enums'

/** What the user actually did: lesson sessions, daily review sessions, activity attempts,
 *  and the append-only FSRS review log. */

export interface LessonSession extends Entity {
  lessonId: string
  status: LessonSessionStatus
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  xp: number
  accuracy: number | null
  activitiesTotal: number
  activitiesCorrect: number
  summary: JsonObject | null
}

/** One go at one activity, in whatever context it was served. */
export interface Attempt extends Entity {
  activityId: string
  context: AttemptContext
  /**
   * How the activity was served — `docs/spec/03-activities.md` §12's study/test split and
   * §5's Legendary policy. `test` means hints were withheld and feedback deferred, so a
   * slow answer under it is not evidence of the same thing a slow `study` answer is; §17
   * risk 3's "measure true retention per type and adjust" cannot be done honestly without
   * knowing which posture produced the row.
   */
  mode: AttemptMode
  lessonSessionId: string | null
  /** The daily review session this answer belonged to, when it came from one. */
  reviewSessionId: string | null
  examAttemptId: string | null
  /** Set when the attempt fed the scheduler — the link to the review log. */
  cardId: string | null
  startedAt: Date
  finishedAt: Date | null
  score: number | null
  correct: boolean | null
  rating: Rating | null
  answer: JsonValue | null
  feedback: JsonValue | null
  timeMs: number | null
  tries: number
  hintsUsed: number
  confidence: ConfidenceLevel | null
  aiEvalCallId: string | null
}

/**
 * `ts-fsrs`'s `ReviewLog`, 1:1, plus Retenia's context. Append-only: `state`, `stability`
 * and `difficulty` are the card's values *before* the review, and `due` is — as in
 * `ts-fsrs` — the card's previous `lastReview`, or its `due` when it had never been
 * reviewed; that is exactly what `rollback` needs to restore the card, and what
 * `reschedule` replays. `elapsedDays` is not range-checked — an import or a clock step can
 * make it negative, and a review must never be lost to a constraint.
 */
export interface ReviewLog extends Entity {
  cardId: string

  // --- ts-fsrs ReviewLog, 1:1 (values before the review) ---
  rating: Rating
  state: CardState
  due: Date
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  review: Date

  // --- Retenia additions ---
  durationMs: number | null
  context: ReviewContext
  /** The grader's 0–1 score, when the rating came from an exercise rather than a button. */
  exerciseScore: number | null
  device: string | null
  attemptId: string | null
  /**
   * The activity type that produced this review (`mcq_single`, `cloze_typed`,
   * `pronunciation_word`…), or `null` for a rating pressed on a plain flashcard.
   *
   * §17 risk 3 is the reason it is a column rather than something to be joined out of
   * `attempts`: *"The Hard/Easy thresholds of the automatic exercises are heuristic:
   * measure true retention per type and adjust"* — that measurement is a `GROUP BY` over
   * this history, and it has to survive the attempt row being pruned. It is also the key
   * of the rolling per-type median in `activity_stats`.
   */
  activityType: string | null
  /** The scheduler that produced the row: `fsrs6` today (`docs/spec/02-memory-system.md`
   *  §17). Lets an FSRS variant or an SM-2 import be told apart in the training set. */
  algorithmVersion: string
}

/**
 * One run through the daily queue (`docs/spec/02-memory-system.md` §12).
 *
 * The row exists so a session survives the app being closed: `plan` is the frozen queue the
 * composer produced and `progress` is how far through it the user got, so `session.start`
 * resumes an `in_progress` row instead of recomposing — recomposing would silently reorder
 * the queue under someone who is halfway through it.
 *
 * It is a *record of a session*, not a second source of truth for the scheduler: every
 * answer is still one `review_logs` row and one `cards` update. Delete this table and the
 * memory state is unharmed; only the ability to resume is lost.
 */
export interface ReviewSession extends Entity {
  status: ReviewSessionStatus
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  /** The seed the plan was composed with, so the same day replays identically. */
  seed: string
  /** The frozen `SessionPlan`. */
  plan: JsonObject
  /** The cursor and the per-entry outcomes — what `undo` and resume read. */
  progress: JsonObject
  reviewed: number
  /** How many answers were graded `Again` — the final drill's input. */
  again: number
  hard: number
  /** How many cards overload protection postponed when the session started. */
  postponed: number
  /** Correct over graded, in `[0, 1]`; `null` until something has been answered. */
  accuracy: number | null
  xp: number
  summary: JsonObject | null
}
