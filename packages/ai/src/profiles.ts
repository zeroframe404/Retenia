import type { SecretName } from '@retenia/core'

/**
 * A configured way to reach a provider (`docs/spec/06-ai-providers.md` §6).
 *
 * The spec's profile also carries `baseURL`, `pricing` and `caps`. Here pricing lives in
 * its own versioned table (`./pricing`) keyed by `${kind}:${modelId}`, because a price is a
 * fact about a model on a date and a profile is a fact about an account — they change for
 * different reasons and on different schedules. `baseURL` and `caps` arrive with the
 * sub-phases that can use them: 7.4's `openai-compatible` kind is what makes a base URL
 * mandatory (and brings its SSRF check with it), and every `caps` flag is either
 * unreachable today (`pdf`/`image`/`audio`/`video` — `TextGenerationRequest` carries no
 * media part) or 7.2's (`jsonStrict`).
 */

/**
 * Closed on purpose: `bind.ts` switches on this with no `default` case, so adding a kind is
 * a compile error until its SDK factory exists, and the pricing test refuses an orphan row.
 * 7.4 adds `openai-compatible` (Ollama, LM Studio, Z.ai, Kimi, Qwen) and, later, `proxy`
 * for the commercial backend — which the spec is explicit is "just another profile".
 */
export const PROVIDER_KINDS = ['anthropic', 'google'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export interface ProviderProfile {
  /**
   * What a `RoleConfig` references, what `ai.providers.allowlist` filters on, and what
   * `ai_calls.provider` records. Distinct from `kind` because a second Anthropic account
   * (7.5) is a second profile of the same kind.
   */
  readonly id: string
  readonly kind: ProviderKind
  /**
   * *Which* secret, never the secret. Because this is a `SECRET_NAMES` label rather than
   * key material, a profile is safe to log, to serialize, and — if a channel ever carried
   * one — to send over IPC.
   */
  readonly keyRef: SecretName
  readonly models: readonly string[]
}

/**
 * The default registry, matching the provider matrix in `docs/spec/01-decisions.md` §3.
 *
 * Every model listed here must have a row in `pricing.json`; `pricing/table.test.ts`
 * enforces that in both directions.
 */
export const DEFAULT_PROFILES: readonly ProviderProfile[] = Object.freeze([
  Object.freeze({
    id: 'anthropic',
    kind: 'anthropic',
    keyRef: 'anthropic',
    models: Object.freeze([
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-5',
      'claude-fable-5-1',
    ]),
  }),
  Object.freeze({
    id: 'google',
    kind: 'google',
    keyRef: 'google',
    models: Object.freeze(['gemini-3.7-flash', 'gemini-3.5-flash-lite']),
  }),
] as const satisfies readonly ProviderProfile[])
