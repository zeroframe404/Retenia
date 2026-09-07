import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeHttpEpubLoader } from './epub-loader'

/**
 * `makeHttpEpubLoader` over a real zip's bytes, served by a fake `fetch` that honours `Range`
 * — the "with Range support" half of the reader spec (the task's `media://blob/<sha>` in the
 * real app; a fixed in-memory buffer here, since what is under test is the zip.js/HTTP glue,
 * not the protocol handler `apps/desktop/src/main/protocol/media-protocol.ts` already covers).
 */

const encoder = new TextEncoder()

async function buildFixtureZip(): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  const add = (name: string, text: string) =>
    writer.add(name, new Uint8ArrayReader(encoder.encode(text)))
  await add('META-INF/container.xml', '<container/>')
  await add('OEBPS/content.opf', '<package/>')
  await add('OEBPS/ch1.xhtml', '<html>capítulo uno</html>')
  return writer.close()
}

/** A minimal `Response`-returning `fetch` stand-in over a fixed buffer, honouring `Range`
 *  requests and a `HEAD` for the size — everything `HttpReader({ useRangeHeader: true })`
 *  needs, and nothing else. */
function fakeRangeFetch(bytes: Uint8Array) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range')
    if (init?.method === 'HEAD' && range === null) {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(bytes.length), 'accept-ranges': 'bytes' },
      })
    }
    // `bytes=X-Y` (an explicit range) or `bytes=-N` (a suffix range, "the last N bytes" —
    // what a zip reader asks for first, to find the end-of-central-directory record without
    // knowing the file's length up front).
    const bounded = range?.match(/^bytes=(\d+)-(\d+)$/)
    const suffix = range?.match(/^bytes=-(\d+)$/)
    if (bounded === null || bounded === undefined) {
      if (suffix != null && suffix[1] !== undefined) {
        const length = Math.min(Number(suffix[1]), bytes.length)
        const start = bytes.length - length
        const slice = bytes.slice(start)
        return new Response(slice, {
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
            'content-length': String(slice.length),
          },
        })
      }
      return new Response(bytes.slice(), { status: 200 })
    }
    const start = Number(bounded[1])
    const end = Number(bounded[2])
    const slice = bytes.slice(start, end + 1)
    return new Response(slice, {
      status: 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-length': String(slice.length),
      },
    })
  })
}

describe('makeHttpEpubLoader', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a text entry over Range requests without downloading the whole archive', async () => {
    const bytes = await buildFixtureZip()
    const fetchMock = fakeRangeFetch(bytes)
    vi.stubGlobal('fetch', fetchMock)

    const loader = makeHttpEpubLoader('media://blob/fixture.epub')
    const text = await loader.loadText('OEBPS/ch1.xhtml')
    expect(text).toBe('<html>capítulo uno</html>')

    // At least one request asked for a byte window strictly smaller than the whole archive —
    // `useRangeHeader: true` reading the entry's own bytes rather than the file end-to-end.
    // (zip.js also makes one capability-probing request with no `Range` before it learns the
    // server supports them; that one is not what this asserts against.)
    const calls = fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
    const rangedCalls = calls
      .map(([, init]) => new Headers(init?.headers).get('range'))
      .filter((range): range is string => range !== null)
    expect(rangedCalls.length).toBeGreaterThan(0)
    const partialRange = rangedCalls.some((range) => {
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (match === null || match[1] === undefined || match[2] === undefined) return false
      return Number(match[2]) - Number(match[1]) + 1 < bytes.length
    })
    expect(partialRange).toBe(true)

    await loader.destroy()
  })

  it('answers getSize from the entry the archive actually has, once loaded', async () => {
    const bytes = await buildFixtureZip()
    vi.stubGlobal('fetch', fakeRangeFetch(bytes))

    const loader = makeHttpEpubLoader('media://blob/fixture.epub')
    await loader.loadText('OEBPS/content.opf')
    expect(loader.getSize('OEBPS/content.opf')).toBe('<package/>'.length)
    expect(loader.getSize('does/not/exist')).toBe(0)

    await loader.destroy()
  })

  it('returns null for a path the archive does not have', async () => {
    const bytes = await buildFixtureZip()
    vi.stubGlobal('fetch', fakeRangeFetch(bytes))

    const loader = makeHttpEpubLoader('media://blob/fixture.epub')
    expect(await loader.loadText('missing.xhtml')).toBeNull()
    expect(await loader.loadBlob('missing.xhtml')).toBeNull()

    await loader.destroy()
  })
})
