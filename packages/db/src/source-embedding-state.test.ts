import { createHash } from 'node:crypto'
import type { Chunk, NewEntity, Source } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import { createRepositories } from './repositories'
import { deleteEmbeddingsForSource, insertEmbedding, knnChunks } from './search'
import { openTestDatabase, testClock, testIds } from './testing'

/**
 * Where a source stands in the vector index, and the reindex sweep that reads it
 * (migration 0009; `docs/spec/05-ingestion-rag.md` §3: "store the `model_id` per embedding
 * and never mix spaces; reindex as a job").
 */

const GEMMA = 'embeddinggemma-300m@768'
const BGE = 'bge-m3@768'

function unitVector(seed: number): Float32Array {
  const out = new Float32Array(768)
  let norm = 0
  for (let i = 0; i < out.length; i++) {
    const value = Math.sin(i * seed + 1)
    out[i] = value
    norm += value * value
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / norm
  return out
}

function draft(sourceId: string, text: string, ordinal: number): NewEntity<Chunk> {
  return {
    sourceId,
    unitId: null,
    ordinal,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenCount: Math.ceil(text.length / 4),
    hash: createHash('sha256').update(`${sourceId}:${text}`).digest('hex'),
    headingPath: 'Libro > Capítulo 1',
    context: null,
    chunkKey: createHash('sha256').update(`key:${sourceId}:${text}`).digest('hex'),
    chunkingVersion: '1:chars4',
    isFrontmatter: false,
    locator: null,
  }
}

describe('source embedding state (sub-phase 6.3)', () => {
  let opened: OpenedDatabase
  let repos: ReturnType<typeof createRepositories>
  const clock = testClock()

  const newSource = (title: string): Promise<Source> =>
    repos.sources.create({
      kind: 'pdf',
      title,
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

  /** A source with two chunks, which is what makes it a candidate for the sweep at all. */
  const chunkedSource = async (title: string): Promise<Source> => {
    const source = await newSource(title)
    await repos.chunks.createMany([
      draft(source.id, 'El corazón bombea sangre.', 0),
      draft(source.id, 'Las mitocondrias producen energía.', 1),
    ])
    return source
  }

  beforeEach(() => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: 'device-test', clock, ids: testIds(clock) })
  })
  afterEach(() => opened.close())

  it('starts every source pending, in no space, with no error', async () => {
    const source = await newSource('Libro')
    expect(source.embeddingStatus).toBe('pending')
    expect(source.embeddingModelId).toBeNull()
    expect(source.embeddingError).toBeNull()
  })

  it('records the space a successful run put it in', async () => {
    const source = await chunkedSource('Libro')
    const updated = await repos.sources.setEmbeddingState(source.id, {
      status: 'ready',
      modelId: GEMMA,
    })
    expect(updated.embeddingStatus).toBe('ready')
    expect(updated.embeddingModelId).toBe(GEMMA)
  })

  it('clears the failure reason on any transition out of failed', async () => {
    const source = await chunkedSource('Libro')
    const failed = await repos.sources.setEmbeddingState(source.id, {
      status: 'failed',
      error: 'the model could not be downloaded',
    })
    expect(failed.embeddingError).toBe('the model could not be downloaded')

    const retried = await repos.sources.setEmbeddingState(source.id, { status: 'running' })
    expect(retried.embeddingError).toBeNull()
    // A retry does not claim the source is in a space it never reached.
    expect(retried.embeddingModelId).toBeNull()
  })

  it('refuses a status the enum does not have, at the database', async () => {
    const source = await newSource('Libro')
    await expect(
      // A caller reaching past the types — or an older build writing into a newer schema.
      repos.sources.setEmbeddingState(source.id, {
        status: 'embedding' as unknown as 'ready',
      }),
    ).rejects.toThrow(/CHECK constraint failed: sources_embedding_status/)
  })

  describe('the reindex sweep', () => {
    it('finds a source that has never been embedded', async () => {
      const source = await chunkedSource('Libro')
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([source.id])
    })

    it('leaves a source that is ready in the active space alone', async () => {
      const source = await chunkedSource('Libro')
      await repos.sources.setEmbeddingState(source.id, { status: 'ready', modelId: GEMMA })
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([])
    })

    it('finds a source embedded under a different model — the model-switch case', async () => {
      const source = await chunkedSource('Libro')
      await repos.sources.setEmbeddingState(source.id, { status: 'ready', modelId: BGE })
      // This is the whole reason the column exists: two spaces must never answer one query.
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([source.id])
      // And switching back finds nothing to do, because nothing was ever forgotten.
      expect(await repos.sources.sourceIdsNeedingEmbedding(BGE)).toEqual([])
    })

    it('finds a source whose last run failed', async () => {
      const source = await chunkedSource('Libro')
      await repos.sources.setEmbeddingState(source.id, { status: 'failed', error: 'out of memory' })
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([source.id])
    })

    it('finds a source left `running` by a crash, rather than waiting forever', async () => {
      const source = await chunkedSource('Libro')
      await repos.sources.setEmbeddingState(source.id, { status: 'running' })
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([source.id])
    })

    it('ignores a source with no chunks — there is nothing to embed', async () => {
      // Otherwise every source that has not been parsed yet would be re-queued on every start.
      await newSource('Sin trocear')
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([])
    })

    it('ignores a soft-deleted source, and one whose chunks are all soft-deleted', async () => {
      const deleted = await chunkedSource('Borrado')
      await repos.sources.softDelete(deleted.id)

      const emptied = await chunkedSource('Vaciado')
      await repos.chunks.replaceBySource(emptied.id, [])

      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([])
    })

    it('returns sources oldest first, so a big library reindexes in a predictable order', async () => {
      const first = await chunkedSource('Primero')
      const second = await chunkedSource('Segundo')
      expect(await repos.sources.sourceIdsNeedingEmbedding(GEMMA)).toEqual([first.id, second.id])
    })
  })

  describe('dropping a source’s vectors', () => {
    it('removes every vector of that source and leaves the others', async () => {
      const kept = await chunkedSource('Conservado')
      const dropped = await chunkedSource('Reindexado')
      const ids = testIds(clock)

      for (const source of [kept, dropped]) {
        const chunks = await repos.chunks.listBySource(source.id)
        for (const [index, chunk] of chunks.entries()) {
          insertEmbedding(
            opened.sqlite,
            {
              id: ids.next(),
              sourceId: source.id,
              chunkId: chunk.id,
              modelId: GEMMA,
              embedding: unitVector(1 + index),
            },
            { storeFloat: true },
          )
        }
      }

      expect(deleteEmbeddingsForSource(opened.sqlite, dropped.id)).toBe(2)
      const remaining = knnChunks(opened.sqlite, unitVector(1), { k: 10, modelId: GEMMA })
      expect(remaining.every((hit) => hit.sourceId === kept.id)).toBe(true)
      expect(remaining).toHaveLength(2)

      // Both indexes, not just the one the scan reads.
      const floats = opened.sqlite
        .prepare<[string], { n: number }>(
          'SELECT count(*) AS n FROM embeddings WHERE source_id = ?',
        )
        .get(dropped.id) as { n: number }
      expect(floats.n).toBe(0)
    })

    it('is safe to call for a source that has no vectors at all', async () => {
      const source = await chunkedSource('Sin vectores')
      expect(deleteEmbeddingsForSource(opened.sqlite, source.id)).toBe(0)
    })
  })
})
