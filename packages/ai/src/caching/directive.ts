import type { CacheTtl } from '../pricing/types'

/**
 * What a request asks the transport to mark as cacheable.
 *
 * A leaf module on purpose. `TextGenerationRequest` carries this, and `withCache` — which
 * builds it — reaches the injection envelope, which reaches the structured-output loop, which
 * reaches `TextGenerationRequest` again. Declaring the directive next to the builder would
 * make that a cycle; declaring it here, next to nothing, does not.
 *
 * The two flags are *breakpoints*, not content: the transport decides how to express them
 * (Anthropic's `cacheControl` provider option on a message part; nothing at all on Gemini,
 * which caches a repeated prefix implicitly). See `caching/with-cache.ts` for why the prefix
 * is user content rather than instructions.
 */
export interface PromptCacheDirective {
  readonly ttl: CacheTtl
  /** Mark the end of the instructions block. */
  readonly system: boolean
  /** Mark the end of the request's `cachePrefix` part. */
  readonly prefix: boolean
}
