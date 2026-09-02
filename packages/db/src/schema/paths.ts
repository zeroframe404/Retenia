import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
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
  inTextListOrNull,
  type JsonObject,
  jsonArray,
  jsonColumn,
  jsonObject,
  standardChecks,
  timestampColumn,
} from './_common'

/**
 * Learning paths (docs/spec/04-path-generation.md §7–§8): a `paths` row is the user-facing
 * path; each generation freezes a `path_versions` row holding the `LearningPath.v1` spec
 * and its `GenerationManifest`; the version owns the tree
 * `sections → modules → lessons → activities`. Regenerating creates a new version with a
 * fresh tree — progress migrates by `concept_id`, never by position.
 */

export const PATH_STATUSES = ['draft', 'generating', 'active', 'completed', 'archived'] as const
export type PathStatus = (typeof PATH_STATUSES)[number]

/** `core` lessons are the path; `remediation` ones are the optional `L07.r1` detours;
 * `reinforcement` and `checkpoint` are the retrieval nodes every 3–5 lessons / 3–4 modules
 * (docs/spec/04-path-generation.md §3 stage 5, §11). */
export const LESSON_KINDS = ['core', 'remediation', 'reinforcement', 'checkpoint'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

/** Expansion progress of a lesson (stage 7 runs in batch; the first two are synchronous). */
export const LESSON_STATUSES = ['pending', 'generating', 'ready', 'failed'] as const
export type LessonStatus = (typeof LESSON_STATUSES)[number]

/** Revised Bloom levels (docs/spec/04-path-generation.md §1.4). */
export const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const
export type BloomLevel = (typeof BLOOM_LEVELS)[number]

/** The 22 payload families plus `simulation` (docs/spec/03-activities.md §7). */
export const ACTIVITY_FAMILIES = [
  'choice',
  'text_input',
  'cloze',
  'long_text',
  'pairs',
  'ordering',
  'categorize',
  'image_target',
  'text_mark',
  'scale',
  'speech',
  'dialogue',
  'branching',
  'media_checkpoints',
  'code',
  'math',
  'graph',
  'grid_game',
  'arcade',
  'cards',
  'disclosure',
  'draw',
  'simulation',
] as const
export type ActivityFamily = (typeof ACTIVITY_FAMILIES)[number]

/** `pending_media` activities never enter a session; `needs_review` is the "blind solve"
 * disagreement flag (docs/spec/03-activities.md §11). */
export const ACTIVITY_STATUSES = ['ready', 'pending_media', 'needs_review', 'rejected'] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]

export const paths = sqliteTable(
  'paths',
  {
    id: idColumn(),
    title: text('title').notNull(),
    /** BCP-47 tag of the lessons' language. */
    language: text('language').notNull(),
    /** Free-form level (`beginner`, `B1`, `undergraduate`…). */
    level: text('level'),
    /** The one-sentence goal typed into the generation panel. */
    goal: text('goal'),
    /** ISO date (`YYYY-MM-DD`) when the path is "for an exam"; the exam row itself lives in
     * `exams` with `path_id` set. */
    targetDate: text('target_date'),
    status: text('status', { enum: PATH_STATUSES }).notNull().default('draft'),
    /** `path_versions.number` currently being studied; `NULL` until the first freeze. */
    activeVersion: integer('active_version'),
    /** The `sources.id` list the path was generated from; the first is the primary source. */
    sourceIds: jsonColumn('source_ids').$type<string[]>().notNull().default(sql`'[]'`),
    /** Generation-panel settings: pace, scope (chapters), primary source, "for an exam". */
    settings: jsonColumn('settings').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    index('paths_status').on(t.status),
    check('paths_status', inTextList(t.status, PATH_STATUSES)),
    check('paths_active_version_positive', atLeast(t.activeVersion, 1)),
    check(
      'paths_target_date_iso',
      sql`${t.targetDate} IS NULL OR ${t.targetDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check('paths_source_ids_json', jsonArray(t.sourceIds)),
    check('paths_settings_json', jsonObject(t.settings)),
    ...standardChecks('paths', t),
  ],
)

/** One frozen `PathSpec` (docs/spec/04-path-generation.md §7): ids and order never change
 * once `frozen_at` is set; a regeneration is a new row with `number + 1`. */
export const pathVersions = sqliteTable(
  'path_versions',
  {
    id: idColumn(),
    pathId: text('path_id')
      .notNull()
      .references(() => paths.id),
    number: integer('number').notNull(),
    /** The `LearningPath.v1` document (sections/modules/lessons refs, final exam ref). */
    spec: jsonColumn('spec').$type<JsonObject>().notNull(),
    /** `KnowledgeGraph`: concept nodes and `PREREQ_OF`/`RELATED_TO`/`PART_OF` edges. */
    knowledgeGraph: jsonColumn('knowledge_graph').$type<JsonObject>(),
    /** `GenerationManifest.v1`: source hashes, prompt/schema versions, models, cost, warnings. */
    manifest: jsonColumn('manifest').$type<JsonObject>(),
    /** Per-lesson diff against the previous version, for the "Regenerate path" summary. */
    diff: jsonColumn('diff').$type<JsonObject>(),
    frozenAt: timestampColumn('frozen_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('path_versions_path_number').on(t.pathId, t.number),
    check('path_versions_number_positive', atLeast(t.number, 1)),
    check('path_versions_spec_json', jsonObject(t.spec)),
    check('path_versions_knowledge_graph_json', jsonObject(t.knowledgeGraph)),
    check('path_versions_manifest_json', jsonObject(t.manifest)),
    check('path_versions_diff_json', jsonObject(t.diff)),
    ...standardChecks('path_versions', t),
  ],
)

export const sections = sqliteTable(
  'sections',
  {
    id: idColumn(),
    pathVersionId: text('path_version_id')
      .notNull()
      .references(() => pathVersions.id),
    /** Position in the path. */
    ordinal: integer('ordinal').notNull(),
    /** The id inside the frozen spec (`S01`), stable across regenerations. */
    specId: text('spec_id').notNull(),
    title: text('title').notNull(),
    /** Soft-unlock rule for the path map (docs/spec/02-memory-system.md §11 step 5). */
    unlockRule: jsonColumn('unlock_rule').$type<JsonObject>(),
    xpReward: integer('xp_reward').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    index('sections_version_ordinal').on(t.pathVersionId, t.ordinal),
    check('sections_ordinal_nonnegative', atLeast(t.ordinal, 0)),
    check('sections_xp_nonnegative', atLeast(t.xpReward, 0)),
    check('sections_unlock_rule_json', jsonObject(t.unlockRule)),
    ...standardChecks('sections', t),
  ],
)

export const modules = sqliteTable(
  'modules',
  {
    id: idColumn(),
    sectionId: text('section_id')
      .notNull()
      .references(() => sections.id),
    ordinal: integer('ordinal').notNull(),
    specId: text('spec_id').notNull(),
    title: text('title').notNull(),
    /** `[{ text, bloom, abcd }]` — ABCD objectives (docs/spec/04-path-generation.md §1.4). */
    objectives: jsonColumn('objectives').$type<JsonObject[]>().notNull().default(sql`'[]'`),
    /** `item_bank` ids asked by the prior-knowledge diagnostic for this module. */
    diagnosticItemIds: jsonColumn('diagnostic_item_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    unlockRule: jsonColumn('unlock_rule').$type<JsonObject>(),
    xpReward: integer('xp_reward').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    index('modules_section_ordinal').on(t.sectionId, t.ordinal),
    check('modules_ordinal_nonnegative', atLeast(t.ordinal, 0)),
    check('modules_xp_nonnegative', atLeast(t.xpReward, 0)),
    check('modules_objectives_json', jsonArray(t.objectives)),
    check('modules_diagnostic_item_ids_json', jsonArray(t.diagnosticItemIds)),
    check('modules_unlock_rule_json', jsonObject(t.unlockRule)),
    ...standardChecks('modules', t),
  ],
)

/** `Lesson.v1` (docs/spec/04-path-generation.md §8): theory blocks, objectives, citations
 * and QA verdict as JSON; activities and flashcards (as `knowledge_items`) in their own
 * tables. */
export const lessons = sqliteTable(
  'lessons',
  {
    id: idColumn(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id),
    ordinal: integer('ordinal').notNull(),
    /** `L07` for core lessons, `L07.r1` for the first remediation anchored to it. */
    specId: text('spec_id').notNull(),
    kind: text('kind', { enum: LESSON_KINDS }).notNull().default('core'),
    /** The core lesson a remediation detours from (docs/spec/04-path-generation.md §11). */
    parentLessonId: text('parent_lesson_id').references((): AnySQLiteColumn => lessons.id),
    title: text('title').notNull(),
    status: text('status', { enum: LESSON_STATUSES }).notNull().default('pending'),
    objectives: jsonColumn('objectives').$type<JsonObject[]>().notNull().default(sql`'[]'`),
    /** Concept ids from the version's knowledge graph. */
    conceptIds: jsonColumn('concept_ids').$type<string[]>().notNull().default(sql`'[]'`),
    prerequisiteLessonIds: jsonColumn('prerequisite_lesson_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    estimatedMinutes: integer('estimated_minutes'),
    /** `{ blocks: [{ type, content, citations }] }` — hook, activation, explanation, … */
    theory: jsonColumn('theory').$type<JsonObject>(),
    /** `[{ id, source_id, block_ids, locator, quote }]`. */
    citations: jsonColumn('citations').$type<JsonObject[]>().notNull().default(sql`'[]'`),
    /** `{ faithfulness, pedagogy_score, coverage_ok, warnings }` from the QA gates. */
    qa: jsonColumn('qa').$type<JsonObject>(),
    /** What fired a remediation (`{ trigger, concept_id, misconception_id, evidence }`) and
     * its measured effect, for tuning thresholds. */
    remediation: jsonColumn('remediation').$type<JsonObject>(),
    unlockRule: jsonColumn('unlock_rule').$type<JsonObject>(),
    xpReward: integer('xp_reward').notNull().default(0),
    /** Set when the lesson is completed — by finishing its practice or by the diagnostic. */
    completedAt: timestampColumn('completed_at'),
    ...auditColumns(),
  },
  (t) => [
    index('lessons_module_ordinal').on(t.moduleId, t.ordinal),
    index('lessons_parent').on(t.parentLessonId),
    index('lessons_status').on(t.status),
    check('lessons_kind', inTextList(t.kind, LESSON_KINDS)),
    check('lessons_status', inTextList(t.status, LESSON_STATUSES)),
    check('lessons_ordinal_nonnegative', atLeast(t.ordinal, 0)),
    check('lessons_estimated_minutes_positive', atLeast(t.estimatedMinutes, 0)),
    check('lessons_xp_nonnegative', atLeast(t.xpReward, 0)),
    check('lessons_objectives_json', jsonArray(t.objectives)),
    check('lessons_concept_ids_json', jsonArray(t.conceptIds)),
    check('lessons_prerequisites_json', jsonArray(t.prerequisiteLessonIds)),
    check('lessons_theory_json', jsonObject(t.theory)),
    check('lessons_citations_json', jsonArray(t.citations)),
    check('lessons_qa_json', jsonObject(t.qa)),
    check('lessons_remediation_json', jsonObject(t.remediation)),
    check('lessons_unlock_rule_json', jsonObject(t.unlockRule)),
    ...standardChecks('lessons', t),
  ],
)

/**
 * One interactive activity (docs/spec/03-activities.md §7): `type` picks the renderer,
 * prompt and rating strategy; `family` picks the grader and the payload schema. `config`
 * is the `ActivityBase` envelope minus `grading` (prompt, media, hints, explanation,
 * sources, skills, review policy, payload); `grading` is its own column because the
 * grader reads it without the rest.
 *
 * `lesson_id` is `NULL` for item-bank activities (diagnostic, exam forms, remediation).
 */
export const activities = sqliteTable(
  'activities',
  {
    id: idColumn(),
    lessonId: text('lesson_id').references(() => lessons.id),
    /** Position in the lesson's practice block. */
    ordinal: integer('ordinal'),
    /** One of the 98 type ids, e.g. `mcq_single`, `cloze_typed`. */
    type: text('type').notNull(),
    family: text('family', { enum: ACTIVITY_FAMILIES }).notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    /** BCP-47 tag of the activity's language. */
    lang: text('lang').notNull(),
    bloom: text('bloom', { enum: BLOOM_LEVELS }),
    difficulty: integer('difficulty'),
    conceptIds: jsonColumn('concept_ids').$type<string[]>().notNull().default(sql`'[]'`),
    misconceptionIds: jsonColumn('misconception_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    config: jsonColumn('config').$type<JsonObject>().notNull(),
    grading: jsonColumn('grading').$type<JsonObject>().notNull(),
    status: text('status', { enum: ACTIVITY_STATUSES }).notNull().default('ready'),
    /** `[{ docId, span, quote }]` — the `sources` of the envelope, kept queryable. */
    sourceRefs: jsonColumn('source_refs').$type<JsonObject[]>().notNull().default(sql`'[]'`),
    ...auditColumns(),
  },
  (t) => [
    index('activities_lesson_ordinal').on(t.lessonId, t.ordinal),
    index('activities_type').on(t.type),
    index('activities_status').on(t.status),
    check('activities_family', inTextList(t.family, ACTIVITY_FAMILIES)),
    check('activities_status', inTextList(t.status, ACTIVITY_STATUSES)),
    check('activities_bloom', inTextListOrNull(t.bloom, BLOOM_LEVELS)),
    check('activities_difficulty_range', inRange(t.difficulty, 1, 5)),
    check('activities_schema_version_positive', atLeast(t.schemaVersion, 1)),
    check('activities_ordinal_nonnegative', atLeast(t.ordinal, 0)),
    check('activities_concept_ids_json', jsonArray(t.conceptIds)),
    check('activities_misconception_ids_json', jsonArray(t.misconceptionIds)),
    check('activities_config_json', jsonObject(t.config)),
    check('activities_grading_json', jsonObject(t.grading)),
    check('activities_source_refs_json', jsonArray(t.sourceRefs)),
    ...standardChecks('activities', t),
  ],
)
