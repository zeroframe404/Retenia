import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ProviderProfile } from '../profiles'

export type BindModel = (profile: ProviderProfile, modelId: string, apiKey: string) => LanguageModel

/**
 * A configured profile plus a model id becomes an AI SDK model.
 *
 * `apiKey` is a plain argument and stays one: it is never stored on a profile, never
 * attached to the returned object in a way we control, and never passed to anything that
 * serializes. Both factories fall back to an environment variable when no key is given —
 * we always pass one explicitly, so a missing key fails as `not_configured` in `run.ts`
 * rather than silently using whatever the machine happens to have exported.
 *
 * The `switch` has no `default` clause on purpose: `ProviderKind` is a closed union, so
 * adding a kind is a compile error here until its factory exists.
 */
export function bindLanguageModel(
  profile: ProviderProfile,
  modelId: string,
  apiKey: string,
): LanguageModel {
  switch (profile.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'openai-compatible':
      if (profile.baseURL === undefined) {
        // A profile-construction bug, not a runtime condition: whoever built this profile
        // (Ollama/LM Studio discovery, or a future Z.ai/Kimi/Qwen settings screen) is
        // required to set `baseURL` for this kind. Failing loudly here is better than
        // `createOpenAICompatible` failing on an `undefined` string with a less legible
        // message three layers down.
        throw new Error(`provider profile "${profile.id}" is openai-compatible but has no baseURL`)
      }
      // An empty key is exactly what a local server with no auth gets (`ProviderProfile`'s
      // `keyRef: null`): `apiKey` is always a string here, never `undefined`, so this never
      // falls back to reading an environment variable the way the two SDK factories above
      // deliberately avoid doing.
      return createOpenAICompatible({ name: profile.id, baseURL: profile.baseURL, apiKey })(modelId)
  }
}
