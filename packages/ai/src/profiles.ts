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
 * Only `jsonStrict` for now: the media flags the spec lists (`pdf`, `image`, `audio`,
 * `video`) are unreachable until a request shape carries a media part, and declaring a
 * capability nothing can exercise is a claim no test can hold to account.
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
    caps: Object.freeze({ jsonStrict: true }),
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
    // §6: `responseJsonSchema`, over a broad subset of JSON Schema.
    caps: Object.freeze({ jsonStrict: true }),
    models: Object.freeze(['gemini-3.7-flash', 'gemini-3.5-flash-lite']),
  }),
] as const satisfies readonly ProviderProfile[])
