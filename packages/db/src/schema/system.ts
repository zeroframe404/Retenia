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

export const AI_BATCH_STATUSES = [
  'submitting',
  'submitted',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const
export type AiBatchStatus = (typeof AI_BATCH_STATUSES)[number]

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
 * The idempotent result cache (`docs/spec/04-path-generation.md` §7): *"every call has
 * `custom_id = hash(stage, input_ids, prompt_version)`; if a result exists, it is not
 * repeated (key with the Batch API and for resuming after closing the app)"*.
 *
 * Distinct from `ai_calls`, which they are easy to confuse. `ai_calls` is the **cost log**:
 * one row per dispatched attempt, including the ones that failed, the ones that were retried
 * and the ones whose output was thrown away, and it is what a monthly total is summed from.
 * This is the **answer store**: at most one row per unit of work, holding the completion that
 * was accepted. Keeping them apart is what lets the log stay append-only and honest while the
 * cache stays small and replaceable — and it is why a cache hit writes no `ai_calls` row: no
 * call was made, and inflating "calls this month" with calls that never happened would make
 * the one number the budget depends on wrong.
 *
 * `output` holds the raw completion **text**, not a parsed value, and deliberately carries no
 * `json_valid` CHECK: it is the one shape a prose call and a structured one have in common,
 * and a hit re-runs the same sanitizer and the same zod parse the original did. A cached
 * answer is never trusted further than a fresh one.
 *
 * Nothing here is user content in the sense the renderer cares about — it is model output
 * generated from the user's own sources — but it is content, which is why it lives in its own
 * table with its own retention rather than in `ai_calls.meta`, whose rule is "never the
 * content itself".
 */
export const aiResults = sqliteTable(
  'ai_results',
  {
    id: idColumn(),
    /** `sha256(stage, inputIds, promptVersion, schemaVersion)`, per `@retenia/ai`'s `customId`. */
    customId: text('custom_id').notNull(),
    /** `contextualize`, `P1_extract_chunk`, `grade_long_text`… the unit of work's name. */
    stage: text('stage').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    /** The accepted completion, verbatim. */
    output: text('output').notNull(),
    /** What it cost the first time, so the UI can say what the cache saved. */
    costUsd: real('cost_usd').notNull().default(0),
    /** How many times it has been served since. Never a correctness input; a diagnostic. */
    hits: integer('hits').notNull().default(0),
    lastHitAt: timestampColumn('last_hit_at'),
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    // The lookup, and the uniqueness that makes "if a result exists, it is not repeated"
    // true rather than aspirational. Partial on `deleted_at` like every other live-unique
    // index here, so a soft-deleted entry does not block the row that replaces it.
    uniqueIndex('ai_results_custom_id_live').on(t.customId).where(notDeleted(t)),
    // "What is this cache full of, and what can be dropped?" — the two questions housekeeping
    // and 7.5's usage dashboard ask.
    index('ai_results_stage').on(t.stage, t.createdAt),
    check('ai_results_custom_id_nonempty', sql`length(${t.customId}) > 0`),
    check('ai_results_stage_nonempty', sql`length(${t.stage}) > 0`),
    check('ai_results_cost_nonnegative', atLeast(t.costUsd, 0)),
    check('ai_results_hits_nonnegative', atLeast(t.hits, 0)),
    check('ai_results_meta_json', jsonObject(t.meta)),
    ...standardChecks('ai_results', t),
  ],
)

/**
 * One submitted Batch API job (`docs/spec/06-ai-providers.md` §2: the Batch API is -50 % on
 * everything, takes up to 100,000 requests, "most finish in under 1 h", maximum 24 h).
 *
 * The third table in this family, and the one that makes the other two survive a restart.
 * `ai_calls` is the cost log (one row per dispatched request, batched or not), `ai_results`
 * is the answer store keyed by `custom_id`, and this is the **job**: what was sent, to whom,
 * what it was quoted at, and where the polling had got to when the app was last closed.
 * Without it, killing the app mid-batch abandons an hour of work that has already been paid
 * for — the provider finishes the job and charges for it, and nothing here ever collects it.
 *
 * What is deliberately **not** here is the requests themselves. Forty expanded lessons are
 * megabytes of prompt, and storing them would put the largest rows in the database behind the
 * one feature whose whole purpose is to be cheap. Everything needed to poll, reconcile and
 * report is a column; retrying a failed id needs the request, which only the process that
 * submitted it holds — and a caller's own re-run covers that for free, because every id that
 * did succeed is already answered from `ai_results`.
 *
 * `provider_batch_id` is null exactly while `status` is `submitting`: the row is written
 * before the provider is called, so a crash in that window is visible rather than silent.
 * `next_poll_at` and `attempts` are this table's `run_after` and `attempts` — the same
 * durable-backoff shape the `jobs` table uses, for a queue whose worker lives upstream.
 */
export const aiBatches = sqliteTable(
  'ai_batches',
  {
    id: idColumn(),
    /** The profile id, as `ai_calls.provider` records it. */
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** `smart`, `cheap`… the role the batch was routed through. */
    role: text('role').notNull(),
    /** The feature tag every reconciled `ai_calls` row inherits. */
    purpose: text('purpose').notNull(),
    /** The `ai_results.stage` every reconciled answer is stored under. */
    stage: text('stage').notNull(),
    status: text('status', { enum: AI_BATCH_STATUSES }).notNull().default('submitting'),
    /** The provider's own id for the job — what polling and cancelling address. */
    providerBatchId: text('provider_batch_id'),
    requestCount: integer('request_count').notNull().default(0),
    succeededCount: integer('succeeded_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    /** What the estimator quoted before submission, so the two can be compared afterwards. */
    costEstimateUsd: real('cost_estimate_usd').notNull().default(0),
    /** What the reconciled `ai_calls` rows actually came to. */
    costUsd: real('cost_usd').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    submittedAt: timestampColumn('submitted_at'),
    /** Not polled again before this instant: the `jobs` table's `run_after`, for a batch. */
    nextPollAt: timestampColumn('next_poll_at'),
    completedAt: timestampColumn('completed_at'),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    error: text('error'),
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    // The two reads that exist: "what is still running?" at startup and in the tray, and
    // "what has run?" in the usage dashboard.
    index('ai_batches_active').on(t.status, t.nextPollAt),
    index('ai_batches_created').on(t.createdAt),
    index('ai_batches_provider_batch_id').on(t.providerBatchId),
    check('ai_batches_status', inTextList(t.status, AI_BATCH_STATUSES)),
    check('ai_batches_request_count_nonnegative', atLeast(t.requestCount, 0)),
    check('ai_batches_succeeded_nonnegative', atLeast(t.succeededCount, 0)),
    check('ai_batches_failed_nonnegative', atLeast(t.failedCount, 0)),
    check('ai_batches_cost_estimate_nonnegative', atLeast(t.costEstimateUsd, 0)),
    check('ai_batches_cost_nonnegative', atLeast(t.costUsd, 0)),
    check('ai_batches_attempts_nonnegative', atLeast(t.attempts, 0)),
    check('ai_batches_meta_json', jsonObject(t.meta)),
    ...standardChecks('ai_batches', t),
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
