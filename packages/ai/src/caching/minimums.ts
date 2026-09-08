import type { ProviderProfile } from '../profiles'

/**
 * How many tokens a prefix must be worth before a provider will cache it at all
 * (`docs/spec/06-ai-providers.md` §2: *"minimum 1,024 tokens in Sonnet 5, 4,096 in Haiku"*).
 *
 * This is a **hard floor, not a heuristic**: Anthropic silently ignores a `cache_control`
 * breakpoint on a shorter prefix. Ignoring it silently is the expensive half — the call is
 * billed as an ordinary one, the run looks like it is caching, and the first time anybody
 * notices is when the month's total is 5x what the estimate said. The pre-check in
 * `withCache` is what turns that into a decision the caller can see.
 *
 * Keyed by model id within a kind rather than by `ModelKey`, because the floor is a property
 * of the model family and not of the account: a second Anthropic profile (7.5) reaches the
 * same Haiku with the same 4,096.
 */

/** Anthropic's small model asks for four times the prefix the others do. */
const ANTHROPIC_LARGE_MODEL_MINIMUM = 1024
const ANTHROPIC_HAIKU_MINIMUM = 4096

/**
 * The minimum for this target, or `null` when the provider has no *explicit* cache to place
 * a breakpoint in.
 *
 * `null` is not "no caching". Gemini caches implicitly on a repeated prefix with nothing to
 * mark and nothing to opt into (§2), so there is no minimum for a caller to clear and no
 * breakpoint for `withCache` to place — only an ordering rule, which it still applies. The
 * distinction matters because `undefined`-as-"no minimum" would let a 40-token prefix look
 * like it had passed a check that was never run.
 *
 * The `switch` has no `default`: `ProviderKind` is closed, so 7.4's `openai-compatible` is a
 * compile error here until somebody has decided what its floor is.
 */
export function cacheMinimumTokens(profile: ProviderProfile, modelId: string): number | null {
  switch (profile.kind) {
    case 'anthropic':
      return modelId.includes('haiku') ? ANTHROPIC_HAIKU_MINIMUM : ANTHROPIC_LARGE_MODEL_MINIMUM
    case 'google':
      return null
  }
}

/** Whether this target takes an explicit `cache_control` breakpoint at all. */
export function supportsExplicitCache(profile: ProviderProfile): boolean {
  return profile.kind === 'anthropic'
}
