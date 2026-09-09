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
  inTextList,
  type JsonObject,
  type JsonValue,
  jsonArray,
  jsonColumn,
  jsonObject,
  notDeleted,
  standardChecks,
  timestampColumn,
} from './_common'
import { chunks, sources } from './library'
import { paths, pathVersions } from './paths'

/**
 * Path generation, stages 3–5 (docs/spec/04-path-generation.md §3; sub-phase 8.1): the run
 * ledger and the per-chunk extraction store.
 *
 * The draft a run produces is *not* a table here. It is an unfrozen `path_versions` row —
 * `spec` holds the `PathDraft.v1`, `knowledge_graph` and `manifest` their documents, and
 * `frozen_at IS NULL` is what says "still editable" — so the freeze of sub-phase 8.2 is a
 * timestamp on the same row rather than a copy into a second table.
 */

/**
 * The status is the stage. `blocked_budget` is a pause, not an end: the run's own cost cap
 * (or the monthly one) stopped it before the next paid call, and it resumes when the user
 * says "continue anyway". Terminal: `completed`, `failed`, `cancelled`.
 */
export const GENERATION_RUN_STATUSES = [
  'queued',
  'extracting',
  'consolidating',
  'synthesizing',
  'sequencing',
  'persisting',
  'completed',
  'failed',
  'cancelled',
  'blocked_budget',
] as const
export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number]

export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: idColumn(),
    pathId: text('path_id')
      .notNull()
      .references(() => paths.id),
    /** The unfrozen version holding the draft; `NULL` until the run persists one. */
    pathVersionId: text('path_version_id').references(() => pathVersions.id),
    status: text('status', { enum: GENERATION_RUN_STATUSES }).notNull().default('queued'),
    /** The `GenerationConfig` the run was started with. */
    config: jsonColumn('config').$type<JsonObject>().notNull(),
    /** sha256 of the parts of `config` that change the synthesis — half of P2's `custom_id`. */
    configHash: text('config_hash').notNull(),
    /** `{ stage, done, total, batch_ids }` — where the run had got to, for resume and the UI. */
    progress: jsonColumn('progress').$type<JsonObject>(),
    /** The estimate shown before the run started, so actual and quoted can be compared. */
    estimate: jsonColumn('estimate').$type<JsonObject>(),
    costUsd: real('cost_usd').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    /** `GenerationManifest.v1`, rewritten at every stage boundary. */
    manifest: jsonColumn('manifest').$type<JsonObject>(),
    /** `GenerationWarning[]`: `{ code, stage, params }`, never prose. */
    warnings: jsonColumn('warnings').$type<JsonValue[]>().notNull().default(sql`'[]'`),
    error: text('error'),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
    ...auditColumns(),
  },
  (t) => [
    index('generation_runs_path').on(t.pathId, t.createdAt),
    index('generation_runs_status').on(t.status, t.createdAt),
    check('generation_runs_status', inTextList(t.status, GENERATION_RUN_STATUSES)),
    check('generation_runs_config_json', jsonObject(t.config)),
    check('generation_runs_config_hash_sha256', sql`length(${t.configHash}) = 64`),
    check('generation_runs_progress_json', jsonObject(t.progress)),
    check('generation_runs_estimate_json', jsonObject(t.estimate)),
    check('generation_runs_manifest_json', jsonObject(t.manifest)),
    check('generation_runs_warnings_json', jsonArray(t.warnings)),
    check('generation_runs_cost_nonnegative', atLeast(t.costUsd, 0)),
    check('generation_runs_input_tokens_nonnegative', atLeast(t.inputTokens, 0)),
    check('generation_runs_output_tokens_nonnegative', atLeast(t.outputTokens, 0)),
    check('generation_runs_cached_tokens_nonnegative', atLeast(t.cachedTokens, 0)),
    ...standardChecks('generation_runs', t),
  ],
)

/**
 * The validated P1 output of one chunk (`extract_chunk@1`), keyed by the same `custom_id`
 * the raw completion sits under in `ai_results`.
 *
 * Two tables for one answer, on purpose. `ai_results` holds the completion *text* of any
 * call and is purgeable housekeeping; this holds the parsed, validated, chunk-addressed
 * document the consolidation stage reads, and it is what makes "re-running the same book
 * makes no P1 call" a query rather than a hope. `run_id` is the run that first produced the
 * row; a later run that reuses it leaves it alone.
 */
export const extractions = sqliteTable(
  'extractions',
  {
    id: idColumn(),
    runId: text('run_id')
      .notNull()
      .references(() => generationRuns.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id),
    chunkKey: text('chunk_key'),
    /** `chunks.hash` at extraction time, so a re-chunked source is visibly stale. */
    chunkHash: text('chunk_hash').notNull(),
    /** `customId({ stage: 'P1_extract_chunk', … })` — never the run id. */
    customId: text('custom_id').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    /** The profile that answered; `NULL` when only the model is known. */
    provider: text('provider'),
    model: text('model').notNull(),
    /** The validated `extract_chunk@1` document. */
    output: jsonColumn('output').$type<JsonObject>().notNull(),
    conceptCount: integer('concept_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    // The lookup, and the uniqueness that makes "if a result exists, it is not repeated"
    // true; partial on `deleted_at` like every other live-unique index here.
    uniqueIndex('extractions_custom_id_live').on(t.customId).where(notDeleted(t)),
    index('extractions_chunk').on(t.chunkId),
    index('extractions_source').on(t.sourceId),
    index('extractions_run').on(t.runId),
    check('extractions_custom_id_nonempty', sql`length(${t.customId}) > 0`),
    check('extractions_chunk_hash_sha256', sql`length(${t.chunkHash}) = 64`),
    check('extractions_output_json', jsonObject(t.output)),
    check('extractions_concept_count_nonnegative', atLeast(t.conceptCount, 0)),
    check('extractions_input_tokens_nonnegative', atLeast(t.inputTokens, 0)),
    check('extractions_output_tokens_nonnegative', atLeast(t.outputTokens, 0)),
    check('extractions_cached_tokens_nonnegative', atLeast(t.cachedTokens, 0)),
    check('extractions_cost_nonnegative', atLeast(t.costUsd, 0)),
    ...standardChecks('extractions', t),
  ],
)
