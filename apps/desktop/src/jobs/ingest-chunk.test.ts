import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobContext } from '@retenia/core'
import type { SourceDoc } from '@retenia/ingest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFsBlobStore } from '../main/blobs/store'
import type { ChunkDraftsBlob } from './ingest-chunk'
import { createIngestChunkJob } from './ingest-chunk'

// Same reason as `ingest-parse.test.ts`: the job imports `@retenia/ingest` lazily, and its
// first load on a cold machine is not what the per-test budget is meant to measure.
beforeAll(async () => {
  await import('@retenia/ingest')
})

function context(): JobContext & { stages: Array<[number, string | undefined]> } {
  const stages: Array<[number, string | undefined]> = []
  return {
    jobId: 'test-job',
    progress: (value, message) => stages.push([value, message]),
    signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    stages,
  }
}

function doc(): SourceDoc {
  const paragraph = (stem: string, tokens: number) => {
    let text = ''
    for (let index = 0; text.length < tokens * 4; index += 1) {
      text += `${text.length === 0 ? '' : ' '}${stem}${index}`
    }
    return text.slice(0, tokens * 4)
  }
  return {
    id: 'doc-1',
    kind: 'markdown',
    title: 'Memoria',
    language: 'es',
    sections: [
      { id: 's1', title: 'Índice', level: 1, blocks: ['b1'], children: [] },
      { id: 's2', title: 'Capítulo 1', level: 1, blocks: ['b2'], children: [] },
    ],
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: 'Capítulo 1 ..... 1\nCapítulo 2 ..... 9\nCapítulo 3 ..... 21\nÍndice ..... 33',
        locator: {},
        hash: 'a'.repeat(64),
      },
      {
        id: 'b2',
        type: 'paragraph',
        text: paragraph('memoria', 300),
        locator: {},
        hash: 'b'.repeat(64),
      },
    ],
    assets: [],
    meta: { warnings: [] },
  }
}

describe('ingestChunkSource', () => {
  let dir: string

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'retenia-chunk-')))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a payload missing or malforming any field', () => {
    const job = createIngestChunkJob([dir])
    expect(() => job.parseInput({})).toThrow(/non-empty string "sourceId"/)
    expect(() => job.parseInput({ sourceId: 's1', sourceDocBlobSha256: 'short' })).toThrow(
      /64-character hex "sourceDocBlobSha256"/,
    )
    expect(() =>
      job.parseInput({ sourceId: 's1', sourceDocBlobSha256: 'a'.repeat(64), tokenizer: 'gpt2' }),
    ).toThrow(/known "tokenizer"/)
    expect(job.parseInput({ sourceId: 's1', sourceDocBlobSha256: 'a'.repeat(64) })).toEqual({
      sourceId: 's1',
      sourceDocBlobSha256: 'a'.repeat(64),
    })
  })

  it('chunks the stored SourceDoc and writes the drafts to a blob', async () => {
    const blobStore = createFsBlobStore(dir)
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(doc())),
      'application/json',
    )

    const ctx = context()
    const result = await createIngestChunkJob([dir]).run(
      { sourceId: 'src-1', sourceDocBlobSha256: sha256 },
      ctx,
    )

    expect(result.chunkingVersion).toBe('1:chars4')
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(result.unitCount).toBeGreaterThan(0)
    expect(result.frontmatterCount).toBe(1)
    expect(result.tokenCount).toBeGreaterThan(0)

    const drafts = JSON.parse(
      new TextDecoder().decode(await blobStore.get(result.chunkDraftsBlobSha256, 'json')),
    ) as ChunkDraftsBlob
    expect(drafts.sourceId).toBe('src-1')
    expect(drafts.chunks).toHaveLength(result.chunkCount)
    expect(drafts.chunks.some((chunk) => chunk.isFrontmatter)).toBe(true)
    expect(ctx.stages.at(-1)).toEqual([1, 'done'])
  })

  it('is deterministic: the same document twice writes the same blob', async () => {
    const blobStore = createFsBlobStore(dir)
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(doc())),
      'application/json',
    )
    const job = createIngestChunkJob([dir])
    const input = { sourceId: 'src-1', sourceDocBlobSha256: sha256 }

    const first = await job.run(input, context())
    const second = await job.run(input, context())
    expect(second.chunkDraftsBlobSha256).toBe(first.chunkDraftsBlobSha256)
  })

  it('records the tokenizer it measured with in the version it reports', async () => {
    const blobStore = createFsBlobStore(dir)
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(doc())),
      'application/json',
    )

    const result = await createIngestChunkJob([dir]).run(
      { sourceId: 'src-1', sourceDocBlobSha256: sha256, tokenizer: 'cl100k' },
      context(),
    )
    expect(result.chunkingVersion).toBe('1:cl100k')
  })

  it('refuses to read outside the roots it was given', async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'retenia-elsewhere-')))
    try {
      const blobStore = createFsBlobStore(other)
      const { sha256 } = await blobStore.put(
        new TextEncoder().encode(JSON.stringify(doc())),
        'application/json',
      )
      // The job builds its path from `dir`, so the blob simply is not there — and even a
      // crafted sha could not point it at `other`, which is what `confinePath` guarantees.
      await expect(
        createIngestChunkJob([dir]).run(
          { sourceId: 'src-1', sourceDocBlobSha256: sha256 },
          context(),
        ),
      ).rejects.toThrow()
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})
