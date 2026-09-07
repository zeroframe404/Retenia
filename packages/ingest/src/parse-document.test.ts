import type { OcrProvider } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../test/fake-parse-context'
import { parseDocument } from './parse-document'

const noopOcr: OcrProvider = { id: 'noop', recognize: async () => ({ text: '', confidence: 0 }) }

describe('parseDocument', () => {
  it('dispatches markdown and text to the same parser with different frontmatter handling', async () => {
    const ctx = createFakeParseContext()
    const md = await parseDocument(
      'markdown',
      { bytes: new TextEncoder().encode('---\ntitle: X\n---\n# Hi'), fallbackTitle: 'a.md' },
      ctx,
      noopOcr,
    )
    expect(md.kind).toBe('markdown')
    expect(md.meta.frontmatter).toEqual({ title: 'X' })

    const text = await parseDocument(
      'text',
      { bytes: new TextEncoder().encode('Just text.'), fallbackTitle: 'a.txt' },
      ctx,
      noopOcr,
    )
    expect(text.kind).toBe('text')
    expect(text.meta.frontmatter).toBeUndefined()
  })

  it('throws a clear error for a kind this function never handles (it needs the job environment)', async () => {
    const ctx = createFakeParseContext()
    await expect(
      parseDocument('video', { bytes: new Uint8Array(), fallbackTitle: 'a.mp4' }, ctx, noopOcr),
    ).rejects.toThrow(/"video" is parsed by ingest-media\.ts, not parseDocument/i)
  })

  // Timed out at the 5s default under `pnpm test`'s full-monorepo parallel load: this is the
  // one test in the suite that pays jsdom's and Defuddle's real (uncached) module-init cost,
  // which a machine already busy running every other package's tests can push past 5s even
  // though the test itself does very little work.
  it('dispatches a web source to parseWebPage', async () => {
    const ctx = createFakeParseContext()
    const envelope = {
      url: 'https://example.com/post',
      fetchedAt: '2026-09-06T00:00:00.000Z',
      html: `<html><body><article><p>${'word '.repeat(50)}</p></article></body></html>`,
      rendered: false,
    }
    const doc = await parseDocument(
      'web',
      {
        bytes: new TextEncoder().encode(JSON.stringify(envelope)),
        fallbackTitle: 'example.com/post',
      },
      ctx,
      noopOcr,
    )
    expect(doc.kind).toBe('web')
    expect(doc.meta.origin?.url).toBe('https://example.com/post')
  }, 20_000)

  it('dispatches a youtube source to parseYouTubePage', async () => {
    const ctx = createFakeParseContext()
    const envelope = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
      fetchedAt: '2026-09-06T00:00:00.000Z',
      title: 'A video',
      author: null,
      thumbnailUrl: null,
      transcript: [{ startSec: 0, endSec: 1, text: 'Hello.' }],
      transcriptLanguage: 'en',
      transcriptUnavailableReason: null,
    }
    const doc = await parseDocument(
      'youtube',
      { bytes: new TextEncoder().encode(JSON.stringify(envelope)), fallbackTitle: envelope.url },
      ctx,
      noopOcr,
    )
    expect(doc.kind).toBe('youtube')
    expect(doc.blocks).toHaveLength(1)
  })
})
