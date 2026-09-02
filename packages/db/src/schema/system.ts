import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
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
  type JsonValue,
  jsonColumn,
  jsonObject,
  jsonValid,
  notDeleted,
  standardChecks,
  timestampColumn,
} from './_common'

/**
 * Infrastructure tables: the persisted job queue (docs/spec/07-architecture.md §7), the AI
 * cost log (docs/spec/06-ai-providers.md §6), key/value settings, and the sync outbox that
 * stays empty in v1 (docs/spec/07-architecture.md §5–§6).
 */

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const AI_CALL_STATUSES = ['ok', 'error'] as const
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number]

export const OUTBOX_OPS = ['insert', 'update', 'delete'] as const
export type OutboxOp = (typeof OUTBOX_OPS)[number]

/**
 * Persisted queue for `utilityProcess` workers. Claiming is the single-statement
 * `UPDATE … WHERE id = (SELECT … ORDER BY priority DESC, created_at LIMIT 1) RETURNING *`
 * of docs/spec/07-architecture.md §7; orphans (`running` with a dead `locked_by`) are
 * re-queued at startup; retries back off `2ⁿ` minutes via `run_after`.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: idColumn(),
    /** `ingest.pdf`, `embed.chunks`, `generate.lesson`, `media.tts`… */
    kind: text('kind').notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    /** Higher runs first. */
    priority: integer('priority').notNull().default(0),
    payload: jsonColumn('payload').$type<JsonObject>().notNull(),
    result: jsonColumn('result').$type<JsonValue>(),
    /** `{ pct, message, step }` for the "Processing" panel. */
    progress: jsonColumn('progress').$type<JsonObject>(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** Not picked up before this instant (Unix ms): scheduling and retry backoff. */
    runAfter: timestampColumn('run_after').notNull(),
    /** Worker id holding the job; cleared on completion. */
    lockedBy: text('locked_by'),
    lockedAt: timestampColumn('locked_at'),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
    error: text('error'),
    /** Parent for fan-out jobs (one ingest spawns N embed jobs). */
    parentJobId: text('parent_job_id').references((): AnySQLiteColumn => jobs.id),
    /** The entity the job is about (a `sources.id`, a `lessons.id`) for per-subject progress. */
    subjectId: text('subject_id'),
    /** `hash(stage, input_ids, prompt_version)`: a queued/running/succeeded job with the same
     * key is not enqueued twice (docs/spec/04-path-generation.md §7). */
    idempotencyKey: text('idempotency_key'),
    ...auditColumns(),
  },
  (t) => [
    index('jobs_queue').on(t.status, t.runAfter, t.priority),
    index('jobs_subject').on(t.subjectId),
    index('jobs_parent').on(t.parentJobId),
    uniqueIndex('jobs_idempotency_key_live')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check('jobs_status', inTextList(t.status, JOB_STATUSES)),
    check('jobs_attempts_nonnegative', atLeast(t.attempts, 0)),
    check('jobs_max_attempts_positive', atLeast(t.maxAttempts, 1)),
    check('jobs_payload_json', jsonObject(t.payload)),
    check('jobs_result_json', jsonValid(t.result)),
    check('jobs_progress_json', jsonObject(t.progress)),
    ...standardChecks('jobs', t),
  ],
)

/**
 * One request to an AI provider: who, what for, how many tokens, what it cost. The
 * budget screen sums `cost_usd` per month; the idempotency of batch calls is `custom_id`.
 */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: idColumn(),
    /** `anthropic`, `google`, `azure-speech`, `elevenlabs`, `ollama`… */
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** Routing role: `smart`, `cheap`, `vision`, `audio`, `embed`, `local`… (defined in 7.1). */
    role: text('role'),
    /** The pipeline stage or feature: `P1_extract_chunk`, `grade`, `tutor`, `tts`… */
    purpose: text('purpose').notNull(),
    status: text('status', { enum: AI_CALL_STATUSES }).notNull().default('ok'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms'),
    /** Set when the call went through the Batch API. */
    batchId: text('batch_id'),
    /** `hash(stage, input_ids, prompt_version)` — the Batch API `custom_id`. */
    customId: text('custom_id'),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    temperature: real('temperature'),
    jobId: text('job_id').references(() => jobs.id),
    error: text('error'),
    /** Request/response identifiers, stop reason, pricing snapshot… never the content itself. */
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    index('ai_calls_created').on(t.createdAt),
    index('ai_calls_provider_model').on(t.provider, t.model),
    index('ai_calls_job').on(t.jobId),
    index('ai_calls_custom_id').on(t.customId),
    check('ai_calls_status', inTextList(t.status, AI_CALL_STATUSES)),
    check('ai_calls_input_tokens_nonnegative', atLeast(t.inputTokens, 0)),
    check('ai_calls_output_tokens_nonnegative', atLeast(t.outputTokens, 0)),
    check('ai_calls_cached_tokens_nonnegative', atLeast(t.cachedInputTokens, 0)),
    check('ai_calls_reasoning_tokens_nonnegative', atLeast(t.reasoningTokens, 0)),
    check('ai_calls_cost_nonnegative', atLeast(t.costUsd, 0)),
    check('ai_calls_latency_nonnegative', atLeast(t.latencyMs, 0)),
    check('ai_calls_temperature_range', inRange(t.temperature, 0, 2)),
    check('ai_calls_meta_json', jsonObject(t.meta)),
    ...standardChecks('ai_calls', t),
  ],
)

/**
 * Key/value settings (`key` → JSON `value`). Secrets never live here: API keys and tokens
 * go through Electron's `safeStorage` in the main process (CLAUDE.md). Feature flags,
 * provider roles, budgets, scheduler options and UI preferences do.
 */
export const settings = sqliteTable(
  'settings',
  {
    id: idColumn(),
    key: text('key').notNull(),
    value: jsonColumn('value').$type<JsonValue>().notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('settings_key_live').on(t.key).where(notDeleted(t)),
    check('settings_key_nonempty', sql`length(${t.key}) > 0`),
    check('settings_value_json', jsonValid(t.value)),
    ...standardChecks('settings', t),
  ],
)

/**
 * Sync outbox — empty in v1 (docs/spec/07-architecture.md §5). When accounts and sync
 * arrive, repositories append one row per local write here and a sync worker drains it;
 * the schema exists now so nothing has to be renumbered later.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    id: idColumn(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    op: text('op', { enum: OUTBOX_OPS }).notNull(),
    /** The row's `version` after the write. */
    rowVersion: integer('row_version').notNull(),
    /** The changed columns, when the sync protocol wants a delta rather than a re-read. */
    payload: jsonColumn('payload').$type<JsonObject>(),
    syncedAt: timestampColumn('synced_at'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    ...auditColumns(),
  },
  (t) => [
    index('outbox_pending').on(t.syncedAt, t.createdAt),
    index('outbox_row').on(t.tableName, t.rowId),
    check('outbox_op', inTextList(t.op, OUTBOX_OPS)),
    check('outbox_row_version_positive', atLeast(t.rowVersion, 1)),
    check('outbox_attempts_nonnegative', atLeast(t.attempts, 0)),
    check('outbox_payload_json', jsonObject(t.payload)),
    ...standardChecks('outbox', t),
  ],
)
