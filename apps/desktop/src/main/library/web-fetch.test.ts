import { describe, expect, it, vi } from 'vitest'
import { fetchWebPage } from './web-fetch'

function fakeFetch(html: string, options: { url?: string; ok?: boolean; status?: number } = {}) {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html))
        controller.close()
      },
    })
    return new Response(stream, {
      status: options.ok === false ? (options.status ?? 500) : 200,
    }) as Response & { url: string }
  })
}

/** `Response.url` is read-only in the real DOM; the fake above returns a plain `Response`
 *  (whose `.url` defaults to `''`), so tests that care about redirect resolution build one with
 *  `url` overridden directly instead of trying to construct a `Response` with a custom URL. */
function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

const RICH_HTML = `<html><body><article>${'word '.repeat(600)}</article></body></html>`
const THIN_HTML = '<html><body><div id="root"></div></body></html>'

/** Every test here fakes `fetchImpl`, so there is no real network to resolve `example.com`
 *  against — a no-op stand-in for the SSRF guard (`./url-safety`, tested on its own) keeps
 *  these tests about `fetchWebPage`'s own logic instead of DNS. */
const ALLOW_ALL_URLS = async () => {}

describe('fetchWebPage', () => {
  it('returns the static HTML when it has enough text', async () => {
    const fetchImpl = fakeFetch(RICH_HTML)
    const renderFallback = vi.fn(async () => 'unused')

    const result = await fetchWebPage('https://example.com/article', {
      fetchImpl,
      renderFallback,
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    expect(result.html).toBe(RICH_HTML)
    expect(result.rendered).toBe(false)
    expect(renderFallback).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('sends a browser-like User-Agent, not the default Electron one', async () => {
    const fetchImpl = fakeFetch(RICH_HTML)
    await fetchWebPage('https://example.com/article', {
      fetchImpl,
      renderFallback: async () => '',
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    const [, init] = fetchImpl.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(headers.get('User-Agent')).toMatch(/Chrome/)
  })

  it('escalates to the SPA fallback when the static page is too thin', async () => {
    const fetchImpl = fakeFetch(THIN_HTML)
    const renderFallback = vi.fn(async () => RICH_HTML)

    const result = await fetchWebPage('https://example.com/spa', {
      fetchImpl,
      renderFallback,
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    expect(renderFallback).toHaveBeenCalledWith('https://example.com/spa')
    expect(result.html).toBe(RICH_HTML)
    expect(result.rendered).toBe(true)
  })

  it('records the final URL after a redirect', async () => {
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(RICH_HTML))
          controller.close()
        },
      })
      return withUrl(new Response(stream, { status: 200 }), 'https://example.com/final')
    })

    const result = await fetchWebPage('https://example.com/short-link', {
      fetchImpl,
      renderFallback: async () => '',
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    expect(result.url).toBe('https://example.com/final')
  })

  it('throws for a non-ok response', async () => {
    const fetchImpl = fakeFetch('', { ok: false, status: 404 })
    await expect(
      fetchWebPage('https://example.com/missing', {
        fetchImpl,
        renderFallback: async () => '',
        assertPublicUrl: ALLOW_ALL_URLS,
      }),
    ).rejects.toThrow(/404/)
  })

  it('rejects a response larger than the size cap without buffering it all', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97)
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 11; i += 1) controller.enqueue(chunk)
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })

    await expect(
      fetchWebPage('https://example.com/huge', {
        fetchImpl,
        renderFallback: async () => '',
        assertPublicUrl: ALLOW_ALL_URLS,
      }),
    ).rejects.toThrow(/larger than/)
  })

  it('refuses to fetch a URL the SSRF guard rejects, without ever calling fetchImpl', async () => {
    const fetchImpl = fakeFetch(RICH_HTML)
    const assertPublicUrl = vi.fn(async () => {
      throw new Error('refusing: private address')
    })

    await expect(
      fetchWebPage('http://192.168.1.1/admin', {
        fetchImpl,
        renderFallback: async () => '',
        assertPublicUrl,
      }),
    ).rejects.toThrow(/refusing/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('re-checks the final URL after a redirect, refusing one that lands on a private address', async () => {
    const fetchImpl = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(RICH_HTML))
          controller.close()
        },
      })
      return withUrl(
        new Response(stream, { status: 200 }),
        'http://169.254.169.254/latest/meta-data/',
      )
    })
    const assertPublicUrl = vi.fn(async (url: string) => {
      if (url.includes('169.254.169.254')) throw new Error('refusing: private address')
    })
    const renderFallback = vi.fn(async () => '')

    await expect(
      fetchWebPage('https://example.com/redirects-to-internal', {
        fetchImpl,
        renderFallback,
        assertPublicUrl,
      }),
    ).rejects.toThrow(/refusing/)
    expect(assertPublicUrl).toHaveBeenCalledTimes(2)
    expect(renderFallback).not.toHaveBeenCalled()
  })
})
