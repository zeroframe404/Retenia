import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import {
  auditColumns,
  idColumn,
  inTextList,
  inTextListOrNull,
  type JsonObject,
  type JsonValue,
  jsonArray,
  jsonColumn,
  jsonObject,
  standardChecks,
  timestampColumn,
} from './_common'
import { pathVersions } from './paths'

/**
 * The prior-knowledge diagnostic (docs/spec/04-path-generation.md §10; sub-phase 8.5): the
 * adaptive quiz that marks the modules of a frozen path you already know and seeds their
 * memory. Mirrors `DIAGNOSTIC_*` in `@retenia/core`; a test pins the lists together.
 */

/** A diagnostic is open until it stops for one of `DIAGNOSTIC_STOP_REASONS`. There is no
 *  `abandoned` status: walking away is a stop reason, recorded on a `completed` row. */
export const DIAGNOSTIC_SESSION_STATUSES = ['in_progress', 'completed'] as const
export type DiagnosticSessionStatus = (typeof DIAGNOSTIC_SESSION_STATUSES)[number]

/** How the user came in: "desde cero", "ya sé parte", or the preview's "ya lo sé" — the
 *  last recorded as an already-completed session so its effects can be undone the same way. */
export const DIAGNOSTIC_ENTRIES = ['scratch', 'partial', 'preview'] as const
export type DiagnosticEntry = (typeof DIAGNOSTIC_ENTRIES)[number]

/** §10 step 7, plus `from_scratch` (nothing was ever going to be asked) and `no_items` (the
 *  bank ran out of items that would not repeat a concept). */
export const DIAGNOSTIC_STOP_REASONS = [
  'from_scratch',
  'all_classified',
  'no_items',
  'max_items',
  'time_limit',
  'abandoned',
] as const
export type DiagnosticStopReason = (typeof DIAGNOSTIC_STOP_REASONS)[number]

/**
 * One run of the diagnostic over one path version.
 *
 * The engine is a pure function of its configuration and its answer log, so `answers` is
 * the whole state: resuming replays it. `pending` is the item currently on screen (`{
 * itemBankId, attemptId, difficulty, servedAt }`), so closing the app mid-question serves the
 * same question again rather than a new one. `result` is the `DiagnosticResult` once the
 * session stops, and `applied` records what its actions wrote (lessons marked complete, cards
 * seeded, priorities raised) — the input to undo and to deferred verification.
 */
export const diagnosticSessions = sqliteTable(
  'diagnostic_sessions',
  {
    id: idColumn(),
    pathVersionId: text('path_version_id')
      .notNull()
      .references(() => pathVersions.id),
    status: text('status', { enum: DIAGNOSTIC_SESSION_STATUSES }).notNull().default('in_progress'),
    entry: text('entry', { enum: DIAGNOSTIC_ENTRIES }).notNull(),
    /** Section spec id → `never | familiar | know | master` (§10 step 1). */
    selfAssessment: jsonColumn('self_assessment').$type<JsonObject>().notNull().default(sql`'{}'`),
    /** The ordered answer log the engine replays. */
    answers: jsonColumn('answers').$type<JsonValue[]>().notNull().default(sql`'[]'`),
    /** The item currently served, NULL between items and once the session stops. */
    pending: jsonColumn('pending').$type<JsonObject>(),
    /** The `DiagnosticResult`, NULL while in progress. */
    result: jsonColumn('result').$type<JsonObject>(),
    /** What the result's actions wrote, for undo and deferred verification. */
    applied: jsonColumn('applied').$type<JsonObject>().notNull().default(sql`'{}'`),
    stopReason: text('stop_reason', { enum: DIAGNOSTIC_STOP_REASONS }),
    startedAt: timestampColumn('started_at').notNull(),
    finishedAt: timestampColumn('finished_at'),
    ...auditColumns(),
  },
  (t) => [
    index('diagnostic_sessions_version').on(t.pathVersionId),
    // Partial: `findActive` is the hot read, and it only ever wants the open one.
    index('diagnostic_sessions_active')
      .on(t.pathVersionId)
      .where(sql`${t.status} = 'in_progress' AND ${t.deletedAt} IS NULL`),
    check('diagnostic_sessions_status', inTextList(t.status, DIAGNOSTIC_SESSION_STATUSES)),
    check('diagnostic_sessions_entry', inTextList(t.entry, DIAGNOSTIC_ENTRIES)),
    check(
      'diagnostic_sessions_stop_reason',
      inTextListOrNull(t.stopReason, DIAGNOSTIC_STOP_REASONS),
    ),
    check(
      'diagnostic_sessions_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check('diagnostic_sessions_self_assessment_json', jsonObject(t.selfAssessment)),
    check('diagnostic_sessions_answers_json', jsonArray(t.answers)),
    check('diagnostic_sessions_pending_json', jsonObject(t.pending)),
    check('diagnostic_sessions_result_json', jsonObject(t.result)),
    check('diagnostic_sessions_applied_json', jsonObject(t.applied)),
    ...standardChecks('diagnostic_sessions', t),
  ],
)
