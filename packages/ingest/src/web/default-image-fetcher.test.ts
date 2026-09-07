import { describe, expect, it, vi } from 'vitest'
import { createDefaultImageFetcher } from './parse-web'

const PAGE_URL = 'https://example.com/articles/spaced-repetition'

function fakeFetch(body: Uint8Array, headers: Record<string, string> = {}) {
  return vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers })
  })
}

describe('createDefaultImageFetcher', () => {
  it('downloads a same-origin image', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchImpl = fakeFetch(bytes, { 'content-type': 'image/png; charset=binary' })
    const fetchImage = createDefaultImageFetcher(PAGE_URL, fetchImpl as unknown as typeof fetch)

    const result = await fetchImage('https://example.com/articles/images/diagram.png')

    expect(result).toEqual({ bytes, mime: 'image/png' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('refuses a cross-origin image without ever making a request', async () => {
    const fetchImpl = fakeFetch(new Uint8Array())
    const fetchImage = createDefaultImageFetcher(PAGE_URL, fetchImpl as unknown as typeof fetch)

    const result = await fetchImage('https://cdn.other-site.example/pixel.png')

    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a same-origin request over the size cap via Content-Length', async () => {
    const fetchImpl = fakeFetch(new Uint8Array(), { 'content-length': String(11 * 1024 * 1024) })
    const fetchImage = createDefaultImageFetcher(PAGE_URL, fetchImpl as unknown as typeof fetch)

    const result = await fetchImage('https://example.com/huge.png')

    expect(result).toBeNull()
  })

  it('aborts a same-origin stream that exceeds the cap without a truthful Content-Length', async () => {
    const oversized = new Uint8Array(11 * 1024 * 1024)
    const fetchImpl = fakeFetch(oversized)
    const fetchImage = createDefaultImageFetcher(PAGE_URL, fetchImpl as unknown as typeof fetch)

    const result = await fetchImage('https://example.com/huge.png')

    expect(result).toBeNull()
  })

  it('returns null for a non-ok response rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
    const fetchImage = createDefaultImageFetcher(PAGE_URL, fetchImpl as unknown as typeof fetch)

    const result = await fetchImage('https://example.com/missing.png')

    expect(result).toBeNull()
  })

  it('refuses to follow a redirect, never requesting wherever it points', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
    )
    const fetchImage = createDefaultImageFetcher(PAGE_URL, fetchImpl as unknown as typeof fetch)

    const result = await fetchImage('https://example.com/redirecting.png')

    expect(result).toBeNull()
    // Same-origin only ever validates the URL handed in; if the fetcher followed this redirect
    // itself, the request would be to a private address it never gets a chance to check.
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })
})
