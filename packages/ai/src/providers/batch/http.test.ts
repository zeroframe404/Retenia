import { describe, expect, it } from 'vitest'
import { AiError } from '../../errors'
import { type FetchLike, MAX_RESPONSE_BYTES, requestJson, requestText } from './http'

/**
 * The three ways a batch endpoint's *response* — as opposed to its content — can hurt this
 * process: by redirecting the credential somewhere else, by being enormous, and by echoing the
 * key back inside an error body.
 */

const CANARY = 'sk-ant-CANARY-7f3a'

function request(over: Record<string, unknown> = {}) {
  return {
    url: 'https://example.test/v1/messages/batches',
    method: 'GET' as const,
    headers: { 'x-api-key': CANARY },
    signal: undefined,
    apiKey: CANARY,
    context: { profileId: 'anthropic', model: 'claude-sonnet-5' },
    ...over,
  }
}

/** A `fetch` that answers once and records the `RequestInit` it was handed. */
function once(response: Response): { fetch: FetchLike; init: () => RequestInit | undefined } {
  let seen: RequestInit | undefined
  return {
    init: () => seen,
    fetch: async (_url, init) => {
      seen = init
      return response
    },
  }
}

describe('redirects', () => {
  it('asks fetch never to follow one', () => {
    // Node strips `authorization` and `cookie` across an origin but not a custom header, and
    // the credential here is `x-api-key`. Following a redirect would replay it to whatever
    // host the `Location` names.
    const { fetch, init } = once(new Response('{}', { status: 200 }))
    return requestJson(fetch, request()).then(() => {
      expect(init()?.redirect).toBe('manual')
    })
  })

  it('refuses a 3xx rather than treating it as an error to retry', async () => {
    const { fetch } = once(
      new Response('', { status: 302, headers: { location: 'https://evil.test/x' } }),
    )

    const thrown = await requestJson(fetch, request())
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(AiError)
    expect((thrown as AiError).message).toMatch(/redirect is not followed/)
    expect((thrown as AiError).statusCode).toBe(302)
  })
})

describe('the response size ceiling', () => {
  it('refuses a body whose declared length is over the ceiling, before reading it', async () => {
    const { fetch } = once(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
      }),
    )

    await expect(requestText(fetch, request())).rejects.toThrow(/ceiling/)
  })

  it('meters a chunked body too, which is the shape a large results file arrives in', async () => {
    // No `content-length` to check, so the only defence is counting as it goes.
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength
        if (sent > MAX_RESPONSE_BYTES * 2) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
    })
    const { fetch } = once(new Response(body, { status: 200 }))

    await expect(requestText(fetch, request())).rejects.toThrow(/ceiling/)
  })

  it('reads an ordinary body whole', async () => {
    const { fetch } = once(new Response('one\ntwo\n', { status: 200 }))
    expect(await requestText(fetch, request())).toBe('one\ntwo\n')
  })
})

describe('error bodies', () => {
  it('redacts the key before the excerpt is clipped, not after', async () => {
    // Exactly the failure this ordering exists to prevent: the key sits past the excerpt
    // boundary, so clipping first would keep a *prefix* of it that the exact-match redaction
    // no longer sees — and that fragment goes on to `ai_calls.error` and the tray.
    const padding = 'x'.repeat(195)
    const { fetch } = once(
      new Response(`${padding}${CANARY} is invalid`, { status: 401, statusText: 'Unauthorized' }),
    )

    const thrown = await requestText(fetch, request())
      .then(() => undefined)
      .catch((error: unknown) => error as AiError)

    expect(thrown?.code).toBe('auth')
    const message = thrown?.message ?? ''
    expect(message).not.toContain(CANARY)
    for (let length = 8; length <= CANARY.length; length += 1) {
      expect(message).not.toContain(CANARY.slice(0, length))
    }
  })

  it('keeps the status line, which is what makes a failure recognisable', async () => {
    const { fetch } = once(new Response('nope', { status: 503, statusText: 'Overloaded' }))
    await expect(requestText(fetch, request())).rejects.toThrow(/503 Overloaded/)
  })
})

describe('transport failures', () => {
  it('reports a cancelled request as aborted rather than as a network fault', async () => {
    const aborted = new Error('The operation was aborted')
    aborted.name = 'AbortError'
    const fetch: FetchLike = async () => {
      throw aborted
    }

    const thrown = await requestText(fetch, request())
      .then(() => undefined)
      .catch((error: unknown) => error as AiError)

    expect(thrown?.code).toBe('aborted')
  })

  it('reports a deadline the same way, so a timeout is not retried as a server error', async () => {
    // `REQUEST_TIMEOUT_MS` reaches here as a `TimeoutError` from `AbortSignal.timeout`.
    const timedOut = new Error('The operation timed out')
    timedOut.name = 'TimeoutError'
    const fetch: FetchLike = async () => {
      throw timedOut
    }

    const thrown = await requestText(fetch, request())
      .then(() => undefined)
      .catch((error: unknown) => error as AiError)

    expect(thrown?.code).toBe('aborted')
  })

  it('redacts the key out of a transport error message', async () => {
    const fetch: FetchLike = async () => {
      throw new Error(`connect ECONNREFUSED while sending ${CANARY}`)
    }

    const thrown = await requestText(fetch, request())
      .then(() => undefined)
      .catch((error: unknown) => error as AiError)

    expect(thrown?.code).toBe('network')
    expect(thrown?.message).not.toContain(CANARY)
  })
})
