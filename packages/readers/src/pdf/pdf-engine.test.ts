import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { pageViewport } from './pdf-engine'

/**
 * pdf.js's real parsing of the fixture PDF (the same `five-pages.pdf`
 * `packages/ingest`'s own parser tests use) — the assumptions `PdfPage`/`PdfReader` build on.
 *
 * These call `getDocument({ data })` directly rather than through `loadPdfDocument(url)`:
 * pdf.js's legacy build picks its Node network stream whenever a Node `process` is visible —
 * true here even under `environment: 'jsdom'` — and that stream only reads `file://` URLs,
 * over a jsdom/Node buffer-interop path this fixture hits a real bug in (`getArrayBuffer -
 * unexpected data`, the file's bytes arriving as a plain array rather than a binary buffer).
 * The real Electron renderer has no such `process` and takes the fetch-based stream instead,
 * Range-served by `apps/desktop/src/main/protocol/media-protocol.ts` and already tested
 * there. `loadPdfDocument` itself is `getDocument({ url }).promise` — trivial enough that its
 * own correctness is evident from the source, and it is exercised for real by every
 * `PdfReader` test that loads a document.
 */

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../test/fixtures/pdf/five-pages.pdf',
)

function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE_PATH))
}

describe('pdf.js parsing the real fixture', () => {
  it('reports the fixture’s real page count', async () => {
    const task = getDocument({ data: fixtureBytes() })
    try {
      const pdf = await task.promise
      expect(pdf.numPages).toBe(5)
    } finally {
      await task.destroy()
    }
  })

  it('extracts real text content per page', async () => {
    const task = getDocument({ data: fixtureBytes() })
    try {
      const pdf = await task.promise
      const page = await pdf.getPage(1)
      const content = await page.getTextContent()
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
      expect(text.trim().length).toBeGreaterThan(0)
    } finally {
      await task.destroy()
    }
  })

  it('rejects for bytes that are not a PDF', async () => {
    const task = getDocument({ data: new TextEncoder().encode('not a pdf') })
    await expect(task.promise).rejects.toBeTruthy()
  })
})

describe('pageViewport', () => {
  it('scales width and height proportionally to the requested scale', async () => {
    const task = getDocument({ data: fixtureBytes() })
    try {
      const pdf = await task.promise
      const page = await pdf.getPage(1)
      const at1x = pageViewport(page, 1)
      const at2x = pageViewport(page, 2)
      expect(at2x.width).toBeCloseTo(at1x.width * 2, 5)
      expect(at2x.height).toBeCloseTo(at1x.height * 2, 5)
    } finally {
      await task.destroy()
    }
  })
})
