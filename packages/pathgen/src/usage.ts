import type { TextGenerationUsage } from '@retenia/ai'

/** What a stage spent, in the four numbers `generation_runs` and `extractions` keep. */
export interface StageUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
  readonly usd: number
}

export const ZERO_USAGE: StageUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  usd: 0,
})

export function usageOf(usage: TextGenerationUsage | undefined): StageUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedTokens: usage?.cachedInputTokens ?? 0,
    usd: usage?.usd ?? 0,
  }
}

export function addUsage(a: StageUsage, b: StageUsage): StageUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    usd: a.usd + b.usd,
  }
}

/**
 * Whether a structured result was answered by the provider rather than by `ai_results`.
 *
 * `runOnce` reports a cache hit as `usage: { usd: 0 }` with no token counts, and a real call
 * always reports what it read — so "no input tokens and nothing spent" is a replay.
 */
export function wasProviderCall(usage: TextGenerationUsage | undefined): boolean {
  return usage !== undefined && (usage.inputTokens !== undefined || (usage.usd ?? 0) > 0)
}
