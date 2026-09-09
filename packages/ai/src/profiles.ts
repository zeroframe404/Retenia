import type { SecretName } from '@retenia/core'

/**
 * A configured way to reach a provider (`docs/spec/06-ai-providers.md` §6).
 *
 * The spec's profile also carries `baseURL`, `pricing` and `caps`. Here pricing lives in
 * its own versioned table (`./pricing`) keyed by `${kind}:${modelId}`, because a price is a
 * fact about a model on a date and a profile is a fact about an account — they change for
 * different reasons and on different schedules. `caps` arrives here, with the one flag 7.2
 * can act on. `baseURL` arrives with 7.4's `openai-compatible` kind: mandatory for it (and
 * checked for SSRF by whoever constructs the profile — `apps/desktop`, never this package),
 * absent for `anthropic`/`google`, whose SDKs know their own endpoint.
 */

/**
 * Closed on purpose: `bind.ts` switches on this with no `default` case, so adding a kind is
 * a compile error until its SDK factory exists, and the pricing test refuses an orphan row.
 * 7.4 adds `openai-compatible` (Ollama, LM Studio, Z.ai, Kimi, Qwen) and, later, `proxy`
 * for the commercial backend — which the spec is explicit is "just another profile".
 */
export const PROVIDER_KINDS = ['anthropic', 'google', 'openai-compatible'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/**
 * What the transport can do, as far as this layer needs to know
 * (`docs/spec/06-ai-providers.md` §6, "Support").
 *
 * `pdf`/`image`/`audio`/`video` are not declared: they are unreachable until a request
 * shape carries a media part, and declaring a capability nothing can exercise is a claim
 * no test can hold to account. `maxOutput`/`ctx` cover a real, live consequence instead —
 * see the field docs below — and TODO(11.x/12.x) marks the media flags for whichever
 * sub-phase gives a request shape a media part to carry.
 */
export interface ProviderCaps {
  /**
   * The provider constrains generation to a JSON Schema server-side — Anthropic's
   * `output_config.format = json_schema`, Gemini's `responseJsonSchema`, OpenAI's
   * `strict: true` — rather than merely being asked for JSON in the prompt.
   *
   * `runStructured` reads exactly this to choose between handing the schema to the
   * provider and falling back to JSON mode plus a zod parse. It is a property of the
   * *account and endpoint*, not of the model id, which is why it lives on the profile:
   * 7.4's `openai-compatible` kind reaches DeepSeek, Kimi and Qwen, which have JSON mode
   * and no grammar, through the same code path.
   */
  readonly jsonStrict: boolean
  /**
   * The output ceiling a caller may rely on when it does not set `maxOutputTokens` itself
   * (`docs/spec/06-ai-providers.md` §6, "Long outputs": 128K for Claude 5.x, 64K for
   * Haiku 4.5 and Gemini 3.x). Optional, and read as a *default*, never a clamp on a
   * caller-supplied value: a profile that bundles models with different real ceilings
   * (the shipped `anthropic` profile spans Haiku through Fable) declares the smallest one,
   * so the default this layer ever picks on its own is never past what every model in the
   * profile can actually honour.
   *
   * Without it, `providers/batch/anthropic.ts` had a single flat constant applied to
   * every model regardless of profile — this is what a caller that wants more than that
   * constant, and does not want to name a number itself, now gets instead.
   */
  readonly maxOutput?: number
  /**
   * The context window a caller may rely on absent better information — same
   * smallest-of-the-bundle reasoning as `maxOutput`. `local.ts`'s `guardLocalContext`
   * still uses its own `DEFAULT_LOCAL_CONTEXT_TOKENS` rather than this field: that guard
   * exists for locally-hosted models the user names by typing a model id nothing here has
   * a profile for, so there is no `ProviderCaps` to read in that case.
   */
  readonly ctx?: number
}

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
   *
   * `null` for a profile that needs no key at all — Ollama and LM Studio answer any request
   * on their loopback port, and inventing a `SECRET_NAMES` entry for "no secret" would make
   * every other reader of that list handle a case that is not a secret.
   */
  readonly keyRef: SecretName | null
  readonly models: readonly string[]
  readonly caps: ProviderCaps
  /**
   * Reachable on the loopback interface with no internet required, and billed at zero
   * regardless of what `pricing.json` does or does not know about the model id the user
   * typed in. `run.ts`'s cost step and `local.ts`'s offline gate both read exactly this
   * flag; it is *not* the same question as `kind === 'openai-compatible'`, because that
   * kind also reaches Z.ai/Kimi/Qwen (7.5+), which are cloud services with a real price.
   */
  readonly local?: boolean
  /**
   * Ollama, LM Studio and every other `openai-compatible` endpoint reach the model over
   * this base URL; absent for `anthropic`/`google`, whose SDK factories know their own.
   */
  readonly baseURL?: string
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
    // §6: `output_config.format = json_schema`, a compiled grammar with a 24 h cache.
    // `maxOutput`/`ctx` are Haiku 4.5's ceilings (64K output, 200K context) — the
    // smallest of the four bundled models, so a default this layer picks on its own
    // never exceeds what every model below can actually honour; Sonnet/Opus/Fable's
    // real 128K/1M ceilings are still reachable by a caller that sets `maxOutputTokens`.
    caps: Object.freeze({ jsonStrict: true, maxOutput: 64_000, ctx: 200_000 }),
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
    // §6: `responseJsonSchema`, over a broad subset of JSON Schema. Both bundled models
    // share the same 64K output ceiling and 1M context window.
    caps: Object.freeze({ jsonStrict: true, maxOutput: 64_000, ctx: 1_000_000 }),
    models: Object.freeze(['gemini-3.7-flash', 'gemini-3.5-flash-lite']),
  }),
] as const satisfies readonly ProviderProfile[])
