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

/** A real redirect response — status plus a `Location` header — the shape
 *  `fetchFollowingValidatedRedirects` actually reads, now that redirects are driven by hand
 *  (`redirect: 'manual'`) instead of trusting `net.fetch`'s own follow-and-report-`.url`
 *  behaviour. */
function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } })
}

function htmlResponse(html: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

const RICH_HTML = `<html><body><article>${'word '.repeat(600)}</article></body></html>`
const THIN_HTML = '<html><body><div id="root"></div></body></html>'
/** A framework shell whose only "content" is inline JSON state and a bundle reference — the
 *  case `countWords` used to miscount as a real page, because stripping tags alone leaves the
 *  `<script>` element's own text (hundreds of whitespace-separated tokens of JSON/JS) behind.
 *  Pretty-printed rather than compact JSON, so it actually reproduces the failure: a compact
 *  `JSON.stringify` has no whitespace at all, and `countWords` splits on whitespace. */
const SCRIPT_HEAVY_SPA_HTML = `<html><body><div id="root"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
  { props: { pageProps: Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, i])) } },
  null,
  1,
)}</script></body></html>`

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

  it('gives every hop a timeout signal, so a hung connection cannot stall the import forever', async () => {
    const fetchImpl = fakeFetch(RICH_HTML)
    await fetchWebPage('https://example.com/article', {
      fetchImpl,
      renderFallback: async () => '',
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    const [, init] = fetchImpl.mock.calls[0] ?? []
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.signal?.aborted).toBe(false)
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

  it('escalates a script-heavy SPA shell too, not just an empty one', async () => {
    // The precise regression: an inline `__NEXT_DATA__`/bundle blob alone used to read as
    // hundreds of "words" once tags were stripped, so this shell never triggered the fallback
    // it exists for.
    const fetchImpl = fakeFetch(SCRIPT_HEAVY_SPA_HTML)
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
    const fetchImpl = vi.fn(async (input: string) =>
      input === 'https://example.com/short-link'
        ? redirectResponse('https://example.com/final')
        : htmlResponse(RICH_HTML),
    )

    const result = await fetchWebPage('https://example.com/short-link', {
      fetchImpl,
      renderFallback: async () => '',
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    expect(result.url).toBe('https://example.com/final')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('follows a relative Location header, resolved against the redirecting URL', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input === 'https://example.com/short-link'
        ? redirectResponse('/final')
        : htmlResponse(RICH_HTML),
    )

    const result = await fetchWebPage('https://example.com/short-link', {
      fetchImpl,
      renderFallback: async () => '',
      assertPublicUrl: ALLOW_ALL_URLS,
    })

    expect(result.url).toBe('https://example.com/final')
  })

  it('follows a multi-hop redirect chain, validating every hop', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === 'https://example.com/a') return redirectResponse('https://example.com/b')
      if (input === 'https://example.com/b') return redirectResponse('https://example.com/c')
      return htmlResponse(RICH_HTML)
    })
    const assertPublicUrl = vi.fn(async (_url: string) => {})

    const result = await fetchWebPage('https://example.com/a', {
      fetchImpl,
      renderFallback: async () => '',
      assertPublicUrl,
    })

    expect(result.url).toBe('https://example.com/c')
    expect(assertPublicUrl.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
  })

  it('refuses an intermediate redirect hop that targets a private address, without requesting it', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === 'https://example.com/start') {
        return redirectResponse('http://192.168.1.1/internal')
      }
      throw new Error('must never request the internal hop, or anything after it')
    })
    const assertPublicUrl = vi.fn(async (url: string) => {
      if (url.includes('192.168')) throw new Error('refusing: private address')
    })

    await expect(
      fetchWebPage('https://example.com/start', {
        fetchImpl,
        renderFallback: async () => '',
        assertPublicUrl,
      }),
    ).rejects.toThrow(/refusing/)
    // Only the first hop was ever fetched — the guard ran before the internal hop's own request.
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws when a redirect response carries no Location header', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }))

    await expect(
      fetchWebPage('https://example.com/broken-redirect', {
        fetchImpl,
        renderFallback: async () => '',
        assertPublicUrl: ALLOW_ALL_URLS,
      }),
    ).rejects.toThrow(/Location/)
  })

  it('gives up after too many redirects rather than looping forever', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const n = Number(input.split('/').pop())
      return redirectResponse(`https://example.com/${n + 1}`)
    })

    await expect(
      fetchWebPage('https://example.com/0', {
        fetchImpl,
        renderFallback: async () => '',
        assertPublicUrl: ALLOW_ALL_URLS,
      }),
    ).rejects.toThrow(/redirected more than/)
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

  it('refuses a redirect that lands on a private address, without ever requesting it', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input === 'https://example.com/redirects-to-internal'
        ? redirectResponse('http://169.254.169.254/latest/meta-data/')
        : htmlResponse(RICH_HTML),
    )
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
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(renderFallback).not.toHaveBeenCalled()
  })
})
