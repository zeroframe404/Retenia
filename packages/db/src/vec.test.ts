import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import { chunks, sources } from './schema'
import {
  deleteEmbeddingsForChunk,
  EMBEDDING_DIMENSIONS,
  insertEmbedding,
  knnChunks,
  quantizeToInt8,
  vectorToBlob,
} from './search'
import { seedSourceWithChunks } from './test-fixtures'
import { openTestDatabase, testClock, testIds } from './testing'

/** A unit vector whose direction is set by `seed`, so distances are predictable — and
 *  whose components are in [-1, 1], which is what the int8 index assumes. */
function vector(seed: number): Float32Array {
  const out = new Float32Array(EMBEDDING_DIMENSIONS)
  let norm = 0
  for (let i = 0; i < out.length; i++) {
    const value = Math.sin(i * seed)
    out[i] = value
    norm += value * value
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / norm
  return out
}

describe('embeddings (sqlite-vec vec0, float[768])', () => {
  let opened: OpenedDatabase
  const clock = testClock()
  const ids = testIds(clock)
  let sourceId: string
  let chunkIds: string[]

  beforeEach(() => {
    opened = openTestDatabase()
    ;({ sourceId, chunkIds } = seedSourceWithChunks(opened, ids, clock.nowMs(), ['a', 'b', 'c']))
  })
  afterEach(() => opened.close())

  it('loads the extension and declares the table with the required shape', () => {
    expect(opened.vecLoaded).toBe(true)
    expect(opened.sqlite.prepare<[], { v: string }>('SELECT vec_version() AS v').get()?.v).toMatch(
      /^v0\.1\./,
    )
    const ddl = opened.sqlite
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'embeddings'")
      .get()?.sql
    expect(ddl).toContain('USING vec0')
    expect(ddl).toContain('source_id TEXT PARTITION KEY')
    expect(ddl).toContain('embedding FLOAT[768]')
  })

  it('accepts 768-dimensional vectors and returns nearest neighbours first', () => {
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[0] as string,
      modelId: 'embeddinggemma-300m',
      embedding: vector(1),
    })
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[1] as string,
      modelId: 'embeddinggemma-300m',
      embedding: vector(1.01),
    })
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[2] as string,
      modelId: 'embeddinggemma-300m',
      embedding: vector(2),
    })

    const hits = knnChunks(opened.sqlite, vector(1), { k: 3, modelId: 'embeddinggemma-300m' })
    expect(hits.map((h) => h.chunkId)).toEqual([chunkIds[0], chunkIds[1], chunkIds[2]])
    expect(hits[0]?.distance).toBe(0)
    expect(hits[1]?.distance).toBeLessThan(hits[2]?.distance as number)
    expect(hits[0]?.sourceId).toBe(sourceId)

    expect(
      knnChunks(opened.sqlite, vector(1), { k: 2, modelId: 'embeddinggemma-300m' }),
    ).toHaveLength(2)
  })

  it('scopes the search by partition (source) and by model space', () => {
    const other = seedSourceWithChunks(opened, ids, clock.nowMs(), ['x'])
    const modelA = 'model-a'
    const modelB = 'model-b'

    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[0] as string,
      modelId: modelA,
      embedding: vector(3),
    })
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId: other.sourceId,
      chunkId: other.chunkIds[0] as string,
      modelId: modelA,
      embedding: vector(3),
    })
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[1] as string,
      modelId: modelB,
      embedding: vector(3),
    })

    const inA = knnChunks(opened.sqlite, vector(3), { k: 10, modelId: modelA })
    expect(inA.map((h) => h.chunkId).sort()).toEqual([chunkIds[0], other.chunkIds[0]].sort())

    const inAForSource = knnChunks(opened.sqlite, vector(3), {
      k: 10,
      modelId: modelA,
      sourceIds: [sourceId],
    })
    expect(inAForSource.map((h) => h.chunkId)).toEqual([chunkIds[0]])

    const inB = knnChunks(opened.sqlite, vector(3), { k: 10, modelId: modelB })
    expect(inB.map((h) => h.chunkId)).toEqual([chunkIds[1]])
  })

  it('rejects vectors of the wrong width, in code and in the database', () => {
    expect(() => vectorToBlob(new Float32Array(10))).toThrow(RangeError)
    expect(() =>
      opened.sqlite
        .prepare(
          'INSERT INTO embeddings (id, source_id, chunk_id, model_id, embedding) VALUES (?, ?, ?, ?, ?)',
        )
        .run(ids.next(), sourceId, chunkIds[0], 'm', Buffer.from(new Float32Array(10).buffer)),
    ).toThrow(/dimension/i)
  })

  it('packs vectors as little-endian float32 blobs', () => {
    const blob = vectorToBlob(vector(1))
    expect(blob.byteLength).toBe(EMBEDDING_DIMENSIONS * 4)
    expect(blob.readFloatLE(4)).toBeCloseTo(vector(1)[1] as number, 6)
    expect(vectorToBlob(Array.from(vector(1))).equals(blob)).toBe(true)
  })

  it("deletes a chunk's vectors across models (derived data, rebuilt by the embedding job)", () => {
    for (const modelId of ['m1', 'm2']) {
      insertEmbedding(opened.sqlite, {
        id: ids.next(),
        sourceId,
        chunkId: chunkIds[0] as string,
        modelId,
        embedding: vector(1),
      })
    }
    expect(deleteEmbeddingsForChunk(opened.sqlite, chunkIds[0] as string)).toBe(2)
    expect(knnChunks(opened.sqlite, vector(1), { modelId: 'm1' })).toEqual([])
    expect(deleteEmbeddingsForChunk(opened.sqlite, chunkIds[0] as string)).toBe(0)
  })

  it('enforces the primary key', () => {
    const id = ids.next()
    const row = { id, sourceId, chunkId: chunkIds[0] as string, modelId: 'm', embedding: vector(1) }
    insertEmbedding(opened.sqlite, row)
    expect(() => insertEmbedding(opened.sqlite, row)).toThrow()
  })
})

describe('embeddings_i8 (int8 quantization and exact rescoring)', () => {
  let opened: OpenedDatabase
  const clock = testClock()
  const ids = testIds(clock)
  let sourceId: string
  let chunkIds: string[]

  beforeEach(() => {
    opened = openTestDatabase()
    ;({ sourceId, chunkIds } = seedSourceWithChunks(opened, ids, clock.nowMs(), ['a', 'b', 'c']))
  })
  afterEach(() => opened.close())

  function seedThree(modelId = 'embeddinggemma-300m'): void {
    for (const [index, seed] of [1, 1.01, 2].entries()) {
      insertEmbedding(opened.sqlite, {
        id: ids.next(),
        sourceId,
        chunkId: chunkIds[index] as string,
        modelId,
        embedding: vector(seed),
      })
    }
  }

  it('declares the quantized table beside the exact one', () => {
    const ddl = opened.sqlite
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'embeddings_i8'")
      .get()?.sql
    expect(ddl).toContain('USING vec0')
    expect(ddl).toContain('source_id TEXT PARTITION KEY')
    expect(ddl).toContain('embedding INT8[768]')
  })

  it('writes both indexes from one insert, keyed by the same id', () => {
    seedThree()
    const rows = opened.sqlite
      .prepare<[], { id: string }>(
        'SELECT e.id AS id FROM embeddings e JOIN embeddings_i8 q ON q.id = e.id',
      )
      .all()
    expect(rows).toHaveLength(3)
  })

  it('scales a unit vector across the int8 range and clamps what falls outside it', () => {
    const blob = quantizeToInt8(new Float32Array(EMBEDDING_DIMENSIONS).fill(1))
    expect(blob.byteLength).toBe(EMBEDDING_DIMENSIONS)
    expect(blob.readInt8(0)).toBe(127)

    const negative = quantizeToInt8(new Float32Array(EMBEDDING_DIMENSIONS).fill(-1))
    expect(negative.readInt8(0)).toBe(-127)

    // Out of range is clamped, never rejected: one odd component must not fail an ingestion.
    const clamped = quantizeToInt8(new Float32Array(EMBEDDING_DIMENSIONS).fill(5))
    expect(clamped.readInt8(0)).toBe(127)
    expect(() => quantizeToInt8(new Float32Array(10))).toThrow(RangeError)
  })

  it('returns exact float distances even though the scan is quantized', () => {
    seedThree()
    const quantized = knnChunks(opened.sqlite, vector(1), { k: 3, modelId: 'embeddinggemma-300m' })
    const exact = knnChunks(opened.sqlite, vector(1), {
      k: 3,
      modelId: 'embeddinggemma-300m',
      precision: 'float32',
    })

    expect(quantized.map((hit) => hit.chunkId)).toEqual(exact.map((hit) => hit.chunkId))
    for (const [index, hit] of quantized.entries()) {
      // Rescoring means the number reported is the float32 one, not a quantized approximation.
      expect(hit.distance).toBeCloseTo(exact[index]?.distance as number, 6)
    }
  })

  it('honours the same partition and model filters as the exact index', () => {
    const other = seedSourceWithChunks(opened, ids, clock.nowMs(), ['x'])
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[0] as string,
      modelId: 'model-a',
      embedding: vector(3),
    })
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId: other.sourceId,
      chunkId: other.chunkIds[0] as string,
      modelId: 'model-a',
      embedding: vector(3),
    })
    insertEmbedding(opened.sqlite, {
      id: ids.next(),
      sourceId,
      chunkId: chunkIds[1] as string,
      modelId: 'model-b',
      embedding: vector(3),
    })

    expect(
      knnChunks(opened.sqlite, vector(3), {
        k: 10,
        modelId: 'model-a',
        sourceIds: [sourceId],
      }).map((hit) => hit.chunkId),
    ).toEqual([chunkIds[0]])
    expect(
      knnChunks(opened.sqlite, vector(3), { k: 10, modelId: 'model-b' }).map((hit) => hit.chunkId),
    ).toEqual([chunkIds[1]])
    // An empty filter is "no source", not "every source".
    expect(
      knnChunks(opened.sqlite, vector(3), { k: 10, modelId: 'model-a', sourceIds: [] }),
    ).toEqual([])
  })

  it('drops the quantized vectors too when a chunk is soft-deleted or its vectors removed', () => {
    seedThree()
    const countI8 = () =>
      (
        opened.sqlite
          .prepare<[], { n: number }>('SELECT count(*) AS n FROM embeddings_i8')
          .get() as { n: number }
      ).n

    expect(countI8()).toBe(3)
    expect(deleteEmbeddingsForChunk(opened.sqlite, chunkIds[0] as string)).toBe(1)
    expect(countI8()).toBe(2)

    opened.db
      .update(chunks)
      .set({ deletedAt: clock.nowMs() })
      .where(eq(chunks.id, chunkIds[1] as string))
      .run()
    expect(countI8()).toBe(1)
    expect(
      knnChunks(opened.sqlite, vector(1.01), { k: 10, modelId: 'embeddinggemma-300m' }).map(
        (hit) => hit.chunkId,
      ),
    ).toEqual([chunkIds[2]])
  })

  it('follows the source soft-delete cascade into the quantized index too', () => {
    seedThree()
    opened.db
      .update(sources)
      .set({ deletedAt: clock.nowMs(), updatedAt: clock.nowMs() })
      .where(eq(sources.id, sourceId))
      .run()

    const remaining = opened.sqlite
      .prepare<[], { n: number }>('SELECT count(*) AS n FROM embeddings_i8')
      .get() as { n: number }
    expect(remaining.n).toBe(0)
    expect(knnChunks(opened.sqlite, vector(1), { k: 10, modelId: 'embeddinggemma-300m' })).toEqual(
      [],
    )
  })

  it('ignores a quantized row whose exact vector is missing (indexes mid-write)', () => {
    seedThree()
    opened.sqlite.prepare('DELETE FROM embeddings WHERE chunk_id = ?').run(chunkIds[0])
    const hits = knnChunks(opened.sqlite, vector(1), { k: 3, modelId: 'embeddinggemma-300m' })
    expect(hits.map((hit) => hit.chunkId)).toEqual([chunkIds[1], chunkIds[2]])
  })

  it('never rescores fewer candidates than the neighbours asked for', () => {
    seedThree()
    // A rescore depth below k would silently cap the result; it is raised to k instead.
    expect(
      knnChunks(opened.sqlite, vector(1), {
        k: 3,
        modelId: 'embeddinggemma-300m',
        rescoreCandidates: 1,
      }),
    ).toHaveLength(3)
    expect(knnChunks(opened.sqlite, vector(1), { k: 0, modelId: 'embeddinggemma-300m' })).toEqual(
      [],
    )
  })
})
