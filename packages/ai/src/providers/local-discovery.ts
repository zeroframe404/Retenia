import { asRecord, asString } from './batch/http'

/**
 * The "Detectar" button's backend: probe a local OpenAI-compatible server for what it is
 * and what it has loaded (`docs/spec/06-ai-providers.md` §7). Lives behind the SDK/IO
 * boundary — `./index`, imported only by `apps/desktop` — because it is a raw `fetch`
 * against a user-supplied URL, the same reason `../batch/http.ts`'s adapters are.
 */

/** `globalThis.fetch`, narrowed and injectable in a test — the same shape `batch/http.ts` uses. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface DiscoveredLocalModel {
  readonly id: string
}

export interface LocalDiscovery {
  readonly reachable: boolean
  readonly server: 'ollama' | 'lmstudio' | 'unknown'
  readonly models: readonly DiscoveredLocalModel[]
}

const UNREACHABLE: LocalDiscovery = Object.freeze({
  reachable: false,
  server: 'unknown',
  models: Object.freeze([]),
})

/**
 * Ollama's native `GET /api/tags` is tried first — it is the richer of the two endpoints,
 * naming the model alongside its size and family — with the OpenAI-compatible
 * `GET /v1/models` that LM Studio (and Ollama itself) also answers as the fallback every
 * such server understands.
 *
 * Neither succeeding is not an error a caller has to catch: it is the ordinary "nothing is
 * running on this port yet" state a "Detectar" button reads as `reachable: false`, not a
 * reason to throw from a settings screen's discovery click.
 */
export async function discoverLocalProvider(
  baseURL: string,
  fetchLike: FetchLike = fetch,
): Promise<LocalDiscovery> {
  const origin = trimTrailingSlash(baseURL)
  return (
    (await tryOllamaTags(origin, fetchLike)) ??
    (await tryOpenAiModels(origin, fetchLike)) ??
    UNREACHABLE
  )
}

async function tryOllamaTags(
  origin: string,
  fetchLike: FetchLike,
): Promise<LocalDiscovery | undefined> {
  const body = await getJson(origin, '/api/tags', fetchLike)
  const raw = body?.models
  if (!Array.isArray(raw)) return undefined
  return {
    reachable: true,
    server: 'ollama',
    models: raw
      .map((entry) => asString(asRecord(entry)?.name))
      .filter((name): name is string => name !== undefined)
      .map((id) => ({ id })),
  }
}

async function tryOpenAiModels(
  origin: string,
  fetchLike: FetchLike,
): Promise<LocalDiscovery | undefined> {
  const body = await getJson(origin, '/v1/models', fetchLike)
  const raw = body?.data
  if (!Array.isArray(raw)) return undefined
  return {
    reachable: true,
    server: 'lmstudio',
    models: raw
      .map((entry) => asString(asRecord(entry)?.id))
      .filter((id): id is string => id !== undefined)
      .map((id) => ({ id })),
  }
}

async function getJson(
  origin: string,
  path: string,
  fetchLike: FetchLike,
): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetchLike(`${origin}${path}`)
    if (!response.ok) return undefined
    return asRecord(await response.json())
  } catch {
    // Connection refused, DNS failure, a timeout: all of them mean "not this endpoint",
    // never a reason to fail the whole probe.
    return undefined
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
