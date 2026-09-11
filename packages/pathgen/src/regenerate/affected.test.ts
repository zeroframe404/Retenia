import { describe, expect, it } from 'vitest'
import type { GenerationManifest } from '../schemas/manifest'
import { type AffectedCandidate, affectedLessons, changedSources } from './affected'

function manifest(
  hashes: readonly {
    source_id: string
    blob_sha256: string | null
    chunk_set_hash: string
  }[],
): Pick<GenerationManifest, 'source_hashes'> {
  return {
    source_hashes: hashes.map((h) => ({
      ...h,
      chunk_count: 1,
      chunking_version: null,
    })),
  }
}

describe('changedSources()', () => {
  it('flags blob_changed when the recorded blob sha256 differs from the current one', () => {
    const result = changedSources(
      manifest([{ source_id: 'src1', blob_sha256: 'aaa', chunk_set_hash: 'x'.repeat(64) }]),
      new Map([['src1', { blobSha256: 'bbb', chunkSetHash: 'x'.repeat(64) }]]),
    )
    expect(result).toEqual([{ sourceId: 'src1', reason: 'blob_changed' }])
  })

  it('flags chunks_changed when the recorded blob is null and the chunk set hash differs', () => {
    const result = changedSources(
      manifest([{ source_id: 'src1', blob_sha256: null, chunk_set_hash: 'a'.repeat(64) }]),
      new Map([['src1', { blobSha256: null, chunkSetHash: 'b'.repeat(64) }]]),
    )
    expect(result).toEqual([{ sourceId: 'src1', reason: 'chunks_changed' }])
  })

  it('reports nothing when the current source matches the recorded hashes', () => {
    const result = changedSources(
      manifest([{ source_id: 'src1', blob_sha256: 'aaa', chunk_set_hash: 'x'.repeat(64) }]),
      new Map([['src1', { blobSha256: 'aaa', chunkSetHash: 'x'.repeat(64) }]]),
    )
    expect(result).toEqual([])
  })

  it('flags missing when the source is no longer in the current map', () => {
    const result = changedSources(
      manifest([{ source_id: 'src1', blob_sha256: 'aaa', chunk_set_hash: 'x'.repeat(64) }]),
      new Map(),
    )
    expect(result).toEqual([{ sourceId: 'src1', reason: 'missing' }])
  })
})

describe('affectedLessons()', () => {
  function candidate(overrides: Partial<AffectedCandidate>): AffectedCandidate {
    return { lessonId: 'lid', specId: 'L1', title: 'Lesson', refs: [], ...overrides }
  }

  it('affects a lesson only when a ref belongs to a changed source and its chunk is no longer live', () => {
    const lessons = [
      candidate({
        lessonId: 'a',
        refs: [{ chunkId: 'chunk-dead', sourceId: 'src1' }],
      }),
    ]
    const result = affectedLessons(lessons, new Set(['src1']), new Set())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ lessonId: 'a', sourceIds: ['src1'], missingFragments: 1 })
  })

  it('leaves a lesson alone when it only cites still-live chunks of a changed source', () => {
    const lessons = [
      candidate({
        lessonId: 'a',
        refs: [{ chunkId: 'chunk-live', sourceId: 'src1' }],
      }),
    ]
    const result = affectedLessons(lessons, new Set(['src1']), new Set(['chunk-live']))
    expect(result).toEqual([])
  })

  it('leaves a lesson alone when its refs are not from a changed source', () => {
    const lessons = [
      candidate({
        lessonId: 'a',
        refs: [{ chunkId: 'chunk-dead', sourceId: 'src-unchanged' }],
      }),
    ]
    const result = affectedLessons(lessons, new Set(['src1']), new Set())
    expect(result).toEqual([])
  })

  it('counts missingFragments as the number of distinct dead chunks, and sourceIds sorted and unique', () => {
    const lessons = [
      candidate({
        lessonId: 'a',
        refs: [
          { chunkId: 'c1', sourceId: 'srcB' },
          { chunkId: 'c1', sourceId: 'srcB' }, // repeated ref, same chunk
          { chunkId: 'c2', sourceId: 'srcA' },
          { chunkId: 'c3', sourceId: 'srcA' },
        ],
      }),
    ]
    const result = affectedLessons(lessons, new Set(['srcA', 'srcB']), new Set())
    expect(result).toHaveLength(1)
    expect(result[0]?.sourceIds).toEqual(['srcA', 'srcB'])
    expect(result[0]?.missingFragments).toBe(3)
  })
})
