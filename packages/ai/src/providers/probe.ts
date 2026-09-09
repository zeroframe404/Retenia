import { generateText } from 'ai'
import type { ProviderProfile } from '../profiles'
import { asRecord, asString } from './batch/http'
import type { BindModel } from './bind'
import { bindLanguageModel } from './bind'
import { fromSdkError } from './from-sdk-error'
import type { FetchLike } from './local-discovery'
import { discoverLocalProvider } from './local-discovery'

/**
 * The "Probar conexión" button's backend (`docs/spec/08-ux.md` §1): a real, minimal call
 * that proves a key works, plus a best-effort model list. Lives behind the SDK/IO boundary
 * — `./index`, imported only by `apps/desktop` — for the same reason `local-discovery.ts`
 * does: it is a raw network call against user-supplied credentials.
 */

export interface ProbeResult {
  readonly ok: boolean
  readonly models: readonly string[]
  readonly error: string | null
  readonly latencyMs: number
}

export interface ProbeOptions {
  readonly fetchLike?: FetchLike
  readonly bindModel?: BindModel
}

/**
 * Two independent halves, always both attempted and merged rather than short-circuited:
 *
 * 1. **The 1-token call** — the thing that actually proves the key works, since a model
 *    list endpoint can answer with a key that has no usable quota or is scoped wrong.
 * 2. **The model list** — read from whichever endpoint the profile's kind exposes, so the
 *    caller can offer choices beyond the profile's own static `models` array.
 *
 * A model-list failure never flips `ok` to `false`: a stale or unreachable listing endpoint
 * is a real, separate condition from "the key is bad", and conflating them would make a
 * successful probe report failure for the wrong reason.
 */
export async function probeProvider(
  profile: ProviderProfile,
  apiKey: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const bindModel = options.bindModel ?? bindLanguageModel
  const fetchLike = options.fetchLike ?? fetch

  const [call, models] = await Promise.all([
    probeCall(profile, apiKey, bindModel),
    listModels(profile, apiKey, fetchLike),
  ])

  return { ok: call.ok, error: call.error, latencyMs: call.latencyMs, models }
}

async function probeCall(
  profile: ProviderProfile,
  apiKey: string,
  bindModel: BindModel,
): Promise<{ ok: boolean; error: string | null; latencyMs: number }> {
  const modelId = profile.models[0]
  if (modelId === undefined) {
    return { ok: false, error: 'this provider has no model configured to probe', latencyMs: 0 }
  }

  const startedAt = Date.now()
  try {
    const model = bindModel(profile, modelId, apiKey)
    await generateText({ model, prompt: 'Hi', maxOutputTokens: 1, maxRetries: 0 })
    return { ok: true, error: null, latencyMs: Date.now() - startedAt }
  } catch (error) {
    const classified = fromSdkError(error, { profileId: profile.id, model: modelId }, apiKey)
    return { ok: false, error: classified.message, latencyMs: Date.now() - startedAt }
  }
}

async function listModels(
  profile: ProviderProfile,
  apiKey: string,
  fetchLike: FetchLike,
): Promise<readonly string[]> {
  if (profile.local === true) {
    if (profile.baseURL === undefined) return []
    const discovery = await discoverLocalProvider(profile.baseURL, fetchLike)
    return discovery.models.map((entry) => entry.id)
  }

  switch (profile.kind) {
    case 'anthropic':
      return listFromArray(
        'https://api.anthropic.com/v1/models',
        fetchLike,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        'data',
        'id',
      )
    case 'google':
      return listFromArray(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        fetchLike,
        {},
        'models',
        'name',
      )
    case 'openai-compatible':
      if (profile.baseURL === undefined) return []
      return listFromArray(
        `${trimTrailingSlash(profile.baseURL)}/v1/models`,
        fetchLike,
        apiKey === '' ? {} : { Authorization: `Bearer ${apiKey}` },
        'data',
        'id',
      )
  }
}

/**
 * `GET url`, pull an array field out of the JSON body, and read one string field off each
 * entry. Never throws: connection failures, a non-2xx status, or a body that doesn't parse
 * all mean "no models to report" — the same "never throw" philosophy `local-discovery.ts`
 * follows, because a listing failure here is not the caller's problem to catch.
 */
async function listFromArray(
  url: string,
  fetchLike: FetchLike,
  headers: Record<string, string>,
  arrayField: string,
  idField: string,
): Promise<readonly string[]> {
  try {
    const response = await fetchLike(url, { headers })
    if (!response.ok) return []
    const body = asRecord(await response.json())
    const entries = body?.[arrayField]
    if (!Array.isArray(entries)) return []
    return entries
      .map((entry) => asString(asRecord(entry)?.[idField]))
      .filter((id): id is string => id !== undefined)
  } catch {
    return []
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
