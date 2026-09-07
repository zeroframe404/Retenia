import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRepositories, ftsQuery, type OpenedDatabase, searchChunksFts } from '@retenia/db'
import { openTestDatabase, testClock, testIds } from '@retenia/db/testing'
import { chunkSourceDoc, parsePdf } from '@retenia/ingest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChunkDraftsBlob } from '../../jobs/ingest-chunk'
import { persistChunkDrafts } from './chunk-store'

/**
 * The acceptance criterion of sub-phase 6.2, end to end and in one place: parse a real PDF,
 * chunk it, write the rows, and search. It lives here rather than in `@retenia/db` or
 * `@retenia/ingest` because it is the only layer that may import both — `packages/db` depends
 * on `core` alone by architectural rule, and the chunker has no database.
 */

const BOOK = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'ingest',
  'test',
  'fixtures',
  'pdf',
  'book-with-frontmatter.pdf',
)

describe('chunking a real source, end to end', () => {
  let opened: OpenedDatabase
  let repos: ReturnType<typeof createRepositories>
  let sourceId: string
  let drafts: ChunkDraftsBlob
  const clock = testClock()

  beforeEach(async () => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: 'test-device', clock, ids: testIds(clock) })
    const source = await repos.sources.create({
      kind: 'pdf',
      title: 'Memoria y repaso espaciado',
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: null,
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
      lastLocator: null,
      lastOpenedAt: null,
    })
    sourceId = source.id

    let id = 0
    const doc = await parsePdf(
      {
        bytes: new Uint8Array(await readFile(BOOK)),
        fallbackTitle: 'Memoria y repaso espaciado',
      },
      {
        id: () => {
          id += 1
          return `id-${id}`
        },
        putAsset: async () => ({
          id: 'a',
          blobSha256: '0'.repeat(64),
          mime: 'image/png',
          kind: 'image' as const,
        }),
      },
    )
    const result = chunkSourceDoc(doc, { sourceId })
    drafts = {
      sourceId,
      chunkingVersion: result.chunkingVersion,
      units: result.units,
      chunks: result.chunks,
    }
  })

  afterEach(() => opened.close())

  it('finds a phrase from the book and reports the page it is on', async () => {
    await persistChunkDrafts(repos, drafts)

    // A phrase that appears once, in chapter 1 (page 4 of the fixture).
    const hits = searchChunksFts(opened.sqlite, ftsQuery('"reconstrucción que depende"'))
    expect(hits).toHaveLength(1)

    const chunk = await repos.chunks.findById(hits[0]?.chunkId as string)
    expect(chunk?.locator).toMatchObject({ page: 4, label: 'p. 4' })
    expect(chunk?.headingPath).toBe('Memoria y repaso espaciado > Capítulo 1. Qué es la memoria')
    expect(hits[0]?.snippet).toContain('<b>reconstrucción que depende</b>')

    // The unit the chunk points at is the same page, so "open the source here" works.
    const unit = await repos.sources.findUnit(chunk?.unitId as string)
    expect(unit).toMatchObject({ kind: 'page', ordinal: 4, label: 'p. 4' })
  })

  it('flags the front matter without hiding it, so stage 4 can exclude it', async () => {
    const { chunks } = await persistChunkDrafts(repos, drafts)

    const frontMatter = chunks.filter((chunk) => chunk.isFrontmatter)
    expect(frontMatter.length).toBeGreaterThan(0)
    expect(frontMatter.some((chunk) => chunk.headingPath?.includes('Bibliografía'))).toBe(true)
    // Still indexed: a bibliography entry is worth retrieving, it is just not a lesson.
    // "Karpicke" appears only there — "Dunlosky" is also named in chapter 2's body.
    const hits = searchChunksFts(opened.sqlite, ftsQuery('Karpicke'))
    expect(hits).toHaveLength(1)
    expect(frontMatter.map((chunk) => chunk.id)).toContain(hits[0]?.chunkId)
  })

  it('re-chunking the same document changes nothing at all', async () => {
    const first = await persistChunkDrafts(repos, drafts)
    const second = await persistChunkDrafts(repos, drafts)

    expect(second.chunks.map((chunk) => chunk.id)).toEqual(first.chunks.map((chunk) => chunk.id))
    expect(second.units.map((unit) => unit.ordinal)).toEqual(
      first.units.map((unit) => unit.ordinal),
    )
    expect(await repos.chunks.listBySource(sourceId)).toHaveLength(first.chunks.length)
  })

  it('stamps every chunk with the version it was cut under, so the sweep can find it later', async () => {
    await persistChunkDrafts(repos, drafts)

    expect(await repos.chunks.sourceIdsNeedingRechunk(drafts.chunkingVersion)).toEqual([])
    expect(await repos.chunks.sourceIdsNeedingRechunk('2:cl100k')).toEqual([sourceId])
  })
})
