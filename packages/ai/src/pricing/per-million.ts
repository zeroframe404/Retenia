import { resolveRates } from './table'
import type { CacheTtl, ModelKey, PricingTable } from './types'

/**
 * A rate card in the shape `@retenia/ingest`'s `estimateContextualization` wants.
 *
 * Structurally identical to that package's `ContextualizationPricing`, and redeclared
 * rather than imported because the dependency edge runs ingest -> ai and never back
 * (`tooling/scripts/check-deps.mjs`). `pnpm typecheck` is what keeps the two in step: the
 * assignment happens in `apps/desktop`, which imports both, so a drift is a compile error
 * rather than a runtime surprise — and `estimate.pricing.test.ts` pins the numbers.
 */
export interface PerMillionRates {
  readonly inputUsdPerMillion: number
  readonly outputUsdPerMillion: number
  readonly cachedInputUsdPerMillion?: number
  readonly cacheWriteUsdPerMillion?: number
}

/**
 * The rates a quote should use, with the batch discount and any aggregator fee already
 * folded in — because the estimator multiplies tokens by these numbers directly, so
 * anything left outside them would make the quote disagree with the charge.
 */
export function toPerMillionRates(
  table: PricingTable,
  key: ModelKey,
  options: { at: Date; batch?: boolean; cacheTtl?: CacheTtl },
): PerMillionRates {
  const rates = resolveRates(table, key, options.at)

  const discounted = options.batch === true && rates.batchDiscount !== null
  const feePct = rates.aggregator === null ? 0 : (table.aggregators[rates.aggregator]?.feePct ?? 0)
  const multiplier = (discounted ? 1 - (rates.batchDiscount ?? 0) : 1) * (1 + feePct / 100)

  // A `null` tier bills at the input rate (see `computeCostUsd`), and the estimator's own
  // doc says to pass the input rate when the provider has no cache — so both are always
  // populated rather than left undefined for the caller to guess at.
  const cacheWrite =
    (options.cacheTtl === '1h' ? rates.cacheWrite1h : rates.cacheWrite5m) ?? rates.input

  return {
    inputUsdPerMillion: rates.input * multiplier,
    outputUsdPerMillion: rates.output * multiplier,
    cachedInputUsdPerMillion: (rates.cacheRead ?? rates.input) * multiplier,
    cacheWriteUsdPerMillion: cacheWrite * multiplier,
  }
}
