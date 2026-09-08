import type { Entity, JsonObject, JsonValue } from './_common'
import type { AiBatchStatus, AiCallStatus, JobStatus, OutboxOp } from './enums'

/** The job queue, the AI cost log, settings and the (v1-empty) sync outbox. */

/** A unit of background work (`docs/spec/07-architecture.md` §7). The worker pool that runs
 *  them is `JobRunner` in the desktop app; this is only the persisted record. */
export interface Job extends Entity {
  kind: string
  status: JobStatus
  /** Higher runs first. */
  priority: number
  payload: JsonObject
  result: JsonValue | null
  progress: JsonObject | null
  attempts: number
  maxAttempts: number
  /** Not eligible to be claimed before this instant (backoff, scheduling). */
  runAfter: Date
  lockedBy: string | null
  lockedAt: Date | null
  startedAt: Date | null
  finishedAt: Date | null
  error: string | null
  parentJobId: string | null
  /** The domain row this job is about (a source, a path version…), for progress UI. */
  subjectId: string | null
  /** Enqueuing twice with the same key is a no-op while the first is still live. */
  idempotencyKey: string | null
}

/** One call to an AI provider, with what it cost (`docs/spec/06-ai-providers.md` §8). */
export interface AiCall extends Entity {
  provider: string
  model: string
  role: string | null
  purpose: string
  status: AiCallStatus
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  costUsd: number
  latencyMs: number | null
  batchId: string | null
  customId: string | null
  promptVersion: string | null
  schemaVersion: string | null
  temperature: number | null
  jobId: string | null
  error: string | null
  meta: JsonObject | null
}

/**
 * One cached AI answer, keyed by `custom_id` (`docs/spec/04-path-generation.md` §7:
 * *"if a result exists, it is not repeated"*).
 *
 * Not to be confused with `AiCall`, which is the cost log: that has one row per dispatched
 * attempt including the failures, this has at most one row per unit of work and holds the
 * answer that was accepted. `output` is the completion verbatim — a hit re-parses and
 * re-validates it exactly as a fresh answer would be.
 */
export interface AiResult extends Entity {
  customId: string
  stage: string
  provider: string
  model: string
  promptVersion: string | null
  schemaVersion: string | null
  output: string
  /** What the original call cost, so the UI can report what the cache saved. */
  costUsd: number
  hits: number
  lastHitAt: Date | null
  meta: JsonObject | null
}

/**
 * One submitted Batch API job (`docs/spec/06-ai-providers.md` §2: -50 % on everything, up to
 * 100,000 requests, most finish inside an hour, maximum 24 h).
 *
 * The durable half of a batch, and deliberately not the whole of it: the **requests are not
 * stored**. Forty expanded lessons are megabytes of prompt, and keeping them would put the
 * largest rows in the database behind the one feature whose entire purpose is to be cheap.
 * Everything needed to poll the job, reconcile its answers into `ai_results` and report it in
 * the tray is here; retrying a failed id needs the request, which only the process that
 * submitted it holds — and a caller's own re-run covers that case for free, because every id
 * that did succeed is already in the answer store.
 */
export interface AiBatch extends Entity {
  /** The profile id, as `ai_calls.provider` records it. */
  provider: string
  model: string
  role: string
  /** The feature tag every reconciled `ai_calls` row inherits. */
  purpose: string
  /** The `ai_results.stage` every reconciled answer is stored under. */
  stage: string
  status: AiBatchStatus
  /** The provider's own id for the job — what polling and cancelling address. */
  providerBatchId: string | null
  requestCount: number
  succeededCount: number
  failedCount: number
  /** What the estimator quoted before submission, so the two can be compared afterwards. */
  costEstimateUsd: number
  /** What the reconciled `ai_calls` rows actually came to. */
  costUsd: number
  /** Poll attempts so far: the input to the backoff, and what bounds a stuck job. */
  attempts: number
  submittedAt: Date | null
  /** Not polled again before this instant — the `jobs` table's `run_after`, for a batch. */
  nextPollAt: Date | null
  completedAt: Date | null
  promptVersion: string | null
  schemaVersion: string | null
  error: string | null
  meta: JsonObject | null
}

/** A key/value setting. Never a secret: API keys live in Electron's `safeStorage`. */
export interface Setting extends Entity {
  key: string
  value: JsonValue
}

/**
 * One pending change for a future sync layer. Empty in v1 — rows are only written when
 * `outboxEnabled` is on (`docs/spec/07-architecture.md` §6).
 */
export interface OutboxEntry extends Entity {
  tableName: string
  rowId: string
  op: OutboxOp
  /** The `version` the row had *after* the change. */
  rowVersion: number
  payload: JsonObject | null
  syncedAt: Date | null
  attempts: number
  error: string | null
}
