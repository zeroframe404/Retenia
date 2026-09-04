import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import {
  atLeast,
  auditColumns,
  idColumn,
  inIntList,
  inIntListOrNull,
  inRange,
  inTextList,
  inTextListOrNull,
  type JsonObject,
  type JsonValue,
  jsonColumn,
  jsonObject,
  jsonValid,
  standardChecks,
  timestampColumn,
} from './_common'
import { examAttempts } from './exams'
import { CARD_STATES, cards, RATINGS } from './memory'
import { activities, lessons } from './paths'
import { aiCalls } from './system'

/**
 * What the user actually did: lesson sessions, activity attempts and the append-only FSRS
 * review log (docs/spec/02-memory-system.md §10, §14; docs/spec/03-activities.md §12).
 */

export const LESSON_SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const
export type LessonSessionStatus = (typeof LESSON_SESSION_STATUSES)[number]

/** A daily review session's lifecycle (docs/spec/02-memory-system.md §12). */
export const REVIEW_SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const
export type ReviewSessionStatus = (typeof REVIEW_SESSION_STATUSES)[number]

/** Where an attempt happened — decides XP, whether it feeds the scheduler and with which
 * `review_logs.context`. */
export const ATTEMPT_CONTEXTS = [
  'lesson',
  'review',
  'reinforcement',
  'exam',
  'diagnostic',
  'remediation',
] as const
export type AttemptContext = (typeof ATTEMPT_CONTEXTS)[number]

/** Declared confidence (diagnostic and mock exams): weights `1.0 / 0.6 / 0.3` in Elo and
 * marks "confident misconceptions". */
export const CONFIDENCE_LEVELS = ['sure', 'unsure', 'guessed'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/**
 * `review_logs.context` (docs/spec/02-memory-system.md §14): the six the spec lists plus
 * `import` for reviews reconstructed from an Anki `revlog` (docs/spec/07-architecture.md §9).
 */
export const REVIEW_CONTEXTS = [
  'daily',
  'lesson',
  'reinforcement',
  'exam_sim',
  'cram',
  'manual_postpone',
  'import',
] as const
export type ReviewContext = (typeof REVIEW_CONTEXTS)[number]

/**
 * One run through the daily queue (docs/spec/02-memory-system.md §12).
 *
 * `plan` holds the *order* the composer froze — card ids, not cards — and `progress` holds
 * how far through it the user got, so closing the app mid-session loses nothing. It is a
 * record of a session, never a second source of truth for the scheduler: every answer is
 * still one `review_logs` row and one `cards` update, so dropping this table would cost the
 * ability to resume and nothing else.
 */
export const reviewSessions = sqliteTable(
  'review_sessions',
  {
    id: idColumn(),
    status: text('status', { enum: REVIEW_SESSION_STATUSES }).notNull().default('in_progress'),
    startedAt: timestampColumn('started_at').notNull(),
    finishedAt: timestampColumn('finished_at'),
    durationMs: integer('duration_ms'),
    /** What the plan was composed with, so a resumed session is provably the same plan. */
    seed: text('seed').notNull().default(''),
    /** The frozen `SessionPlanSnapshot`: the queue order, not the cards themselves. */
    plan: jsonColumn('plan').$type<JsonObject>().notNull(),
    /** Cursor, per-entry outcomes and the pending final drill. */
    progress: jsonColumn('progress').$type<JsonObject>().notNull(),
    reviewed: integer('reviewed').notNull().default(0),
    again: integer('again').notNull().default(0),
    hard: integer('hard').notNull().default(0),
    /** How many cards overload protection moved when the session started (§7 rule 3). */
    postponed: integer('postponed').notNull().default(0),
    /** Correct / graded, in `[0, 1]`; NULL until something has been answered. */
    accuracy: real('accuracy'),
    xp: integer('xp').notNull().default(0),
    summary: jsonColumn('summary').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    // Partial: `findActive` is the only hot read and it only ever wants the open one.
    index('review_sessions_active')
      .on(t.startedAt)
      .where(sql`${t.status} = 'in_progress' AND ${t.deletedAt} IS NULL`),
    index('review_sessions_started').on(t.startedAt),
    check('review_sessions_status', inTextList(t.status, REVIEW_SESSION_STATUSES)),
    check('review_sessions_accuracy_range', inRange(t.accuracy, 0, 1)),
    check('review_sessions_duration_nonnegative', atLeast(t.durationMs, 0)),
    check('review_sessions_xp_nonnegative', atLeast(t.xp, 0)),
    check(
      'review_sessions_counts',
      sql`${t.reviewed} >= 0 AND ${t.again} >= 0 AND ${t.hard} >= 0 AND ${t.postponed} >= 0 AND ${t.again} + ${t.hard} <= ${t.reviewed}`,
    ),
    check(
      'review_sessions_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check('review_sessions_plan_json', jsonObject(t.plan)),
    check('review_sessions_progress_json', jsonObject(t.progress)),
    check('review_sessions_summary_json', jsonObject(t.summary)),
    ...standardChecks('review_sessions', t),
  ],
)

/** One run through a lesson's practice block: XP, accuracy, and what entered memory. */
export const lessonSessions = sqliteTable(
  'lesson_sessions',
  {
    id: idColumn(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id),
    status: text('status', { enum: LESSON_SESSION_STATUSES }).notNull().default('in_progress'),
    startedAt: timestampColumn('started_at').notNull(),
    finishedAt: timestampColumn('finished_at'),
    durationMs: integer('duration_ms'),
    xp: integer('xp').notNull().default(0),
    /** Correct / total over the session's graded attempts, in `[0, 1]`. */
    accuracy: real('accuracy'),
    activitiesTotal: integer('activities_total').notNull().default(0),
    activitiesCorrect: integer('activities_correct').notNull().default(0),
    /** The closing summary: items that entered memory, weak concepts, streak effect. */
    summary: jsonColumn('summary').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    index('lesson_sessions_lesson').on(t.lessonId),
    index('lesson_sessions_started').on(t.startedAt),
    check('lesson_sessions_status', inTextList(t.status, LESSON_SESSION_STATUSES)),
    check('lesson_sessions_xp_nonnegative', atLeast(t.xp, 0)),
    check('lesson_sessions_accuracy_range', inRange(t.accuracy, 0, 1)),
    check('lesson_sessions_duration_nonnegative', atLeast(t.durationMs, 0)),
    check(
      'lesson_sessions_counts',
      sql`${t.activitiesTotal} >= 0 AND ${t.activitiesCorrect} >= 0 AND ${t.activitiesCorrect} <= ${t.activitiesTotal}`,
    ),
    check(
      'lesson_sessions_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check('lesson_sessions_summary_json', jsonObject(t.summary)),
    ...standardChecks('lesson_sessions', t),
  ],
)

/**
 * One answer to one activity, with the `GradeResult` and the raw signals every rating
 * strategy needs (`timeMs`, `attempts`, `hintsUsed`, `confidence`). When the activity was
 * a scheduled review, `card_id` links it to the card and the resulting `review_logs` row
 * points back here.
 */
export const attempts = sqliteTable(
  'attempts',
  {
    id: idColumn(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id),
    context: text('context', { enum: ATTEMPT_CONTEXTS }).notNull(),
    lessonSessionId: text('lesson_session_id').references(() => lessonSessions.id),
    examAttemptId: text('exam_attempt_id').references(() => examAttempts.id),
    cardId: text('card_id').references(() => cards.id),
    startedAt: timestampColumn('started_at').notNull(),
    finishedAt: timestampColumn('finished_at'),
    /** `GradeResult.score` in `[0, 1]`. */
    score: real('score'),
    /** `GradeResult.correct`. */
    correct: integer('correct'),
    /** The rating the strategy derived (`1–4`), `0` for a manual grade, `NULL` if none. */
    rating: integer('rating'),
    /** What the user submitted, in the family's answer shape. */
    answer: jsonColumn('answer').$type<JsonValue>(),
    /** `GradeResult.feedback` plus `perItem`. */
    feedback: jsonColumn('feedback').$type<JsonValue>(),
    timeMs: integer('time_ms'),
    /** Tries used on this attempt (progressive hints, retry policies). */
    tries: integer('tries').notNull().default(1),
    hintsUsed: integer('hints_used').notNull().default(0),
    confidence: text('confidence', { enum: CONFIDENCE_LEVELS }),
    /** The `ai_calls` row that graded a free-text answer. */
    aiEvalCallId: text('ai_eval_call_id').references(() => aiCalls.id),
    ...auditColumns(),
  },
  (t) => [
    index('attempts_activity').on(t.activityId),
    index('attempts_session').on(t.lessonSessionId),
    index('attempts_exam_attempt').on(t.examAttemptId),
    index('attempts_card').on(t.cardId),
    index('attempts_started').on(t.startedAt),
    check('attempts_context', inTextList(t.context, ATTEMPT_CONTEXTS)),
    check('attempts_confidence', inTextListOrNull(t.confidence, CONFIDENCE_LEVELS)),
    check('attempts_score_range', inRange(t.score, 0, 1)),
    check('attempts_correct_bool', sql`${t.correct} IS NULL OR ${t.correct} IN (0, 1)`),
    check('attempts_rating', inIntListOrNull(t.rating, RATINGS)),
    check('attempts_time_nonnegative', atLeast(t.timeMs, 0)),
    check('attempts_tries_positive', atLeast(t.tries, 1)),
    check('attempts_hints_nonnegative', atLeast(t.hintsUsed, 0)),
    check(
      'attempts_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check('attempts_answer_json', jsonValid(t.answer)),
    check('attempts_feedback_json', jsonValid(t.feedback)),
    ...standardChecks('attempts', t),
  ],
)

/**
 * Immutable review history: the source of truth for the optimizer, statistics, rollback
 * and sync. Append-only — rows are inserted and never updated, so `updated_at` always
 * equals `created_at` and `version` stays 1; `deleted_at` is only ever set when the parent
 * card is soft-deleted.
 *
 * The nine FSRS columns are `ts-fsrs`'s `ReviewLog` verbatim: `rating`, `state`, `due`,
 * `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `review`.
 * As in `ts-fsrs`, `state`/`stability`/`difficulty` are the card's values *before* the
 * review and `due` is the card's previous `last_review` — or its `due` when it had never
 * been reviewed — exactly what `f.rollback` restores; `review` is when it happened (Unix
 * ms, UTC). `scheduled_days` is the real FSRS interval even under an exam cap, so the
 * optimizer is never contaminated.
 */
export const reviewLogs = sqliteTable(
  'review_logs',
  {
    id: idColumn(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),

    // --- ts-fsrs ReviewLog, 1:1 ---
    rating: integer('rating').notNull(),
    state: integer('state').notNull(),
    due: timestampColumn('due').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: integer('elapsed_days').notNull(),
    scheduledDays: integer('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    review: timestampColumn('review').notNull(),

    // --- Retenia additions ---
    durationMs: integer('duration_ms'),
    context: text('context', { enum: REVIEW_CONTEXTS }).notNull(),
    /** The continuous `[0, 1]` exercise score behind the rating, for later analysis. */
    exerciseScore: real('exercise_score'),
    /** Free-form label of the reviewing device (hostname/platform) — distinct from the
     * sync `device_id`, which identifies the installation. */
    device: text('device'),
    /** The activity attempt that produced this review, when there was one. */
    attemptId: text('attempt_id').references(() => attempts.id),
    /**
     * Which scheduler produced this row — `fsrs6` today (docs/spec/02-memory-system.md §17:
     * "abstract the scheduler and store `algorithm_version`"). Lets a future FSRS variant
     * ("-S", "-F") or an SM-2 import be told apart when the optimizer selects its training
     * set, without a second table.
     */
    algorithmVersion: text('algorithm_version').notNull().default('fsrs6'),
    ...auditColumns(),
  },
  (t) => [
    // `rl_card` of docs/spec/02-memory-system.md §14: the card's history in time order.
    index('rl_card').on(t.cardId, t.review),
    index('rl_review').on(t.review),
    index('rl_attempt').on(t.attemptId),
    check('review_logs_rating', inIntList(t.rating, RATINGS)),
    check('review_logs_state', inIntList(t.state, CARD_STATES)),
    check('review_logs_context', inTextList(t.context, REVIEW_CONTEXTS)),
    check('review_logs_stability_nonnegative', atLeast(t.stability, 0)),
    check('review_logs_difficulty_range', inRange(t.difficulty, 0, 10)),
    // `elapsed_days` is deliberately not range-checked: ts-fsrs derives it from
    // `last_review`, so an imported history (`context = 'import'`) or a clock that stepped
    // back can produce a negative value, and a review must never be lost to a CHECK.
    check('review_logs_scheduled_days_nonnegative', atLeast(t.scheduledDays, 0)),
    check('review_logs_learning_steps_nonnegative', atLeast(t.learningSteps, 0)),
    check('review_logs_duration_nonnegative', atLeast(t.durationMs, 0)),
    check('review_logs_exercise_score_range', inRange(t.exerciseScore, 0, 1)),
    check('review_logs_append_only', sql`${t.updatedAt} = ${t.createdAt} AND ${t.version} = 1`),
    ...standardChecks('review_logs', t),
  ],
)
