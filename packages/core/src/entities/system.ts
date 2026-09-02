import type { Entity, JsonObject, JsonValue } from './_common'
import type { AiCallStatus, JobStatus, OutboxOp } from './enums'

/** The job queue, the AI cost log, settings and the (v1-empty) sync outbox. */

/** A unit of background work (`docs/spec/07-architecture.md` §7). The worker pool that runs
 *  them is sub-phase 3.4; this is only the persisted record. */
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
