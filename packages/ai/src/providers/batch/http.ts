import type { AiErrorCode, AiErrorContext } from '../../errors'
import { AiError, redactKey } from '../../errors'

/**
 * The little bit of HTTP the Batch adapters need, and the seam that keeps them testable.
 *
 * The AI SDK has no batch surface — `generateText` is a single completion and that is all
 * `ai@7` offers — so these adapters speak the providers' REST endpoints directly. That is a
 * feature rather than a workaround: a batch is three JSON calls and a results file, and going
 * through `fetch` means the whole adapter is exercised in a unit test by a function that
 * returns a canned `Response`, with no library to mock and nothing skipped.
 */

/** `globalThis.fetch`, narrowed to what these adapters use and injectable in a test. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpRequest {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly headers: Record<string, string>
  readonly body?: unknown
  readonly signal: AbortSignal | undefined
  /** Redacted out of any message this throws. */
  readonly apiKey: string
  readonly context: AiErrorContext
  /**
   * Called with the raw response before the status is judged.
   *
   * The one thing a caller needs that a thrown `AiError` cannot carry: `Retry-After`. A 429 on
   * a poll is the provider saying exactly how long to wait, and `backoff.ts` prefers it to its
   * own guess — but the header lives on the response and the error carries only a status code,
   * so the adapter reads it here rather than losing it.
   */
  readonly onResponse?: (response: Response) => void
}

/**
 * A JSON call that turns a non-2xx into an `AiError` with the same status→code mapping the
 * synchronous path uses (`from-sdk-error.ts`), so a 429 on a poll and a 429 on a completion
 * classify identically.
 *
 * The response body is **not** attached to the error beyond a clipped, key-redacted excerpt:
 * a batch error body can echo the requests, and `ai_calls.error` is not a place for prompts.
 */
export async function requestJson(fetchLike: FetchLike, request: HttpRequest): Promise<unknown> {
  const text = await requestText(fetchLike, request)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new AiError(
      'server_error',
      `the ${request.context.profileId ?? 'provider'} batch endpoint returned a body that is not JSON`,
      request.context,
    )
  }
}

/**
 * The provider's own results file can be one line per request, and a batch may hold 100,000
 * of them (`docs/spec/06-ai-providers.md` §2). This runs in the **main** process, so an
 * unbounded `response.text()` is a way for a provider — or anything that can answer as one —
 * to put hundreds of megabytes of string into the process that owns the window and the
 * database. 32 MiB is comfortably above a realistic run of a few thousand lessons and far
 * below anything that would matter to the app; past it the read is abandoned rather than
 * completed.
 */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

/** The same call, for an endpoint that answers with JSONL rather than one object. */
export async function requestText(fetchLike: FetchLike, request: HttpRequest): Promise<string> {
  let response: Response
  try {
    response = await fetchLike(request.url, {
      method: request.method,
      headers: { ...request.headers, ...(request.body === undefined ? {} : jsonHeader) },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      // **Never followed.**
      //
      // Node strips `authorization`, `cookie` and `host` across an origin on a redirect; it
      // does not strip a *custom* header, and the credential here is `x-api-key` /
      // `x-goog-api-key`. A single 302 from anything that can answer as the provider would
      // therefore replay the user's key to whatever host the `Location` names. Neither
      // provider's batch API redirects in normal operation, so refusing costs nothing and
      // closes the shortest path there is from "a response we did not expect" to "the key
      // left the machine".
      redirect: 'manual',
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new AiError('aborted', 'the caller cancelled the request', request.context)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new AiError('network', redactKey(message, request.apiKey), request.context)
  }

  request.onResponse?.(response)

  if (response.status >= 300 && response.status < 400) {
    throw new AiError(
      'server_error',
      `the ${request.context.profileId ?? 'provider'} batch endpoint answered ` +
        `${response.status}; a redirect is not followed, because the API key travels in a ` +
        'custom header that Node would replay to the new host',
      { ...request.context, statusCode: response.status },
    )
  }

  let body: string
  try {
    body = await readLimited(response, request)
  } catch (error) {
    // The ceiling is a decision, not a read failure: it must not be swallowed into an empty
    // body that then looks like a successful, contentless response.
    if (error instanceof AiError) throw error
    // A *successful* response we could not finish reading is not a success — a truncated
    // results file would reconcile half a batch and lose the rest.
    if (response.ok) {
      throw new AiError(
        'network',
        `the ${request.context.profileId ?? 'provider'} batch endpoint's response could not ` +
          'be read to the end',
        request.context,
      )
    }
    // An unreadable *error* body still has a status line worth reporting.
    body = ''
  }

  if (!response.ok) {
    throw new AiError(
      codeForStatus(response.status),
      // Redacted **before** the excerpt, not after. `redactKey` matches the key exactly, so
      // clipping first can leave a prefix of it straddling the 200-character boundary that
      // nothing then matches — and that fragment goes on to `ai_calls.error`,
      // `ai_batches.error` and the tray.
      `${response.status} ${response.statusText}: ${excerpt(redactKey(body, request.apiKey))}`,
      { ...request.context, statusCode: response.status },
    )
  }
  return body
}

/**
 * The body, up to `MAX_RESPONSE_BYTES`.
 *
 * `content-length` is checked first when the provider sends one — the cheap path, and the
 * only one that can refuse before anything is transferred — and the stream is metered
 * regardless, because a chunked response has no length to check and is exactly the shape a
 * large results file arrives in.
 */
async function readLimited(response: Response, request: HttpRequest): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw tooLarge(request, declared)
  }

  const body = response.body
  if (body === null) return ''

  const decoder = new TextDecoder()
  const reader = body.getReader()
  let read = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      read += value.byteLength
      if (read > MAX_RESPONSE_BYTES) throw tooLarge(request, read)
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    // Releasing the lock is not enough on the throwing path: the socket stays open until the
    // body is cancelled, and a main process that abandons one per poll leaks them.
    reader.cancel().catch(() => undefined)
  }
  return text + decoder.decode()
}

function tooLarge(request: HttpRequest, bytes: number): AiError {
  return new AiError(
    'server_error',
    `the ${request.context.profileId ?? 'provider'} batch endpoint answered with at least ` +
      `${bytes} bytes, over this layer's ${MAX_RESPONSE_BYTES}-byte ceiling`,
    request.context,
  )
}

const jsonHeader = { 'content-type': 'application/json' } as const

/** `Retry-After` in seconds, or an HTTP date, as milliseconds. */
export function retryAfterMs(response: Pick<Response, 'headers'>, now: Date): number | undefined {
  const header = response.headers.get('retry-after')
  if (header === null) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(header)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now.getTime())
}

/** Enough of the body to recognise the failure; never enough to be a prompt. */
const EXCERPT_CHARS = 200

function excerpt(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  return trimmed.length <= EXCERPT_CHARS ? trimmed : `${trimmed.slice(0, EXCERPT_CHARS - 1)}…`
}

/** The same mapping `from-sdk-error.ts` applies, so both paths classify a status alike. */
export function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  if (status >= 400) return 'bad_request'
  return 'network'
}

/** `unknown` narrowed to a bag of properties, so parsing a provider payload needs no casts. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
