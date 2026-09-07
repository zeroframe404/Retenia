import type { ChunkDraft, TokenCounter } from '../chunking'
import { countTokensByChars } from '../chunking'
import type { DocumentContext } from './task'
import { buildDocumentBlock } from './task'

/**
 * What the "índice mejorado" toggle shows before it is switched on
 * (`docs/spec/05-ingestion-rag.md` §4.2: *"optional contextualization (toggle 'improved
 * index' with the cost shown)"*; §6 of `01-decisions.md`: *"visible per-call cost and a
 * monthly budget with alerts"*).
 *
 * The estimate is deliberately an *upper* bound on the token counts and an exact function of
 * the price table it is given: a user who is told USD 0.31 and charged USD 0.45 will not
 * believe the next number the app shows them. Output is counted at the top of the 50–100 token
 * band the prompt asks for, and the whole document block is charged to the first call at full
 * price even when caching is on.
 */

/** USD per million tokens, as `docs/spec/06-ai-providers.md`'s tables list them. */
export interface ContextualizationPricing {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  /** Reading a cached prefix. Anthropic charges a tenth of the input rate; when the provider
   *  has no cache, pass the input rate (or turn `promptCaching` off). */
  cachedInputUsdPerMillion?: number
  /** Writing the cache the first time — Anthropic's 5-minute cache costs 1.25× input. */
  cacheWriteUsdPerMillion?: number
}

/**
 * Haiku 4.5 through the Batch API (`docs/spec/01-decisions.md` §10.3: USD 1/5 per million;
 * Batch is −50 %), which is what §4.2 names as the default for this job. Only a default: the
 * real numbers come from sub-phase 7.1's pricing table once a provider is configured.
 */
export const DEFAULT_CONTEXTUALIZATION_PRICING: ContextualizationPricing = {
  inputUsdPerMillion: 0.5,
  outputUsdPerMillion: 2.5,
  cachedInputUsdPerMillion: 0.05,
  cacheWriteUsdPerMillion: 0.625,
}

/** The top of the band `prompts/contextualize.md` asks for. */
export const CONTEXT_OUTPUT_TOKENS = 100

export interface ContextualizationEstimateOptions {
  /** The system half of the prompt file; its tokens are part of every call. */
  systemPrompt: string
  document: DocumentContext
  /** Defaults to the chunker's own `chars4` heuristic. Pass a cl100k counter for a tighter
   *  number — this is the one place where the count feeds money rather than a boundary. */
  countTokens?: TokenCounter
  pricing?: ContextualizationPricing
  /** Whether the provider will cache the system + document prefix across the run. Default
   *  true: sub-phase 7.3 turns it on for exactly this job. */
  promptCaching?: boolean
}

export interface ContextualizationEstimate {
  chunkCount: number
  /**
   * The **display** total: uncached + cache-write + cached.
   *
   * Deliberately NOT what `ai_calls.input_tokens` means, which is the *uncached* count
   * alone — the same word with opposite meanings on the two sides of a package boundary.
   * Anything populating a cost-log row from this estimate wants `uncachedInputTokens`.
   */
  inputTokens: number
  cachedInputTokens: number
  /** Uncached prompt tokens — what `ai_calls.input_tokens` and `BillableUsage` mean. */
  uncachedInputTokens: number
  /** Prompt tokens written to the cache; 0 when `promptCaching` is off. */
  cacheWriteTokens: number
  outputTokens: number
  usd: number
}

const PER_MILLION = 1_000_000

/**
 * `chunks` are the chunks that would actually be sent — the caller filters out the ones that
 * already have a context, so re-running after a cancelled pass quotes only what is left.
 */
export function estimateContextualization(
  chunks: readonly Pick<ChunkDraft, 'text'>[],
  options: ContextualizationEstimateOptions,
): ContextualizationEstimate {
  const count = options.countTokens ?? countTokensByChars
  const pricing = options.pricing ?? DEFAULT_CONTEXTUALIZATION_PRICING
  const caching = options.promptCaching ?? true

  const prefixTokens = count(options.systemPrompt) + count(buildDocumentBlock(options.document))
  const chunkTokens = chunks.reduce((sum, chunk) => sum + count(chunk.text), 0)
  const calls = chunks.length

  if (calls === 0) {
    return {
      chunkCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      usd: 0,
    }
  }

  // With caching the prefix is written once and read back by every later call; without it,
  // every call pays for it in full.
  const cachedInputTokens = caching ? prefixTokens * (calls - 1) : 0
  const uncachedPrefixTokens = caching ? prefixTokens : prefixTokens * calls
  const inputTokens = uncachedPrefixTokens + chunkTokens
  const outputTokens = CONTEXT_OUTPUT_TOKENS * calls

  const prefixRate =
    caching && pricing.cacheWriteUsdPerMillion !== undefined
      ? pricing.cacheWriteUsdPerMillion
      : pricing.inputUsdPerMillion
  const cachedRate = pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion

  const usd =
    (uncachedPrefixTokens * prefixRate +
      chunkTokens * pricing.inputUsdPerMillion +
      cachedInputTokens * cachedRate +
      outputTokens * pricing.outputUsdPerMillion) /
    PER_MILLION

  return {
    chunkCount: calls,
    inputTokens: inputTokens + cachedInputTokens,
    cachedInputTokens,
    // With caching on, the prefix is a cache *write* and only the chunks are charged as
    // ordinary input; without it, every call pays for the prefix at the input rate.
    uncachedInputTokens: caching ? chunkTokens : uncachedPrefixTokens + chunkTokens,
    cacheWriteTokens: caching ? prefixTokens : 0,
    outputTokens,
    usd,
  }
}
