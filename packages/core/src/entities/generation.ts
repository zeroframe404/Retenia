import type { Entity, JsonObject, JsonValue } from './_common'
import type { GenerationRunStatus } from './enums'

/**
 * Path generation, stages 3–5 of `docs/spec/04-path-generation.md` §3 (sub-phase 8.1): one
 * `GenerationRun` per press of "Generate with AI", and one `Extraction` per chunk it read.
 *
 * A run is the ledger — what was asked, where it got to, what it cost — and the draft it
 * produces is an *unfrozen* `PathVersion` (`frozenAt === null`) rather than a table of its
 * own: `path_versions` already holds `spec`, `knowledgeGraph` and `manifest`, and the freeze
 * of sub-phase 8.2 is then a timestamp on the same row rather than a copy.
 */

export interface GenerationRun extends Entity {
  pathId: string
  /** The unfrozen `path_versions` row holding the draft; `null` until the run persists one. */
  pathVersionId: string | null
  /** The status *is* the stage; the finer progress lives in `progress`. */
  status: GenerationRunStatus
  /** The `GenerationConfig` the run was started with, verbatim. */
  config: JsonObject
  /** sha256 of the parts of `config` that change the synthesis — half of P2's `custom_id`. */
  configHash: string
  /** Where the run had got to (`{ stage, done, total, batch_ids }`), for resume and the UI. */
  progress: JsonObject | null
  /** The estimate shown before the run started, so actual and quoted can be compared. */
  estimate: JsonObject | null
  costUsd: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  /** `GenerationManifest.v1`, rewritten at every stage boundary; partial after a crash. */
  manifest: JsonObject | null
  /** `GenerationWarning[]` — data with a `code`, never prose. */
  warnings: JsonValue[]
  error: string | null
  startedAt: Date | null
  finishedAt: Date | null
}

/**
 * The validated P1 output for one chunk (`extract_chunk@1`).
 *
 * Distinct from `AiResult`, which holds the raw completion text for *any* call: this is the
 * parsed, validated, chunk-addressed row consolidation reads, and the durable reason a
 * re-run over the same book makes no P1 call. `customId` is keyed on the chunk's identity and
 * the prompt/schema versions — never on the run — so any later run reuses it.
 */
export interface Extraction extends Entity {
  /** The run that first produced it. Never rewritten by a later run that reuses the row. */
  runId: string
  sourceId: string
  chunkId: string
  chunkKey: string | null
  /** `chunks.hash` at extraction time, so a re-chunked source is visibly stale. */
  chunkHash: string
  customId: string
  promptVersion: string
  schemaVersion: string
  /** The profile that answered; `null` when only the model is known (a synchronous call). */
  provider: string | null
  model: string
  /** The validated `extract_chunk@1` document. */
  output: JsonObject
  conceptCount: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
}
