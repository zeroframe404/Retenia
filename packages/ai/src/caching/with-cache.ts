import type { CacheTtl } from '../pricing'
import type { ProviderProfile } from '../profiles'
import { USER_CONTENT_INSTRUCTIONS, wrapUserContent } from '../structured'
import { approximateTokens, TOKEN_ESTIMATE_TOLERANCE, type TokenCounter } from '../tokens'
import type { PromptCacheDirective } from './directive'
import { cacheMinimumTokens, supportsExplicitCache } from './minimums'

/**
 * Where a request's cache breakpoints go, and whether it is worth placing them at all
 * (`docs/spec/06-ai-providers.md` §2: write 1.25x at 5 min or 2x at 1 h, read 0.1x, minimum
 * 1,024 tokens on Sonnet 5 and 4,096 on Haiku).
 *
 * The shape of a cached call in this app is fixed by a rule `sdk-invoker.ts` states at its
 * own call site: **untrusted text is always the user prompt and never the instructions.** A
 * source chunk, a scraped page, an ASR transcript — none of it may enter the system block, no
 * matter how stable a prefix it would make. So a cacheable request has two segments and they
 * live on opposite sides of that boundary:
 *
 * 1. the **instructions**, which are ours, and
 * 2. a **`cachePrefix`**: the sources, wrapped in `<user_content>`, sent as their own text
 *    part of the user message, ahead of the volatile task.
 *
 * A breakpoint is placed at the end of each, so the whole stable head of the prompt is one
 * cached prefix and only the task text is re-read on every call. That is the arrangement
 * §7 stage 7 of `04-path-generation.md` depends on — forty lessons over one book, each
 * re-reading a document block that was paid for once.
 *
 * The **pre-check** is the reason this is a function rather than two string concatenations.
 * Anthropic does not reject a breakpoint on a prefix below the minimum; it ignores it, bills
 * the call at the ordinary rate, and reports no cache tokens. A run can therefore look
 * exactly like a cached one and cost five times the estimate, and nothing surfaces the
 * difference until the month's total does. `decision` says out loud which of the four things
 * happened, and `packages/ai`'s own logger prints it once per run.
 */

export interface CacheBreakpoint {
  readonly at: 'system' | 'prefix'
  /** Cumulative approximate tokens up to and including this point. */
  readonly tokens: number
}

/**
 * Why the plan looks the way it does.
 *
 * - `explicit` — breakpoints placed; the provider will bill a cache write once and reads after.
 * - `implicit` — the provider caches a repeated prefix on its own (Gemini); nothing is marked,
 *   but the stable material is still put first, which is what implicit caching keys on.
 * - `below-minimum` — the prefix is real but too short to be cached; no breakpoints, so the
 *   cost model is not told to expect a discount that will not arrive.
 * - `nothing-to-cache` — no sources and instructions too short to be worth a breakpoint.
 */
export type CacheDecision = 'explicit' | 'implicit' | 'below-minimum' | 'nothing-to-cache'

export interface CachePlan {
  /** The instructions, unchanged. Present so a caller can spread the whole plan into a request. */
  readonly system: string
  /** The stable, wrapped user-content head. Empty when there are no sources. */
  readonly cachePrefix: string
  /** Absent unless `decision` is `explicit`. */
  readonly cache: PromptCacheDirective | undefined
  readonly breakpoints: readonly CacheBreakpoint[]
  /** Approximate tokens in `system` + `cachePrefix`, by `countTokens`. */
  readonly prefixTokens: number
  /** The provider's floor, or `null` when it has no explicit cache. */
  readonly minimumTokens: number | null
  readonly decision: CacheDecision
  /** `looksLikeInjection` fired on at least one source. Carried through, never acted on. */
  readonly injectionSuspected: boolean
}

export interface WithCacheOptions {
  readonly profile: ProviderProfile
  readonly modelId: string
  /** Defaults to `'5m'`; see `cacheTtlFor`. */
  readonly ttl?: CacheTtl
  /** Defaults to the `chars / 4` heuristic. Pass a real tokenizer when the margin is tight. */
  readonly countTokens?: TokenCounter
  /** `label="…"` on each wrapped block, so a prompt with several can name them. */
  readonly labels?: readonly string[]
}

/**
 * §7 stage 7 runs for as long as the batch does — up to an hour of lessons over one book, and
 * the whole point of the 2x write is that the prefix survives to the end of it.
 */
export const PATH_GENERATION_CACHE_TTL: CacheTtl = '1h'
/** Everything else is a burst: a grading pass, a chat turn, a contextualisation sweep. */
export const DEFAULT_CACHE_TTL: CacheTtl = '5m'

/**
 * The TTL policy of this sub-phase, as one function rather than a rule in four call sites.
 *
 * The 1 h tier costs 2x to write against the 5 m tier's 1.25x, so it pays for itself only
 * when the prefix is read back more than about three times *after* the five-minute window
 * would have expired. A generation run over a book is the case where that is obviously true
 * and the only one this build has.
 */
export function cacheTtlFor(options: { pathGeneration?: boolean }): CacheTtl {
  return options.pathGeneration === true ? PATH_GENERATION_CACHE_TTL : DEFAULT_CACHE_TTL
}

/**
 * The margin the pre-check requires over the provider's floor.
 *
 * `approximateTokens` is `chars / 4` and is wrong by ~10 % in either direction, so a prefix
 * the heuristic scores at exactly 1,024 has an even chance of being 950 real tokens — and a
 * breakpoint on 950 is silently ignored and silently billed. Requiring the estimate to clear
 * the floor by the heuristic's own error bar is what makes the check mean something. The cost
 * of being wrong the other way is one prefix that could have been cached and was not.
 */
const MARGIN = 1 + TOKEN_ESTIMATE_TOLERANCE

/**
 * Build the cacheable head of a request.
 *
 * `sources` are untrusted and are wrapped — each in its own `<user_content>` block, in the
 * order given, because order is meaning and the prefix has to be byte-identical between calls
 * for the provider to recognise it.
 *
 * The returned `system` is the one to send: when there are sources and the caller's prompt does
 * not already explain the envelope, `USER_CONTENT_INSTRUCTIONS` is appended to it. See below
 * for why that is this function's business.
 */
export function withCache(
  rawSystem: string,
  sources: readonly string[],
  options: WithCacheOptions,
): CachePlan {
  const count = options.countTokens ?? approximateTokens
  const ttl = options.ttl ?? DEFAULT_CACHE_TTL
  const minimumTokens = cacheMinimumTokens(options.profile, options.modelId)

  // The envelope without the paragraph that explains it is decoration — `user-content.ts` is
  // explicit that "the prompt is told, in the system message, that everything inside is data"
  // is the control that does the work, and the delimiter is only what stops the payload
  // ending it early. `withCache` is the one place that knows both halves, so it is where the
  // two are kept together: a caller whose prompt file already carries the paragraph is left
  // alone, and one that forgot gets it appended rather than shipping a wrapped-but-unexplained
  // block. Appending is safe for caching — the instructions are part of the stable head, so
  // the prefix stays byte-identical between calls.
  const system =
    sources.length === 0 || rawSystem.includes(USER_CONTENT_INSTRUCTIONS)
      ? rawSystem
      : `${rawSystem}

${USER_CONTENT_INSTRUCTIONS}`

  let injectionSuspected = false
  const blocks = sources.map((source, index) => {
    const label = options.labels?.[index]
    const wrapped = label === undefined ? wrapUserContent(source) : wrapUserContent(source, label)
    if (wrapped.injectionSuspected) injectionSuspected = true
    return wrapped.text
  })
  const cachePrefix = blocks.join('\n\n')

  const systemTokens = count(system)
  const prefixTokens = systemTokens + (cachePrefix === '' ? 0 : count(cachePrefix))

  const plan = (
    decision: CacheDecision,
    cache: PromptCacheDirective | undefined,
    breakpoints: readonly CacheBreakpoint[],
  ): CachePlan => ({
    system,
    cachePrefix,
    cache,
    breakpoints,
    prefixTokens,
    minimumTokens,
    decision,
    injectionSuspected,
  })

  // Gemini's implicit cache needs no breakpoint and offers no opt-in (§2). The stable head is
  // still assembled and still goes first, because that prefix is exactly what it matches on.
  if (!supportsExplicitCache(options.profile) || minimumTokens === null) {
    return plan(
      cachePrefix === '' && systemTokens === 0 ? 'nothing-to-cache' : 'implicit',
      undefined,
      [],
    )
  }

  if (prefixTokens === 0) return plan('nothing-to-cache', undefined, [])
  if (prefixTokens < minimumTokens * MARGIN) return plan('below-minimum', undefined, [])

  // Two breakpoints, not one. Anthropic caches up to the *last* marked block, so a single
  // mark at the end of the sources would already cover the instructions — but the pair is
  // what keeps the instructions cached on a call that carries no sources at all, which is
  // every grading call after the first, and it costs nothing to place.
  const breakpoints: CacheBreakpoint[] = [{ at: 'system', tokens: systemTokens }]
  if (cachePrefix !== '') breakpoints.push({ at: 'prefix', tokens: prefixTokens })

  return plan('explicit', { ttl, system: true, prefix: cachePrefix !== '' }, breakpoints)
}
