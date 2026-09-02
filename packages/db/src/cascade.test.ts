import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import { chunks, sources, sourceUnits } from './schema'
import {
  EMBEDDING_DIMENSIONS,
  ftsQuery,
  insertEmbedding,
  knnChunks,
  searchChunksFts,
} from './search'
import { seedSourceWithChunks } from './test-fixtures'
import { audit, openTestDatabase, testClock, testIds } from './testing'

/**
 * The triggers of `0001_fts5_vec0_seed.sql` that keep derived data honest: FTS and vec0
 * entries disappear with their chunk, and a soft-deleted source takes its chunks and units
 * with it (and brings exactly them back when un-deleted).
 */

const MODEL = 'embeddinggemma-300m'

function vector(seed: number): Float32Array {
  const out = new Float32Array(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < out.length; i++) out[i] = Math.cos(i * seed)
  return out
}

describe('derived data follows soft deletes', () => {
  let opened: OpenedDatabase
  const clock = testClock()
  const ids = testIds(clock)
  let now: number
  let sourceId: string
  let chunkIds: string[]
  let unitId: string

  function liveVectorsFor(chunkId: string): number {
    return (
      opened.sqlite
        .prepare<[string], { n: number }>('SELECT count(*) AS n FROM embeddings WHERE chunk_id = ?')
        .get(chunkId)?.n ?? -1
    )
  }

  function knnIds(): string[] {
    return knnChunks(opened.sqlite, vector(1), { k: 10, modelId: MODEL }).map((h) => h.chunkId)
  }

  beforeEach(() => {
    opened = openTestDatabase()
    now = clock.nowMs()
    ;({ sourceId, chunkIds } = seedSourceWithChunks(opened, ids, now, [
      'El corazón bombea sangre.',
      'Las mitocondrias producen energía.',
    ]))
    for (const [index, chunkId] of chunkIds.entries()) {
      insertEmbedding(opened.sqlite, {
        id: ids.next(),
        sourceId,
        chunkId,
        modelId: MODEL,
        embedding: vector(1 + index),
      })
    }
    unitId = ids.next()
    opened.db
      .insert(sourceUnits)
      .values({ id: unitId, sourceId, kind: 'page', ordinal: 1, ...audit(now) })
      .run()
  })
  afterEach(() => opened.close())

  it('drops a soft-deleted chunk from FTS and from the vector index', () => {
    expect(knnIds()).toEqual(chunkIds)

    opened.db
      .update(chunks)
      .set({ deletedAt: now + 1 })
      .where(eq(chunks.id, chunkIds[0] as string))
      .run()

    expect(searchChunksFts(opened.sqlite, ftsQuery('corazón'))).toEqual([])
    expect(knnIds()).toEqual([chunkIds[1]])
    expect(liveVectorsFor(chunkIds[0] as string)).toBe(0)
    expect(liveVectorsFor(chunkIds[1] as string)).toBe(1)
  })

  it('brings an un-deleted chunk back to FTS but leaves re-embedding to the embedding job', () => {
    opened.db
      .update(chunks)
      .set({ deletedAt: now + 1 })
      .where(eq(chunks.id, chunkIds[0] as string))
      .run()
    opened.db
      .update(chunks)
      .set({ deletedAt: null })
      .where(eq(chunks.id, chunkIds[0] as string))
      .run()

    expect(searchChunksFts(opened.sqlite, ftsQuery('corazón')).map((h) => h.chunkId)).toEqual([
      chunkIds[0],
    ])
    expect(liveVectorsFor(chunkIds[0] as string)).toBe(0)
  })

  it('clears the vectors of a hard-deleted chunk too (the app never hard-deletes)', () => {
    opened.sqlite.prepare('DELETE FROM chunks WHERE id = ?').run(chunkIds[1])
    expect(liveVectorsFor(chunkIds[1] as string)).toBe(0)
    expect(knnIds()).toEqual([chunkIds[0]])
  })

  it('soft-deleting a source cascades to its units and chunks, bumping their version', () => {
    const deletedAt = now + 1_000
    opened.db
      .update(sources)
      .set({ deletedAt, updatedAt: deletedAt, version: 2 })
      .where(eq(sources.id, sourceId))
      .run()

    for (const chunkId of chunkIds) {
      const row = opened.db.query.chunks.findFirst({ where: eq(chunks.id, chunkId) }).sync()
      expect(row).toMatchObject({ deletedAt, updatedAt: deletedAt, version: 2 })
    }
    const unit = opened.db.query.sourceUnits.findFirst({ where: eq(sourceUnits.id, unitId) }).sync()
    expect(unit).toMatchObject({ deletedAt, updatedAt: deletedAt, version: 2 })

    expect(searchChunksFts(opened.sqlite, ftsQuery('sangre'))).toEqual([])
    expect(searchChunksFts(opened.sqlite, ftsQuery('mitocondrias'))).toEqual([])
    expect(knnIds()).toEqual([])
    expect(opened.sqlite.prepare('SELECT count(*) AS n FROM chunks').get()).toEqual({ n: 2 })
  })

  it('un-deleting the source restores exactly the rows the cascade removed', () => {
    // Chunk 1 was already gone before the source was deleted; it must stay gone.
    const earlier = now + 500
    opened.db
      .update(chunks)
      .set({ deletedAt: earlier })
      .where(eq(chunks.id, chunkIds[1] as string))
      .run()

    const deletedAt = now + 1_000
    opened.db
      .update(sources)
      .set({ deletedAt, updatedAt: deletedAt, version: 2 })
      .where(eq(sources.id, sourceId))
      .run()
    expect(
      opened.db.query.chunks.findFirst({ where: eq(chunks.id, chunkIds[1] as string) }).sync(),
    ).toMatchObject({ deletedAt: earlier, version: 1 })

    const restoredAt = now + 2_000
    opened.db
      .update(sources)
      .set({ deletedAt: null, updatedAt: restoredAt, version: 3 })
      .where(eq(sources.id, sourceId))
      .run()

    expect(
      opened.db.query.chunks.findFirst({ where: eq(chunks.id, chunkIds[0] as string) }).sync(),
    ).toMatchObject({ deletedAt: null, updatedAt: restoredAt, version: 3 })
    expect(
      opened.db.query.chunks.findFirst({ where: eq(chunks.id, chunkIds[1] as string) }).sync(),
    ).toMatchObject({ deletedAt: earlier, version: 1 })
    expect(
      opened.db.query.sourceUnits.findFirst({ where: eq(sourceUnits.id, unitId) }).sync(),
    ).toMatchObject({ deletedAt: null, version: 3 })

    expect(searchChunksFts(opened.sqlite, ftsQuery('sangre')).map((h) => h.chunkId)).toEqual([
      chunkIds[0],
    ])
    expect(searchChunksFts(opened.sqlite, ftsQuery('mitocondrias'))).toEqual([])
  })

  it("never lowers a cascaded row's updated_at below its own timestamps", () => {
    // A source whose updated_at is stale (older than its chunks) is soft-deleted without
    // bumping updated_at: the chunks keep their own, so `updated_at >= created_at` holds.
    const stale = now - 60_000
    opened.db
      .update(sources)
      .set({ updatedAt: now, version: 2 })
      .where(eq(sources.id, sourceId))
      .run()
    opened.db
      .update(sources)
      .set({ createdAt: stale, updatedAt: stale, deletedAt: now + 1 })
      .where(eq(sources.id, sourceId))
      .run()

    for (const chunkId of chunkIds) {
      const row = opened.db.query.chunks.findFirst({ where: eq(chunks.id, chunkId) }).sync()
      expect(row).toMatchObject({ deletedAt: now + 1, updatedAt: now, createdAt: now, version: 2 })
    }
  })
})
