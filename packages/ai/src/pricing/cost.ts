import { resolveRates } from './table'
import type { CacheTtl, ModelKey, PricingTable, Rates } from './types'

/**
 * What a call consumed, in the vocabulary the pricing table charges for.
 *
 * Two invariants, both enforced where the SDK's usage is translated
 * (`../providers/usage.ts`) and both relied on here:
 *
 * - The three input buckets are **disjoint** and sum to the prompt. `inputTokens` means
 *   *uncached* — the same thing `ai_calls.input_tokens` means, and deliberately NOT the
 *   same thing `@retenia/ingest`'s `ContextualizationEstimate.inputTokens` means (that one
 *   is a display total). Getting this wrong bills cached tokens at 1.0x AND at 0.1x, an
 *   11x over-count on exactly the mechanism caching exists to make cheap.
 * - `outputTokens` **includes** `reasoningTokens`. The reasoning count is carried for the
 *   log and the cost tooltip and is never added to anything.
 */
export interface BillableUsage {
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
}

export const ZERO_USAGE: BillableUsage = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
})

export interface CostRequest {
  readonly modelKey: ModelKey
  readonly usage: BillableUsage
  /** Comes from core's `Clock`; this module never reads a clock itself. */
  readonly at: Date
  readonly batch?: boolean
  readonly cacheTtl?: CacheTtl
}

export interface CostLine {
  readonly kind: 'input' | 'cache_read' | 'cache_write' | 'output' | 'reasoning'
  readonly tokens: number
  readonly usdPerMillion: number
  readonly usd: number
  /** True for `reasoning` only, which restates part of `output`. Never summed. */
  readonly informational: boolean
}

export interface CostBreakdown {
  readonly modelKey: ModelKey
  readonly baseModelKey: ModelKey
  readonly periodFrom: string | null
  readonly windowId: string | null
  readonly aggregator: string | null
  readonly rates: Rates
  readonly lines: readonly CostLine[]
  readonly subtotalUsd: number
  readonly batchApplied: boolean
  readonly aggregatorMultiplier: number
  /** Rounded to `COST_DECIMALS`. This is what `ai_calls.cost_usd` stores. */
  readonly usd: number
  readonly unverified: boolean
}

const PER_MILLION = 1_000_000

/**
 * A hundredth of a micro-dollar: far above float noise, far below the cheapest single call
 * (a 100-token Gemini Flash reply is ~4e-4 USD). `ai_calls.cost_usd` is a SQLite REAL, so
 * an integer money unit would only be divided back out at the boundary; a month of these
 * summed drifts on the order of 1e-10 USD against a cap of 30.
 */
export const COST_DECIMALS = 8

function round(usd: number): number {
  const scale = 10 ** COST_DECIMALS
  return Math.round(usd * scale) / scale
}

/**
 * `table` is a required first argument on purpose. A `SHIPPED_PRICING` default would let
 * two dozen cost assertions silently pin themselves to a file someone edits next week, and
 * the failure would look like a pricing bug rather than a test that was never specific.
 */
export function computeCostUsd(table: PricingTable, request: CostRequest): CostBreakdown {
  const resolved = resolveRates(table, request.modelKey, request.at)
  const { usage } = request

  // A `null` rate means the provider has no such tier, in which case those tokens bill at
  // the ordinary input rate. Never at zero: that would under-report a charge that happened.
  const cacheReadRate = resolved.cacheRead ?? resolved.input
  const cacheWriteRate =
    (request.cacheTtl === '1h' ? resolved.cacheWrite1h : resolved.cacheWrite5m) ?? resolved.input

  const lines: CostLine[] = [
    line('input', usage.inputTokens, resolved.input, false),
    line('cache_read', usage.cachedInputTokens, cacheReadRate, false),
    line('cache_write', usage.cacheWriteTokens, cacheWriteRate, false),
    line('output', usage.outputTokens, resolved.output, false),
    line('reasoning', usage.reasoningTokens, resolved.output, true),
  ]

  const subtotalUsd = lines.reduce((sum, l) => (l.informational ? sum : sum + l.usd), 0)

  // `batch: true` against a model with no Batch API charges full price and says so, rather
  // than throwing or quietly discounting. Pricing answers "what does this cost"; whether a
  // call may use the Batch API is 7.3's policy question.
  const batchApplied = request.batch === true && resolved.batchDiscount !== null
  const afterBatch = batchApplied ? subtotalUsd * (1 - (resolved.batchDiscount ?? 0)) : subtotalUsd

  // The fee is on the payment, not the consumption: you pay 105.50 to receive 100 of
  // credit, so it is x1.055 and not 1/(1-0.055).
  const feePct =
    resolved.aggregator === null ? 0 : (table.aggregators[resolved.aggregator]?.feePct ?? 0)
  const aggregatorMultiplier = 1 + feePct / 100

  return {
    modelKey: resolved.modelKey,
    baseModelKey: resolved.baseModelKey,
    periodFrom: resolved.periodFrom,
    windowId: resolved.windowId,
    aggregator: resolved.aggregator,
    rates: {
      input: resolved.input,
      output: resolved.output,
      cacheRead: resolved.cacheRead,
      cacheWrite5m: resolved.cacheWrite5m,
      cacheWrite1h: resolved.cacheWrite1h,
      batchDiscount: resolved.batchDiscount,
    },
    lines,
    subtotalUsd,
    batchApplied,
    aggregatorMultiplier,
    usd: round(afterBatch * aggregatorMultiplier),
    unverified: resolved.unverified,
  }
}

function line(
  kind: CostLine['kind'],
  tokens: number,
  usdPerMillion: number,
  informational: boolean,
): CostLine {
  return { kind, tokens, usdPerMillion, usd: (tokens * usdPerMillion) / PER_MILLION, informational }
}
