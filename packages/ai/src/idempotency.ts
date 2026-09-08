import { createHash } from 'node:crypto'

/**
 * `custom_id`: the name a unit of AI work answers to, everywhere it can be recognised again.
 *
 * `docs/spec/04-path-generation.md` §7: *"every call has `custom_id = hash(stage, input_ids,
 * prompt_version)`; if a result exists, it is not repeated (key with the Batch API and for
 * resuming after closing the app)"*. The schema version is added to the tuple here, because a
 * completion is only reusable if the shape it was validated against is still the shape we
 * want — a schema change has to invalidate the cache exactly as a prompt change does.
 *
 * The four inputs answer four different ways the same work can recur:
 *
 * - `stage` — which step of which pipeline. Two stages reading the same chunk are two calls.
 * - `inputIds` — what it read. Chunk keys, a source id, an activity id, an attempt id.
 * - `promptVersion` — the `version:` line of the prompt file. A reworded prompt is new work.
 * - `schemaVersion` — the output contract. A new field is new work.
 *
 * What is deliberately **not** in the tuple: the model, the temperature and the provider.
 * That is the point rather than an omission. The cache exists so that a retry, a crash, a
 * restart or a batch reconciliation does not pay twice, and all four of those can legitimately
 * land on a different target — the `smart` role falls back to Gemini after a 429, and the
 * answer Gemini gave is still the answer to this question. Pinning the model would mean the
 * fallback pays for work we already have. A caller that genuinely wants one model's answer
 * says so by putting the model in `inputIds`.
 */

export interface IdempotencyInput {
  /** `contextualize`, `P1_extract_chunk`, `grade_long_text`… */
  readonly stage: string
  /** Everything the call read, as stable ids. Order is preserved: see `customId`. */
  readonly inputIds: readonly string[]
  readonly promptVersion: string
  readonly schemaVersion: string
}

/**
 * Anthropic's Batch API caps `custom_id` at 64 characters, so the readable prefix is bounded
 * and the digest truncated to fit inside it with room to spare.
 */
export const MAX_CUSTOM_ID_CHARS = 64
const MAX_STAGE_CHARS = 24
const DIGEST_CHARS = 32

/** Anything outside this is folded to `-`, so a chunk key with a path in it stays a legal id. */
const UNSAFE = /[^a-zA-Z0-9_-]+/g

/**
 * The `custom_id` for one unit of work.
 *
 * Shaped `<stage>-<digest>` rather than being a bare hash: this string appears in the
 * provider's batch dashboard, in `ai_calls.custom_id` and in every support conversation about
 * a run that stalled, and "which stage is `9f2c…`?" is a question nobody should have to answer
 * with a database query.
 *
 * The digest is over a **length-prefixed** encoding of the tuple, not a `join('|')`. Joining
 * is ambiguous — `['a|b']` and `['a', 'b']` produce the same string, and two genuinely
 * different calls would then share a cache entry and one of them would silently get the
 * other's answer. Chunk keys and locators contain arbitrary punctuation, so this is a real
 * collision rather than a theoretical one.
 *
 * `inputIds` is hashed in the order given and is **not** sorted. Order is meaning: a prompt
 * built from chunks 4, 5, 6 is not the prompt built from 6, 5, 4, and a caller whose input is
 * genuinely a set sorts it before calling.
 */
export function customId(input: IdempotencyInput): string {
  const hash = createHash('sha256')
  const field = (value: string): void => {
    hash.update(`${value.length}:`, 'utf8')
    hash.update(value, 'utf8')
  }

  field(input.stage)
  field(String(input.inputIds.length))
  for (const id of input.inputIds) field(id)
  field(input.promptVersion)
  field(input.schemaVersion)

  const digest = hash.digest('hex').slice(0, DIGEST_CHARS)
  const stage = input.stage.replace(UNSAFE, '-').slice(0, MAX_STAGE_CHARS).replace(/^-|-$/g, '')
  return stage === '' ? digest : `${stage}-${digest}`
}

/**
 * What a previous run of the same `custom_id` produced.
 *
 * The completion is stored as **text**, not as a parsed value, for two reasons: it is the only
 * shape both a prose call and a structured one have in common, and a hit then re-runs the same
 * sanitizer and the same `schema.parse()` the original did — so a cached answer is never
 * trusted further than a fresh one, which is the whole of §7 rule 7 applied to our own storage.
 */
export interface CachedAiResult {
  readonly customId: string
  readonly output: string
  /** Which model produced it, for the caller's `TextGenerationResult.model`. */
  readonly model: string
  readonly provider: string
  /** What it cost the first time, so the UI can say what the cache saved. */
  readonly costUsd: number
}

export interface NewAiResult extends CachedAiResult {
  readonly stage: string
  readonly promptVersion: string | undefined
  readonly schemaVersion: string | undefined
}

/**
 * The seam `packages/db`'s `ai_results` repository fills, and a `Map` fills in a test.
 *
 * Two methods and no invalidation: entries are keyed by everything that could invalidate
 * them, so the only reason to delete one is housekeeping, which belongs to the repository and
 * not to the code making a call.
 */
export interface AiResultCache {
  get(customId: string): Promise<CachedAiResult | undefined>
  put(result: NewAiResult): Promise<void>
}
