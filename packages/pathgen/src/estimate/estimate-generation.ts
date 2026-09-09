import type { PerMillionRates, TokenCounter } from '@retenia/ai'
import { approximateTokens } from '@retenia/ai'
import type { Chunk } from '@retenia/core'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { OUTLINE_MAX_OUTPUT_TOKENS } from '../synthesize/tasks'

/**
 * The wizard's number before anything is sent (`docs/spec/04-path-generation.md` §13 step 1:
 * "live estimate of time and cost ('≈ 6 min and USD 3.40')"), as a pure function of the
 * chunks, the rate cards and a few assumptions the constants below make explicit.
 *
 * It is a band, not a figure: the input counts are `chars / 4` (±10 %), and the output
 * counts of P2 are guesses at what a graph and an outline weigh (±30 %). §6's table for a
 * 300-page book — 180 chunks, 220k in / 60k out for extraction, 80k / 20k for the synthesis —
 * is what the per-chunk and per-concept constants are fitted to. The batch path's exact
 * quote is the runner's own `estimate`, stored beside this one so the two can be compared.
 */

/** §6: 60k output tokens over 180 chunks, rounded up for a full answer. */
export const P1_OUTPUT_TOKENS_PER_CHUNK = 500
/** The identifiers, labels and instruction around the wrapped blocks. */
export const P1_TASK_OVERHEAD_TOKENS = 120
/** §13 step 2's "detecting 212 concepts" for a 180-chunk book. */
export const CONCEPTS_PER_CHUNK = 1.2
export const MIN_CONCEPTS = 8
export const CONCEPTS_PER_MODULE = 8
export const MIN_MODULES = 2
export const MAX_MODULES = 40
/** One heading line per chunk, roughly. */
export const TOC_TOKENS_PER_CHUNK = 12
export const OUTLINE_INPUT_TOKENS_PER_CONCEPT = 45
export const OUTLINE_TASK_TOKENS = 300
export const OUTLINE_OUTPUT_TOKENS_PER_CONCEPT = 25
export const OUTLINE_OUTPUT_BASE_TOKENS = 1_500
export const OUTLINE_OUTPUT_MARGIN = 1.3
export const MODULE_TASK_TOKENS = 1_500
export const MODULE_OUTPUT_TOKENS = 1_200
export const P1_TOLERANCE = 0.1
export const P2_TOLERANCE = 0.3
/** `docs/spec/06-ai-providers.md` §2: the Batch API is −50 %. */
export const DEFAULT_BATCH_DISCOUNT = 0.5
export const SYNC_SECONDS_PER_CALL = 4
export const OUTLINE_SECONDS = 25
export const MODULE_SECONDS = 12
/** §14 pitfall 18: "most finish in under 1 h". */
export const BATCH_MINUTES = Object.freeze({ low: 10, high: 60 })

export type EstimateChunk = Pick<Chunk, 'text' | 'context' | 'tokenCount'>

export interface EstimateInput {
  /** In scope and not front matter — what extraction would read. */
  readonly chunks: readonly EstimateChunk[]
  /** Chunks whose extraction already exists; they cost nothing. */
  readonly alreadyExtracted: number
  readonly rates: { readonly cheap?: PerMillionRates; readonly smart?: PerMillionRates }
  /** Tokens of each prompt's system message, output instruction included. */
  readonly systemTokens: {
    readonly extract: number
    readonly outline: number
    readonly module: number
  }
  readonly dispatch: 'sync' | 'batch'
  /** The cheap model's Batch API discount, when `dispatch` is `batch`; `0` for a model without one. */
  readonly batchDiscount?: number
  readonly countTokens?: TokenCounter
  readonly concurrency?: { readonly extract: number; readonly modules: number }
}

export interface StageEstimate {
  readonly calls: number
  /** Uncached prompt tokens — what `ai_calls.input_tokens` means. */
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly usd: number
}

export interface GenerationEstimate {
  readonly chunks: number
  readonly concepts: number
  readonly modules: number
  readonly p1: StageEstimate
  readonly p2Outline: StageEstimate
  readonly p2Modules: StageEstimate
  /** The midpoint; `lowUsd`/`highUsd` are the band the wizard should render. */
  readonly usd: number
  readonly lowUsd: number
  readonly highUsd: number
  readonly minutes: { readonly low: number; readonly high: number }
  readonly dispatch: 'sync' | 'batch'
  /** Whether each role could be priced; an unpriced role contributes 0 and the wizard says so. */
  readonly priced: { readonly cheap: boolean; readonly smart: boolean }
}

const PER_MILLION = 1_000_000

const ZERO_STAGE: StageEstimate = Object.freeze({
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  usd: 0,
})

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}

function priceOf(
  rates: PerMillionRates | undefined,
  tokens: Pick<
    StageEstimate,
    'inputTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'outputTokens'
  >,
  multiplier = 1,
): number {
  if (rates === undefined) return 0
  const cached = rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion
  const write = rates.cacheWriteUsdPerMillion ?? rates.inputUsdPerMillion
  return round(
    ((tokens.inputTokens * rates.inputUsdPerMillion +
      tokens.cachedInputTokens * cached +
      tokens.cacheWriteTokens * write +
      tokens.outputTokens * rates.outputUsdPerMillion) /
      PER_MILLION) *
      multiplier,
  )
}

/**
 * A run with a cap whose roles cannot be priced has a cap that cannot be enforced: the
 * quote is 0 and so is every recorded cost. Said once, up front, rather than discovered
 * from a bill.
 */
export function estimateWarnings(
  estimate: Pick<GenerationEstimate, 'priced'>,
  budgetCapUsd: number,
): GenerationWarning[] {
  if (budgetCapUsd <= 0) return []
  const out: GenerationWarning[] = []
  if (!estimate.priced.cheap) out.push(warning('estimate_unpriced', { role: 'cheap' }))
  if (!estimate.priced.smart) out.push(warning('estimate_unpriced', { role: 'smart' }))
  return out
}

export function expectedConcepts(chunks: number): number {
  return Math.max(MIN_CONCEPTS, Math.round(CONCEPTS_PER_CHUNK * chunks))
}

export function expectedModules(concepts: number): number {
  return Math.min(MAX_MODULES, Math.max(MIN_MODULES, Math.round(concepts / CONCEPTS_PER_MODULE)))
}

export function estimateGeneration(input: EstimateInput): GenerationEstimate {
  const count = input.countTokens ?? approximateTokens
  const concurrency = input.concurrency ?? { extract: 6, modules: 3 }
  const chunks = input.chunks.length
  const concepts = expectedConcepts(chunks)
  const modules = expectedModules(concepts)

  // P1 — one call per chunk not yet extracted, at the average chunk weight.
  const calls = Math.max(0, chunks - input.alreadyExtracted)
  const chunkTokens = input.chunks.reduce(
    (sum, chunk) =>
      sum +
      (chunk.tokenCount > 0 ? chunk.tokenCount : count(chunk.text)) +
      (chunk.context === null ? 0 : count(chunk.context)),
    0,
  )
  const averageChunk = chunks === 0 ? 0 : chunkTokens / chunks
  const discount = input.dispatch === 'batch' ? (input.batchDiscount ?? DEFAULT_BATCH_DISCOUNT) : 0
  const p1Tokens = {
    inputTokens: Math.round(
      calls * (input.systemTokens.extract + averageChunk + P1_TASK_OVERHEAD_TOKENS),
    ),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: calls * P1_OUTPUT_TOKENS_PER_CHUNK,
  }
  const p1: StageEstimate =
    calls === 0
      ? ZERO_STAGE
      : { calls, ...p1Tokens, usd: priceOf(input.rates.cheap, p1Tokens, 1 - discount) }

  // P2 — the outline reads the TOC and the concept list once; the modules read them cached.
  const prefix = TOC_TOKENS_PER_CHUNK * chunks + OUTLINE_INPUT_TOKENS_PER_CONCEPT * concepts
  const outlineTokens = {
    inputTokens: input.systemTokens.outline + prefix + OUTLINE_TASK_TOKENS,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: Math.min(
      OUTLINE_MAX_OUTPUT_TOKENS,
      Math.round(OUTLINE_OUTPUT_TOKENS_PER_CONCEPT * concepts * OUTLINE_OUTPUT_MARGIN) +
        OUTLINE_OUTPUT_BASE_TOKENS,
    ),
  }
  const p2Outline: StageEstimate =
    chunks === 0
      ? ZERO_STAGE
      : { calls: 1, ...outlineTokens, usd: priceOf(input.rates.smart, outlineTokens) }

  const modulePrefix = input.systemTokens.module + prefix
  const moduleTokens = {
    inputTokens: modules * MODULE_TASK_TOKENS,
    cachedInputTokens: modulePrefix * (modules - 1),
    cacheWriteTokens: modulePrefix,
    outputTokens: modules * MODULE_OUTPUT_TOKENS,
  }
  const p2Modules: StageEstimate =
    chunks === 0
      ? ZERO_STAGE
      : { calls: modules, ...moduleTokens, usd: priceOf(input.rates.smart, moduleTokens) }

  const p2Usd = p2Outline.usd + p2Modules.usd
  const usd = round(p1.usd + p2Usd)
  const lowUsd = round(p1.usd * (1 - P1_TOLERANCE) + p2Usd * (1 - P2_TOLERANCE))
  const highUsd = round(p1.usd * (1 + P1_TOLERANCE) + p2Usd * (1 + P2_TOLERANCE))

  const p2Seconds =
    chunks === 0
      ? 0
      : OUTLINE_SECONDS + (modules * MODULE_SECONDS) / Math.max(1, concurrency.modules)
  const p1Seconds = (calls * SYNC_SECONDS_PER_CALL) / Math.max(1, concurrency.extract)
  const minutes =
    input.dispatch === 'batch' && calls > 0
      ? {
          low: BATCH_MINUTES.low + Math.ceil(p2Seconds / 60),
          high: BATCH_MINUTES.high + Math.ceil(p2Seconds / 60),
        }
      : {
          low: Math.ceil((p1Seconds + p2Seconds) / 60),
          high: Math.ceil((2 * (p1Seconds + p2Seconds)) / 60),
        }

  return {
    chunks,
    concepts,
    modules,
    p1,
    p2Outline,
    p2Modules,
    usd,
    lowUsd,
    highUsd,
    minutes,
    dispatch: input.dispatch,
    priced: { cheap: input.rates.cheap !== undefined, smart: input.rates.smart !== undefined },
  }
}
