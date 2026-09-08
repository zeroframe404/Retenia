/**
 * Prompt caching (sub-phase 7.3): where the breakpoints go, and the pre-check that keeps a
 * prefix below the provider's minimum from looking like a discount it never received.
 */

export type { PromptCacheDirective } from './directive'
export { cacheMinimumTokens, supportsExplicitCache } from './minimums'
export type {
  CacheBreakpoint,
  CacheDecision,
  CachePlan,
  WithCacheOptions,
} from './with-cache'
export {
  cacheTtlFor,
  DEFAULT_CACHE_TTL,
  PATH_GENERATION_CACHE_TTL,
  withCache,
} from './with-cache'
