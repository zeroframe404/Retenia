import type { BatchProvider } from '../../batch'
import type { ProviderKind } from '../../profiles'
import { createAnthropicBatchProvider } from './anthropic'
import { createGoogleBatchProvider } from './google'
import type { FetchLike } from './http'

/**
 * The Batch API adapters, by provider kind.
 *
 * The map is **partial on purpose**, and that is the whole mechanism behind "OpenRouter/local
 * → transparent sequential fallback": a kind with no entry gets `createSequentialBatchProvider`
 * from the runner, which behaves identically and simply does not save 50 %. A `Record` with an
 * entry per kind would force somebody to invent an adapter for a provider that has no Batch
 * API, and the honest version of that adapter is the fallback.
 *
 * OpenAI's Batch API is real and is in `docs/spec/06-ai-providers.md` §1's table, but there is
 * no `openai` in `PROVIDER_KINDS` yet and so nothing to route to it: it arrives with the
 * profile, in 7.4, rather than as an adapter with no caller.
 */
export function createBatchAdapters(
  options: { fetch?: FetchLike; now?: () => Date } = {},
): Partial<Record<ProviderKind, BatchProvider>> {
  return {
    anthropic: createAnthropicBatchProvider(options),
    google: createGoogleBatchProvider(options),
  }
}

export type { AnthropicBatchOptions } from './anthropic'
export { createAnthropicBatchProvider, parseResults, toMessageParams } from './anthropic'
export type { GoogleBatchOptions } from './google'
export { createGoogleBatchProvider, parseInlined, toGenerateContentRequest } from './google'
export type { FetchLike } from './http'
