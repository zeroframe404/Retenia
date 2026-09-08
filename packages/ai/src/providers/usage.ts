import type { LanguageModelUsage } from 'ai'
import type { BillableUsage } from '../pricing'

const nonNegative = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || value < 0 ? 0 : value

/**
 * AI SDK 7's usage, in the shape the pricing table charges for.
 *
 * Mostly a rename, and deliberately not a per-provider convention table: `ai@7.0.93`
 * already normalises. `inputTokenDetails.{noCacheTokens,cacheReadTokens,cacheWriteTokens}`
 * are **disjoint** and sum to `inputTokens`, and `outputTokenDetails.reasoningTokens` is a
 * **subset** of `outputTokens`. Both facts are read from the shipped `.d.ts`, not assumed.
 *
 * Two defences survive that:
 *
 * - When `noCacheTokens` is missing but `inputTokens` is not, derive it by subtraction.
 *   Falling back to `inputTokens` itself would bill cached tokens at the full rate *and*
 *   again at the cache rate — an ~11x over-count on precisely the mechanism caching exists
 *   to make cheap, and one that looks entirely plausible in a monthly total.
 * - Clamp `reasoningTokens` to `outputTokens`, so `reasoning <= output` holds for every row
 *   ever written even if a provider reports otherwise.
 */
export function toBillableUsage(usage: LanguageModelUsage | undefined): BillableUsage {
  const cachedInputTokens = nonNegative(usage?.inputTokenDetails?.cacheReadTokens)
  const cacheWriteTokens = nonNegative(usage?.inputTokenDetails?.cacheWriteTokens)

  const reported = usage?.inputTokenDetails?.noCacheTokens
  const inputTokens =
    reported === undefined
      ? Math.max(0, nonNegative(usage?.inputTokens) - cachedInputTokens - cacheWriteTokens)
      : nonNegative(reported)

  const outputTokens = nonNegative(usage?.outputTokens)
  const reasoningTokens = Math.min(
    outputTokens,
    nonNegative(usage?.outputTokenDetails?.reasoningTokens),
  )

  return { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens }
}
