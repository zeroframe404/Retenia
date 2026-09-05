import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import { SOURCE_KINDS, SOURCE_STATUSES, sourceDocSchema, sourceSummarySchema } from './library'

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

  it('rejects an unknown status', () => {
    expect(sourceSummarySchema.safeParse({ ...summary, status: 'archived' }).success).toBe(false)
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

describe('library.addSourceFromPaths', () => {
  const { input } = contract['library.addSourceFromPaths']

  it('takes one or more absolute paths', () => {
    expect(input.parse({ paths: ['/home/me/book.pdf'] })).toEqual({ paths: ['/home/me/book.pdf'] })
  })

  it('rejects an empty list', () => {
    expect(input.safeParse({ paths: [] }).success).toBe(false)
  })

  it('bounds the batch size', () => {
    const paths = Array.from({ length: 51 }, (_unused, i) => `/f${i}.pdf`)
    expect(input.safeParse({ paths }).success).toBe(false)
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
