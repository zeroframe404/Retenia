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
  IMPORTANCE_LEVELS,
  idColumn,
  inIntList,
  inRange,
  inTextList,
  inTextListOrNull,
  isBool,
  type JsonObject,
  jsonArray,
  jsonColumn,
  jsonObject,
  notDeleted,
  standardChecks,
  timestampColumn,
} from './_common'
import { exams } from './exams'
import { annotations, sources } from './library'
import { lessons } from './paths'

/**
 * The memory system's tables (docs/spec/02-memory-system.md §14). The FSRS columns on
 * `cards` mirror `ts-fsrs`'s `Card` 1:1 — same names, same meaning — and are written only
 * by the scheduler (`.claude/skills/fsrs-rules/SKILL.md`).
 */

/** ts-fsrs `State`: `New = 0`, `Learning = 1`, `Review = 2`, `Relearning = 3`. */
export const CARD_STATES = [0, 1, 2, 3] as const
export type CardState = (typeof CARD_STATES)[number]

/** ts-fsrs `Rating`: `Manual = 0`, `Again = 1`, `Hard = 2`, `Good = 3`, `Easy = 4`. `0` is
 * its own case (a manual postpone/reschedule), never one of the four grades. */
export const RATINGS = [0, 1, 2, 3, 4] as const
export type Rating = (typeof RATINGS)[number]

/** Extraction types of docs/spec/04-path-generation.md §3 stage 3, plus `vocabulary` for
 * language items and `other` for imports that carry no type. */
export const KNOWLEDGE_ITEM_KINDS = [
  'fact',
  'concept',
  'procedure',
  'principle',
  'example',
  'misconception',
  'vocabulary',
  'other',
] as const
export type KnowledgeItemKind = (typeof KNOWLEDGE_ITEM_KINDS)[number]

/** `need_to_learn`: generated but not scheduled (RemNote's "Need to Learn"); `active`:
 * its cards are in the queue; `archived`: kept but out of the queue for good. */
export const KNOWLEDGE_ITEM_STATUSES = ['need_to_learn', 'active', 'archived'] as const
export type KnowledgeItemStatus = (typeof KNOWLEDGE_ITEM_STATUSES)[number]

export const CREATED_BY = ['user', 'ai', 'import'] as const
export type CreatedBy = (typeof CREATED_BY)[number]

/** What happens when a card crosses the level's leech threshold
 * (docs/spec/02-memory-system.md §7 "Leech" column). */
export const LEECH_ACTIONS = ['warn', 'warn_rewrite', 'edit', 'suspend', 'none'] as const
export type LeechAction = (typeof LEECH_ACTIONS)[number]

/**
 * The five importance levels and what each asks of the scheduler
 * (docs/spec/02-memory-system.md §7). Seeded by migration `0001_fts5_vec0_seed.sql`.
 * `name` is the natural key the code uses; `id` is what sync addresses.
 *
 * Importance affects exactly these things and nothing else: desired retention, max
 * interval, review order, behaviour under overload, the new-item quota and the leech
 * policy. It never touches stability or difficulty.
 */
export const importanceLevels = sqliteTable(
  'importance_levels',
  {
    id: idColumn(),
    name: text('name', { enum: IMPORTANCE_LEVELS }).notNull(),
    /** `NULL` for `paused` (out of the queue). */
    desiredRetention: real('desired_retention'),
    /** `NULL` for `paused`. Urgent's `min(180 d, exam − today − margin)` is applied by
     * the exam layer on top of this cap. */
    maxIntervalDays: integer('max_interval_days'),
    /** 1 = reviewed first. */
    orderRank: integer('order_rank').notNull(),
    /** Whether overload protection may postpone this level at all. */
    postponeAllowed: integer('postpone_allowed').notNull(),
    /** New items introduced per day; `NULL` = no cap (urgent is driven by the exam date). */
    newPerDay: integer('new_per_day'),
    /** Lapses before `leech_action` fires. */
    leechThreshold: integer('leech_threshold').notNull().default(8),
    leechAction: text('leech_action', { enum: LEECH_ACTIONS }).notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('importance_levels_name').on(t.name),
    check('importance_levels_name', inTextList(t.name, IMPORTANCE_LEVELS)),
    check('importance_levels_desired_retention_range', inRange(t.desiredRetention, 0.7, 0.99)),
    check('importance_levels_max_interval_positive', atLeast(t.maxIntervalDays, 1)),
    check('importance_levels_order_rank_positive', atLeast(t.orderRank, 1)),
    check('importance_levels_postpone_allowed_bool', isBool(t.postponeAllowed)),
    check('importance_levels_new_per_day_nonnegative', atLeast(t.newPerDay, 0)),
    check('importance_levels_leech_threshold_positive', atLeast(t.leechThreshold, 1)),
    check('importance_levels_leech_action', inTextList(t.leechAction, LEECH_ACTIONS)),
    ...standardChecks('importance_levels', t),
  ],
)

/**
 * FSRS parameters (docs/spec/02-memory-system.md §3, §6, §16): the 21 weights `w`, the
 * optimizer's last verdict, and the `FSRSParameters` knobs that are not weights. One row
 * per `scope` (`global`, or a path/domain id once ≥ 1,000 reviews justify its own set).
 */
export const schedulerProfiles = sqliteTable(
  'scheduler_profiles',
  {
    id: idColumn(),
    scope: text('scope').notNull(),
    /** `fsrs6` today; stored so a future variant (`fsrs6-S`, `fsrs6-F`) can coexist. */
    algorithm: text('algorithm').notNull().default('fsrs6'),
    /** `w0…w20`. */
    w: jsonColumn('w').$type<number[]>().notNull(),
    /** `−w20`, kept explicit for the forgetting-curve helpers. */
    decay: real('decay'),
    /** ts-fsrs step strings, e.g. `["1m", "10m"]`. */
    learningSteps: jsonColumn('learning_steps')
      .$type<string[]>()
      .notNull()
      .default(sql`'["1m","10m"]'`),
    relearningSteps: jsonColumn('relearning_steps')
      .$type<string[]>()
      .notNull()
      .default(sql`'["10m"]'`),
    enableFuzz: integer('enable_fuzz').notNull().default(1),
    enableShortTerm: integer('enable_short_term').notNull().default(1),
    maximumInterval: integer('maximum_interval').notNull().default(36500),
    /** Hour (0–23) at which a new "day" starts for same-day logic; Anki uses 4. */
    dayStartHour: integer('day_start_hour').notNull().default(4),
    trainedAt: timestampColumn('trained_at'),
    /** Reviews the last optimization was trained on. */
    nReviews: integer('n_reviews'),
    logLoss: real('log_loss'),
    rmse: real('rmse'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('scheduler_profiles_scope_live').on(t.scope).where(notDeleted(t)),
    check('scheduler_profiles_w_json', jsonArray(t.w)),
    check('scheduler_profiles_learning_steps_json', jsonArray(t.learningSteps)),
    check('scheduler_profiles_relearning_steps_json', jsonArray(t.relearningSteps)),
    check('scheduler_profiles_enable_fuzz_bool', isBool(t.enableFuzz)),
    check('scheduler_profiles_enable_short_term_bool', isBool(t.enableShortTerm)),
    check('scheduler_profiles_maximum_interval_positive', atLeast(t.maximumInterval, 1)),
    check('scheduler_profiles_day_start_hour_range', inRange(t.dayStartHour, 0, 23)),
    check('scheduler_profiles_n_reviews_nonnegative', atLeast(t.nReviews, 0)),
    ...standardChecks('scheduler_profiles', t),
  ],
)

/**
 * Knowledge unit ≈ Anki's note / RemNote's Rem (the spec's `items` table): the thing the
 * scheduler schedules, rendered through one or more `cards`. Carries the Wozniak-rule
 * fields (`source_id` + `locator`, `as_of`, importance) and the `Flashcard.v1` payload in
 * `fields`.
 */
export const knowledgeItems = sqliteTable(
  'knowledge_items',
  {
    id: idColumn(),
    /** The lesson that introduced it; `NULL` for items created from a source or an import. */
    lessonId: text('lesson_id').references(() => lessons.id),
    /** Concept id in the path version's knowledge graph (progress migrates by it). */
    topicId: text('topic_id'),
    kind: text('kind', { enum: KNOWLEDGE_ITEM_KINDS }).notNull(),
    /** `Flashcard.v1`-shaped content: front/back/cloze_text/context_cue/interference_group… */
    fields: jsonColumn('fields').$type<JsonObject>().notNull(),
    sourceId: text('source_id').references(() => sources.id),
    /** The highlight/clip this item was made from, when it came from the reader. */
    annotationId: text('annotation_id').references(() => annotations.id),
    /** `{ page, timestamp, selector, block_ids }` into the source. */
    locator: jsonColumn('locator').$type<JsonObject>(),
    /** Date stamp for volatile knowledge (Wozniak rule 19), ISO date. */
    asOf: text('as_of'),
    importance: text('importance', { enum: IMPORTANCE_LEVELS }).notNull().default('normal'),
    status: text('status', { enum: KNOWLEDGE_ITEM_STATUSES }).notNull().default('need_to_learn'),
    createdBy: text('created_by', { enum: CREATED_BY }).notNull().default('user'),
    tags: jsonColumn('tags').$type<string[]>().notNull().default(sql`'[]'`),
    ...auditColumns(),
  },
  (t) => [
    index('knowledge_items_lesson').on(t.lessonId),
    index('knowledge_items_source').on(t.sourceId),
    index('knowledge_items_annotation').on(t.annotationId),
    index('knowledge_items_topic').on(t.topicId),
    index('knowledge_items_status_importance').on(t.status, t.importance),
    check('knowledge_items_kind', inTextList(t.kind, KNOWLEDGE_ITEM_KINDS)),
    check('knowledge_items_importance', inTextList(t.importance, IMPORTANCE_LEVELS)),
    check('knowledge_items_status', inTextList(t.status, KNOWLEDGE_ITEM_STATUSES)),
    check('knowledge_items_created_by', inTextList(t.createdBy, CREATED_BY)),
    check('knowledge_items_fields_json', jsonObject(t.fields)),
    check('knowledge_items_locator_json', jsonObject(t.locator)),
    check('knowledge_items_tags_json', jsonArray(t.tags)),
    ...standardChecks('knowledge_items', t),
  ],
)

/**
 * Schedulable unit: every card/exercise has its own FSRS state. The nine FSRS columns are
 * `ts-fsrs`'s `Card` verbatim (`due`, `stability`, `difficulty`, `scheduled_days`,
 * `learning_steps`, `reps`, `lapses`, `state`, `last_review`); timestamps are Unix ms.
 * `elapsed_days` is deliberately absent — `ts-fsrs@6` drops it and nothing may depend on it.
 */
export const cards = sqliteTable(
  'cards',
  {
    id: idColumn(),
    itemId: text('item_id')
      .notNull()
      .references(() => knowledgeItems.id),
    /** `basic`, `reverse`, `cloze:c1`, `occlusion:3`, `mcq`, `order_steps`… */
    template: text('template').notNull(),
    /** Template-specific rendering data (which cloze, which occlusion mask). */
    payload: jsonColumn('payload').$type<JsonObject>(),

    // --- ts-fsrs Card, 1:1 ---
    due: timestampColumn('due').notNull(),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: integer('state').notNull().default(0),
    lastReview: timestampColumn('last_review'),

    // --- Retenia additions ---
    suspended: integer('suspended').notNull().default(0),
    /** Sibling bury: hidden until this instant (Unix ms). */
    buriedUntil: timestampColumn('buried_until'),
    leech: integer('leech').notNull().default(0),
    /** Per-card importance, overriding the item's level (the exam override wins over both). */
    importanceOverride: text('importance_override', { enum: IMPORTANCE_LEVELS }),
    /** The dated exam currently driving this card's desired retention and interval cap. */
    examId: text('exam_id').references(() => exams.id),
    ...auditColumns(),
  },
  (t) => [
    // The daily queue's index (docs/spec/02-memory-system.md §14).
    index('cards_due').on(t.due).where(sql`${t.suspended} = 0 AND ${t.deletedAt} IS NULL`),
    index('cards_item').on(t.itemId),
    index('cards_exam').on(t.examId),
    index('cards_state').on(t.state),
    // No uniqueness on (item_id, template): one skill may be rendered by several cards of
    // the same shape (two `mcq` exercises, say), each with its own D/S
    // (docs/spec/02-memory-system.md §10). Dedupe is the generator's job, not the schema's.
    check('cards_state', inIntList(t.state, CARD_STATES)),
    check('cards_suspended_bool', isBool(t.suspended)),
    check('cards_leech_bool', isBool(t.leech)),
    check('cards_importance_override', inTextListOrNull(t.importanceOverride, IMPORTANCE_LEVELS)),
    check('cards_stability_nonnegative', atLeast(t.stability, 0)),
    check('cards_difficulty_range', inRange(t.difficulty, 0, 10)),
    check('cards_scheduled_days_nonnegative', atLeast(t.scheduledDays, 0)),
    check('cards_learning_steps_nonnegative', atLeast(t.learningSteps, 0)),
    check('cards_reps_nonnegative', atLeast(t.reps, 0)),
    check('cards_lapses_nonnegative', atLeast(t.lapses, 0)),
    check('cards_payload_json', jsonObject(t.payload)),
    ...standardChecks('cards', t),
  ],
)
