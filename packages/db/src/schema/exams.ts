import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import {
  atLeast,
  auditColumns,
  idColumn,
  inRange,
  inTextList,
  inTextListOrNull,
  isBool,
  type JsonObject,
  jsonArray,
  jsonColumn,
  jsonObject,
  standardChecks,
  timestampColumn,
} from './_common'
import { activities, modules, paths, pathVersions } from './paths'

/**
 * Exams (docs/spec/02-memory-system.md §8–§9, §14) and the item bank that feeds them
 * (docs/spec/04-path-generation.md §3 stage 9, §8 `ItemBankItem.v1`).
 */

/** `dated`: "study toward date X"; `mock`: blueprint-sampled practice exam; `final`: the
 * path's closing exam (form B); `diagnostic`: the prior-knowledge quiz. */
export const EXAM_KINDS = ['dated', 'mock', 'final', 'diagnostic'] as const
export type ExamKind = (typeof EXAM_KINDS)[number]

export const EXAM_STATUSES = ['planned', 'active', 'completed', 'archived'] as const
export type ExamStatus = (typeof EXAM_STATUSES)[number]

/** Parallel forms per blueprint cell: the mock exam uses A, the final exam B. */
export const EXAM_FORMS = ['A', 'B'] as const
export type ExamForm = (typeof EXAM_FORMS)[number]

/** `real` feeds the scheduler as `exam_sim` reviews; `blind` hides feedback until the end;
 * `preview` is the "do not affect my scheduling" option. */
export const EXAM_ATTEMPT_MODES = ['real', 'blind', 'preview'] as const
export type ExamAttemptMode = (typeof EXAM_ATTEMPT_MODES)[number]

/** Where an item-bank item may be used (docs/spec/04-path-generation.md §8). */
export const ITEM_USAGES = [
  'diagnostic',
  'reinforcement',
  'final_exam_A',
  'final_exam_B',
  'remediation',
  'mock',
] as const
export type ItemUsage = (typeof ITEM_USAGES)[number]

export const exams = sqliteTable(
  'exams',
  {
    id: idColumn(),
    title: text('title').notNull(),
    kind: text('kind', { enum: EXAM_KINDS }).notNull(),
    /** ISO date (`YYYY-MM-DD`) of a dated exam; `NULL` for mock/diagnostic. */
    date: text('date'),
    /** The path this exam belongs to, when it is a path's final exam or diagnostic. */
    pathId: text('path_id').references(() => paths.id),
    /** Which items are in scope: `{ pathIds, lessonIds, tagIds, itemIds }` selectors. */
    scope: jsonColumn('scope').$type<JsonObject>().notNull().default(sql`'{}'`),
    /** `[{ topic, weight, bloom, difficultyMix }]` — the mock/final sampling blueprint. */
    blueprint: jsonColumn('blueprint').$type<JsonObject[]>().notNull().default(sql`'[]'`),
    /** `r_target` on exam day (0.95 by default). */
    targetRetention: real('target_retention').notNull().default(0.95),
    /** `buffer_final`: the final review window, in days. */
    finalWindowDays: integer('final_window_days').notNull().default(3),
    /** Bitmask of study weekdays (bit 0 = Monday … bit 6 = Sunday); 127 = every day. */
    studyDaysMask: integer('study_days_mask').notNull().default(127),
    dailyCapacityMinutes: integer('daily_capacity_minutes'),
    status: text('status', { enum: EXAM_STATUSES }).notNull().default('planned'),
    ...auditColumns(),
  },
  (t) => [
    index('exams_status_date').on(t.status, t.date),
    index('exams_path').on(t.pathId),
    check('exams_kind', inTextList(t.kind, EXAM_KINDS)),
    check('exams_status', inTextList(t.status, EXAM_STATUSES)),
    check(
      'exams_date_iso',
      sql`${t.date} IS NULL OR ${t.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check('exams_target_retention_range', inRange(t.targetRetention, 0.7, 0.99)),
    check('exams_final_window_nonnegative', atLeast(t.finalWindowDays, 0)),
    check('exams_study_days_mask_range', inRange(t.studyDaysMask, 0, 127)),
    check('exams_daily_capacity_positive', atLeast(t.dailyCapacityMinutes, 1)),
    check('exams_scope_json', jsonObject(t.scope)),
    check('exams_blueprint_json', jsonArray(t.blueprint)),
    ...standardChecks('exams', t),
  ],
)

/**
 * `ItemBankItem.v1`: a generated activity tagged with where it may be used, its Elo-adjusted
 * difficulty and its exposure/statistics, deduplicated against the lesson quizzes.
 */
export const itemBank = sqliteTable(
  'item_bank',
  {
    id: idColumn(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id),
    pathVersionId: text('path_version_id').references(() => pathVersions.id),
    moduleId: text('module_id').references(() => modules.id),
    usage: jsonColumn('usage').$type<ItemUsage[]>().notNull().default(sql`'[]'`),
    /** `(difficulty − 3) · 0.8`, then adjusted online by Elo. */
    difficultyLogit: real('difficulty_logit').notNull().default(0),
    discriminationHint: real('discrimination_hint'),
    /** How many times the item has been shown (exposure control). */
    exposure: integer('exposure').notNull().default(0),
    /** `{ n, p_correct, mean_time_ms, point_biserial }`. */
    stats: jsonColumn('stats').$type<JsonObject>().notNull().default(sql`'{}'`),
    ...auditColumns(),
  },
  (t) => [
    index('item_bank_activity').on(t.activityId),
    index('item_bank_module').on(t.moduleId),
    index('item_bank_version').on(t.pathVersionId),
    check('item_bank_exposure_nonnegative', atLeast(t.exposure, 0)),
    check('item_bank_usage_json', jsonArray(t.usage)),
    check('item_bank_stats_json', jsonObject(t.stats)),
    ...standardChecks('item_bank', t),
  ],
)

/** One position in an exam: which activity, which form, which blueprint cell. */
export const examItems = sqliteTable(
  'exam_items',
  {
    id: idColumn(),
    examId: text('exam_id')
      .notNull()
      .references(() => exams.id),
    ordinal: integer('ordinal').notNull(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id),
    /** Set when the item was drawn from the bank (tracks exposure and statistics). */
    itemBankId: text('item_bank_id').references(() => itemBank.id),
    form: text('form', { enum: EXAM_FORMS }),
    /** The blueprint topic this item counts toward. */
    topic: text('topic'),
    weight: real('weight').notNull().default(1),
    timeLimitSec: integer('time_limit_sec'),
    ...auditColumns(),
  },
  (t) => [
    index('exam_items_exam_ordinal').on(t.examId, t.ordinal),
    index('exam_items_activity').on(t.activityId),
    check('exam_items_form', inTextListOrNull(t.form, EXAM_FORMS)),
    check('exam_items_ordinal_nonnegative', atLeast(t.ordinal, 0)),
    check('exam_items_weight_nonnegative', atLeast(t.weight, 0)),
    check('exam_items_time_limit_positive', atLeast(t.timeLimitSec, 1)),
    ...standardChecks('exam_items', t),
  ],
)

/** One sitting of an exam: score, per-topic breakdown, per-item results and the readiness
 * the scheduler predicted beforehand (the calibration metric). */
export const examAttempts = sqliteTable(
  'exam_attempts',
  {
    id: idColumn(),
    examId: text('exam_id')
      .notNull()
      .references(() => exams.id),
    mode: text('mode', { enum: EXAM_ATTEMPT_MODES }).notNull().default('real'),
    startedAt: timestampColumn('started_at').notNull(),
    finishedAt: timestampColumn('finished_at'),
    /** Weighted score in `[0, 1]`; `NULL` while in progress. */
    score: real('score'),
    /** `{ [topic]: { correct, total, weight } }`. */
    byTopic: jsonColumn('by_topic').$type<JsonObject>().notNull().default(sql`'{}'`),
    /** `[{ examItemId, attemptId, correct, timeMs, confidence }]` in presentation order. */
    items: jsonColumn('items').$type<JsonObject[]>().notNull().default(sql`'[]'`),
    /** `Σ w_topic · mean R_E` at the start of the attempt. */
    readinessPredicted: real('readiness_predicted'),
    /** `0` when the user chose "do not affect my scheduling" (preview mode). */
    affectsScheduling: integer('affects_scheduling').notNull().default(1),
    ...auditColumns(),
  },
  (t) => [
    index('exam_attempts_exam').on(t.examId),
    check('exam_attempts_mode', inTextList(t.mode, EXAM_ATTEMPT_MODES)),
    check('exam_attempts_score_range', inRange(t.score, 0, 1)),
    check('exam_attempts_readiness_range', inRange(t.readinessPredicted, 0, 1)),
    check('exam_attempts_affects_scheduling_bool', isBool(t.affectsScheduling)),
    check(
      'exam_attempts_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check('exam_attempts_by_topic_json', jsonObject(t.byTopic)),
    check('exam_attempts_items_json', jsonArray(t.items)),
    ...standardChecks('exam_attempts', t),
  ],
)
