import type { AiError } from '../errors'
import type { InvokeOutcome, InvokeTarget } from '../invoker'
import type { TextGenerationRequest } from '../text-generator'

/**
 * The seam between the batch runner and a provider's Batch API.
 *
 * Three calls, because that is the whole of what every one of them offers: hand over a list,
 * ask how it is going, and give up. `createAnthropicBatchProvider` and
 * `createGoogleBatchProvider` (`@retenia/ai/providers`) implement it over the providers' REST
 * endpoints; `createSequentialBatchProvider` implements it over an ordinary `ProviderInvoker`,
 * which is what a profile with no Batch API — OpenRouter, a local model — transparently gets.
 *
 * Deliberately **not** built on the AI SDK. The SDK has no batch surface at all: the endpoints
 * are plain JSON over HTTPS, and going through a `fetch` seam keeps the adapters unit-testable
 * without a network and without a mock of a library.
 */

/** One unit of work in a batch: the `custom_id` it answers to, and the call itself. */
export interface BatchRequest {
  /**
   * `customId(...)` from `../idempotency` — the same string `ai_results` is keyed by and the
   * same one the provider echoes back beside each result, which is what makes reconciliation
   * a lookup rather than a positional match. Anthropic caps it at 64 characters, which is
   * why `MAX_CUSTOM_ID_CHARS` is what it is.
   */
  readonly customId: string
  readonly request: TextGenerationRequest
}

/** One finished item, in the same union a synchronous call settles into. */
export interface BatchItemOutcome {
  readonly customId: string
  readonly outcome: InvokeOutcome
}

export interface BatchSubmission {
  readonly providerBatchId: string
}

/** What a provider says a batch is doing. Mapped onto `AiBatchStatus` by the runner. */
export type ProviderBatchStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface BatchPoll {
  readonly status: ProviderBatchStatus
  /**
   * Every item the provider has finished, whenever it will say.
   *
   * Anthropic streams a results file once the whole batch ends; a provider that reports
   * partial progress may return items while `status` is still `in_progress`, and the runner
   * reconciles them straight away — the per-item guard in `reconcile` is what makes doing so
   * safe rather than a double charge.
   */
  readonly results: readonly BatchItemOutcome[]
  /** How many are still processing, when the provider counts them. */
  readonly processing?: number
  /**
   * The provider's own `Retry-After`, in milliseconds.
   *
   * `retry.ts` notes that nothing in 7.1 had any use for the header and that batch polling
   * would be the first caller that did. This is that caller: a 429 on a poll is answered by
   * waiting exactly as long as the provider asked, rather than by the local backoff's guess.
   */
  readonly retryAfterMs?: number
  /** Present when `status` is `failed`: why the provider gave up on the whole job. */
  readonly error?: AiError
}

export interface BatchCallOptions {
  readonly signal: AbortSignal | undefined
}

export interface BatchProvider {
  submit(
    target: InvokeTarget,
    requests: readonly BatchRequest[],
    options: BatchCallOptions,
  ): Promise<BatchSubmission>
  poll(target: InvokeTarget, providerBatchId: string, options: BatchCallOptions): Promise<BatchPoll>
  /** Best effort: a batch that has already finished cannot be cancelled and must not throw. */
  cancel(target: InvokeTarget, providerBatchId: string, options: BatchCallOptions): Promise<void>
}
