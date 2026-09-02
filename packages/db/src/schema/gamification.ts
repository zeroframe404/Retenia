import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {
  atLeast,
  auditColumns,
  idColumn,
  inRange,
  inTextList,
  type JsonObject,
  jsonColumn,
  jsonObject,
  notDeleted,
  standardChecks,
  timestampColumn,
} from './_common'

/**
 * Gamification (docs/spec/08-ux.md §4): XP as append-only events, streaks and
 * achievements as aggregates. Errors are never punished — nothing here can go negative.
 */

export const XP_REASONS = [
  'lesson',
  'review',
  'reinforcement',
  'mock_exam',
  'quest',
  'achievement',
  'bonus',
] as const
export type XpReason = (typeof XP_REASONS)[number]

/** Append-only XP ledger; totals, levels and per-day charts are aggregates over it. */
export const xpEvents = sqliteTable(
  'xp_events',
  {
    id: idColumn(),
    amount: integer('amount').notNull(),
    reason: text('reason', { enum: XP_REASONS }).notNull(),
    /** What earned it: `lesson_session`, `review_session`, `exam_attempt`, `quest`… */
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),
    occurredAt: timestampColumn('occurred_at').notNull(),
    /** Temporary boosts from achievements/quests, applied to `amount` already. */
    multiplier: real('multiplier').notNull().default(1),
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    index('xp_events_occurred').on(t.occurredAt),
    index('xp_events_subject').on(t.subjectKind, t.subjectId),
    check('xp_events_reason', inTextList(t.reason, XP_REASONS)),
    check('xp_events_amount_nonnegative', atLeast(t.amount, 0)),
    check('xp_events_multiplier_positive', sql`${t.multiplier} > 0`),
    check('xp_events_meta_json', jsonObject(t.meta)),
    ...standardChecks('xp_events', t),
  ],
)

/**
 * One row per streak kind (`review` today; more later). The streak goal (≈ 10 cards) is
 * separate from the daily goal; freezes are earned (1 every 6 days, bank of 2); "Forgot"
 * does not count. Days are `YYYY-MM-DD` in the user's local day (see
 * `scheduler_profiles.day_start_hour`).
 */
export const streaks = sqliteTable(
  'streaks',
  {
    id: idColumn(),
    kind: text('kind').notNull(),
    currentLength: integer('current_length').notNull().default(0),
    longestLength: integer('longest_length').notNull().default(0),
    /** Minimum reviews in a day for it to count. */
    goal: integer('goal').notNull().default(10),
    lastActiveDay: text('last_active_day'),
    startedOn: text('started_on'),
    freezesAvailable: integer('freezes_available').notNull().default(0),
    freezesUsed: integer('freezes_used').notNull().default(0),
    freezeBankMax: integer('freeze_bank_max').notNull().default(2),
    /** Days the user declared as holidays (`["2026-12-24", …]`) — the streak survives them. */
    holidays: jsonColumn('holidays').$type<string[]>().notNull().default(sql`'[]'`),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('streaks_kind_live').on(t.kind).where(notDeleted(t)),
    check('streaks_current_nonnegative', atLeast(t.currentLength, 0)),
    check('streaks_longest_nonnegative', atLeast(t.longestLength, 0)),
    check('streaks_goal_positive', atLeast(t.goal, 1)),
    check('streaks_freezes_range', inRange(t.freezesAvailable, 0, 1000)),
    check('streaks_freezes_used_nonnegative', atLeast(t.freezesUsed, 0)),
    check('streaks_freeze_bank_nonnegative', atLeast(t.freezeBankMax, 0)),
    check(
      'streaks_holidays_json',
      sql`json_valid(${t.holidays}) AND json_type(${t.holidays}) = 'array'`,
    ),
    ...standardChecks('streaks', t),
  ],
)

/** Achievements tied to real retention milestones (100 items "Retaining", 30 days of true
 * retention ≥ 90 %, an exam passed), not only to activity. */
export const achievements = sqliteTable(
  'achievements',
  {
    id: idColumn(),
    /** Stable identifier the catalogue and i18n strings key on: `retaining_100`, `exam_passed`… */
    key: text('key').notNull(),
    /** Progress toward `target`; `unlocked_at` is set when it reaches it. */
    progress: real('progress').notNull().default(0),
    target: real('target').notNull().default(1),
    unlockedAt: timestampColumn('unlocked_at'),
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('achievements_key_live').on(t.key).where(notDeleted(t)),
    check('achievements_key_nonempty', sql`length(${t.key}) > 0`),
    check('achievements_progress_nonnegative', atLeast(t.progress, 0)),
    check('achievements_target_positive', sql`${t.target} > 0`),
    check('achievements_meta_json', jsonObject(t.meta)),
    ...standardChecks('achievements', t),
  ],
)
