import type { AiError } from './errors'
import type { BillableUsage } from './pricing'
import type { ProviderProfile } from './profiles'
import type { TextGenerationRequest } from './text-generator'

/** One target, with the key resolved immediately before the call and held nowhere else. */
export interface InvokeTarget {
  readonly profile: ProviderProfile
  readonly modelId: string
  readonly apiKey: string
}

export interface InvokeOptions {
  readonly signal: AbortSignal | undefined
  /**
   * Called with each element of an `Output.array` completion as the provider streams it
   * (`docs/spec/06-ai-providers.md` §6: "`Output.array` with `elementStream` — each item
   * arrives complete and validated").
   *
   * Present only when the caller is in array mode and wants the items durable before the
   * call ends. It is what makes a run cut off by `maxOutputTokens` — or by a crash, or by
   * the user closing the app — keep the items it already paid for: §6 is explicit that a
   * long output must be persisted per item rather than as one giant JSON. An adapter that
   * cannot stream simply never calls it, and the caller falls back to parsing the whole
   * completion, which is a slower path and not a broken one.
   *
   * The element is **raw**: the SDK has checked it against the JSON Schema, nothing has
   * checked it against the zod schema or the sanitizer yet. `runStructured` does both
   * before it reaches a caller.
   */
  readonly onElement?: (element: unknown) => void
}

export type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'

/**
 * A discriminated union, **not** a throw.
 *
 * The acceptance criterion for this sub-phase is "a 429 triggers fallback and *both
 * attempts are logged*", and a union is what makes that structural rather than a
 * discipline: `run` writes the `ai_calls` row on a settle path with no early return and no
 * `catch` for a later edit to forget. It also lets a 500 that already burned 3,000 input
 * tokens carry its usage into the log — an error that throws cannot.
 */
export type InvokeOutcome =
  | {
      readonly kind: 'ok'
      readonly text: string
      readonly modelId: string
      readonly usage: BillableUsage
      readonly finishReason: FinishReason
      readonly requestId?: string
    }
  | {
      readonly kind: 'error'
      readonly error: AiError
      /** Present when the provider reported usage before failing. */
      readonly usage?: BillableUsage
      readonly requestId?: string
    }

/**
 * The seam between the pure half of this package and the AI SDK.
 *
 * `createSdkInvoker()` (`./providers`) in production; `createScriptedInvoker([…])`
 * (`./testing`) in every test that is not about the SDK itself.
 */
export type ProviderInvoker = (
  target: InvokeTarget,
  request: TextGenerationRequest,
  options: InvokeOptions,
) => Promise<InvokeOutcome>
