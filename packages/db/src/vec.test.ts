import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import {
  deleteEmbeddingsForChunk,
  EMBEDDING_DIMENSIONS,
  insertEmbedding,
  knnChunks,
  vectorToBlob,
} from './search'
import { seedSourceWithChunks } from './test-fixtures'
import { openTestDatabase, testClock, testIds } from './testing'

/** A unit-ish vector whose direction is set by `seed`, so distances are predictable. */
function vector(seed: number): Float32Array {
  const out = new Float32Array(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < out.length; i++) out[i] = Math.sin(i * seed)
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

    const inAForSource = knnChunks(opened.sqlite, vector(3), { k: 10, modelId: modelA, sourceId })
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
    expect(blob.readFloatLE(4)).toBeCloseTo(Math.sin(1), 6)
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
