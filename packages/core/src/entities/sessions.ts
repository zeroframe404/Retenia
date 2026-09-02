import type { Entity, JsonObject, JsonValue } from './_common'
import type {
  AttemptContext,
  CardState,
  ConfidenceLevel,
  LessonSessionStatus,
  Rating,
  ReviewContext,
} from './enums'

/** What the user actually did: lesson sessions, activity attempts, and the append-only
 *  FSRS review log. */

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
  lessonSessionId: string | null
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
 * `ts-fsrs`'s `ReviewLog`, 1:1, plus Retenia's context. Append-only: `state`, `due`,
 * `stability` and `difficulty` are the card's values *before* the review, so the history can
 * be replayed or rolled back. `elapsedDays` is not range-checked — an import or a clock step
 * can make it negative, and a review must never be lost to a constraint.
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
}
