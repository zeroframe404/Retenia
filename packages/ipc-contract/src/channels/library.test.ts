import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import {
  ANNOTATION_KINDS,
  annotationSchema,
  EMBEDDING_STATUSES,
  readingLocatorSchema,
  recentSourceSchema,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  sourceDocSchema,
  sourceSummarySchema,
} from './library'

describe('source vocabulary', () => {
  /** Three copies — here, `packages/core`'s `SOURCE_KINDS`/`SOURCE_STATUSES`, and the
   *  `CHECK` constraints `packages/db` builds — for the same reason `jobs.test.ts` checks
   *  its own vocabulary: this leaf package cannot import either of the others. */
  it('matches the domain vocabulary the database enforces', () => {
    expect([...SOURCE_KINDS]).toEqual([
      'pdf',
      'docx',
      'epub',
      'pptx',
      'markdown',
      'text',
      'image',
      'audio',
      'video',
      'youtube',
      'web',
    ])
    expect([...SOURCE_STATUSES]).toEqual(['pending', 'processing', 'ready', 'failed'])
    expect([...EMBEDDING_STATUSES]).toEqual(['pending', 'running', 'ready', 'failed'])
  })

  it('matches ANNOTATION_KINDS in packages/core and the database CHECK', () => {
    expect([...ANNOTATION_KINDS]).toEqual(['highlight', 'note', 'region', 'clip'])
  })
})

describe('annotationSchema', () => {
  const base = {
    id: '019213cd-0000-7000-8000-000000000001',
    sourceId: '019213cd-0000-7000-8000-000000000002',
    unitId: null,
    kind: 'highlight' as const,
    quote: 'texto resaltado',
    note: null,
    color: 'yellow',
    tStart: null,
    tEnd: null,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  }

  it('accepts a PDF highlight anchor (page + fractional rects)', () => {
    const result = annotationSchema.safeParse({
      ...base,
      anchor: { page: 12, rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }] },
    })
    expect(result.success).toBe(true)
  })

  it('accepts an EPUB CFI anchor', () => {
    const result = annotationSchema.safeParse({
      ...base,
      anchor: { cfi: 'epubcfi(/6/4!/4/2/1:0)' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a clip anchor', () => {
    const result = annotationSchema.safeParse({
      ...base,
      kind: 'clip',
      anchor: { tStart: 10, tEnd: 20 },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an anchor matching none of the known shapes', () => {
    const result = annotationSchema.safeParse({ ...base, anchor: { foo: 'bar' } })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    const result = annotationSchema.safeParse({
      ...base,
      kind: 'bookmark',
      anchor: { page: 1, rects: [] },
    })
    expect(result.success).toBe(false)
  })
})

describe('readingLocatorSchema / recentSourceSchema', () => {
  it('accepts a page locator and a CFI locator', () => {
    expect(readingLocatorSchema.safeParse({ page: 12 }).success).toBe(true)
    expect(readingLocatorSchema.safeParse({ cfi: 'epubcfi(/6/4!/4/2)' }).success).toBe(true)
  })

  it('rejects an empty locator', () => {
    expect(readingLocatorSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a well-formed recent source', () => {
    const result = recentSourceSchema.safeParse({
      id: '019213cd-0000-7000-8000-000000000001',
      kind: 'pdf',
      title: 'Fisiología.pdf',
      locator: { page: 12 },
      lastOpenedAt: '2026-09-02T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})

const summary = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'pdf' as const,
  title: 'Cell Biology.pdf',
  status: 'ready' as const,
  language: 'en',
  error: null,
  meta: {
    sourceDocBlobSha256: 'a'.repeat(64),
    blockCount: 12,
    assetCount: 1,
    needsOcr: false,
    ocrPages: [],
    warnings: [],
  },
  blobSha256: 'b'.repeat(64),
  embeddingStatus: 'ready' as const,
  embeddingModelId: 'embeddinggemma-300m@768',
  embeddingError: null,
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
}

describe('sourceSummarySchema', () => {
  it('accepts a well-formed summary', () => {
    expect(sourceSummarySchema.safeParse(summary).success).toBe(true)
  })

  it('allows a null meta before the source has ever parsed', () => {
    expect(sourceSummarySchema.safeParse({ ...summary, meta: null }).success).toBe(true)
  })

  it('allows a null blobSha256 before the source has ever ingested', () => {
    expect(sourceSummarySchema.safeParse({ ...summary, blobSha256: null }).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(sourceSummarySchema.safeParse({ ...summary, status: 'archived' }).success).toBe(false)
    expect(
      sourceSummarySchema.safeParse({ ...summary, embeddingStatus: 'embedding' }).success,
    ).toBe(false)
  })

  it('allows a source that has never been embedded to name no space', () => {
    expect(
      sourceSummarySchema.safeParse({
        ...summary,
        embeddingStatus: 'pending',
        embeddingModelId: null,
      }).success,
    ).toBe(true)
  })
})

describe('library.listSources', () => {
  const { input } = contract['library.listSources']

  it('defaults to every status', () => {
    expect(input.parse({})).toEqual({})
  })

  it('rejects an empty status filter, which would silently mean "nothing"', () => {
    expect(input.safeParse({ statuses: [] }).success).toBe(false)
  })
})

describe('library.addSourceFromFiles', () => {
  const { input } = contract['library.addSourceFromFiles']
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])

  it('takes one or more named files as bytes — never a path', () => {
    expect(input.parse({ files: [{ name: 'book.pdf', bytes }] })).toEqual({
      files: [{ name: 'book.pdf', bytes }],
    })
    expect(input.safeParse({ files: [{ name: '/home/me/book.pdf' }] }).success).toBe(false)
  })

  it('rejects an empty list, an empty file, and a nameless one', () => {
    expect(input.safeParse({ files: [] }).success).toBe(false)
    expect(input.safeParse({ files: [{ name: 'a.pdf', bytes: new Uint8Array() }] }).success).toBe(
      false,
    )
    expect(input.safeParse({ files: [{ name: '', bytes }] }).success).toBe(false)
  })

  it('bounds the batch size', () => {
    const files = Array.from({ length: 51 }, (_unused, i) => ({ name: `f${i}.pdf`, bytes }))
    expect(input.safeParse({ files }).success).toBe(false)
  })
})

describe('library.addSourceFromText', () => {
  const { input } = contract['library.addSourceFromText']

  it('takes text and a title', () => {
    expect(input.parse({ text: 'Hello', title: 'Notes' })).toEqual({
      text: 'Hello',
      title: 'Notes',
    })
  })

  it('rejects empty text or an empty title', () => {
    expect(input.safeParse({ text: '', title: 'Notes' }).success).toBe(false)
    expect(input.safeParse({ text: 'Hello', title: '' }).success).toBe(false)
  })
})

describe('library.addSourceFromUrl', () => {
  const { input, output } = contract['library.addSourceFromUrl']

  it('takes an http(s) URL', () => {
    expect(input.parse({ url: 'https://example.com/article' })).toEqual({
      url: 'https://example.com/article',
    })
    expect(input.safeParse({ url: 'http://example.com/article' }).success).toBe(true)
  })

  it('rejects a file:// URL — net.fetch would happily serve one', () => {
    expect(input.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false)
  })

  it('rejects a javascript: URL', () => {
    expect(input.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('rejects a non-URL string', () => {
    expect(input.safeParse({ url: 'not a url' }).success).toBe(false)
  })

  it('outputs an array of sources plus a truncated flag', () => {
    const parsed = output.parse({ sources: [], truncated: false })
    expect(parsed).toEqual({ sources: [], truncated: false })
  })

  it('rejects an output missing truncated', () => {
    expect(output.safeParse({ sources: [] }).success).toBe(false)
  })
})

describe('library.retrySource and library.deleteSource', () => {
  it.each(['library.retrySource', 'library.deleteSource'] as const)(
    '%s takes a source id',
    (channel) => {
      const { input } = contract[channel]
      expect(input.safeParse({ id: summary.id }).success).toBe(true)
      expect(input.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
    },
  )
})

describe('sourceDocSchema', () => {
  it('accepts a nested section tree', () => {
    const doc = {
      id: 'doc-1',
      kind: 'markdown' as const,
      title: 'Cells',
      language: 'en',
      sections: [
        {
          id: 's1',
          title: 'Cell Biology',
          level: 1,
          blocks: ['b1'],
          children: [{ id: 's2', title: 'Structure', level: 2, blocks: [], children: [] }],
        },
      ],
      blocks: [
        {
          id: 'b1',
          type: 'paragraph' as const,
          text: 'Cells are the basic units of life.',
          locator: { anchor: '0' },
          hash: 'a'.repeat(64),
        },
      ],
      assets: [],
      meta: { warnings: [] },
    }
    expect(sourceDocSchema.safeParse(doc).success).toBe(true)
  })
})
