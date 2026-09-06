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

  function seedThree(modelId = 'embeddinggemma-300m', storeFloat = false): void {
    for (const [index, seed] of [1, 1.01, 2].entries()) {
      insertEmbedding(
        opened.sqlite,
        {
          id: ids.next(),
          sourceId,
          chunkId: chunkIds[index] as string,
          modelId,
          embedding: vector(seed),
        },
        { storeFloat },
      )
    }
  }

  const count = (table: 'embeddings' | 'embeddings_i8'): number =>
    (
      opened.sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get() as {
        n: number
      }
    ).n

  it('declares the quantized table beside the exact one', () => {
    const ddl = opened.sqlite
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'embeddings_i8'")
      .get()?.sql
    expect(ddl).toContain('USING vec0')
    expect(ddl).toContain('source_id TEXT PARTITION KEY')
    expect(ddl).toContain('embedding INT8[768]')
  })

  it('writes only the quantized index by default — the float vectors are opt-in', () => {
    // The "precise" setting of sub-phase 6.3. Off, a 50k-chunk library is 37 MB of int8
    // instead of 184 MB of float32, and the int8 table is what a KNN query scans anyway.
    seedThree()
    expect(count('embeddings_i8')).toBe(3)
    expect(count('embeddings')).toBe(0)
  })

  it('writes both indexes, keyed by the same id, when precise vectors are on', () => {
    seedThree('embeddinggemma-300m', true)
    const rows = opened.sqlite
      .prepare<[], { id: string }>(
        'SELECT e.id AS id FROM embeddings e JOIN embeddings_i8 q ON q.id = e.id',
      )
      .all()
    expect(rows).toHaveLength(3)
  })

  it('round-trips a unit vector to within a bounded error', () => {
    // The quantization round-trip bound the index depends on. Two numbers, both measured:
    // how far one component moves, and how far the *distance* between two vectors moves —
    // the second is what a KNN query actually ranks by, and it is far tighter because 768
    // independent round-offs average out.
    const dequantize = (blob: Buffer): Float32Array =>
      Float32Array.from({ length: EMBEDDING_DIMENSIONS }, (_unused, i) => blob.readInt8(i) / 127)

    const l2 = (left: Float32Array, right: Float32Array): number => {
      let sum = 0
      for (let i = 0; i < left.length; i++) sum += ((left[i] as number) - (right[i] as number)) ** 2
      return Math.sqrt(sum)
    }

    let worstComponent = 0
    for (const seed of [1, 1.01, 2, 3.7]) {
      const original = vector(seed)
      const restored = dequantize(quantizeToInt8(original))
      for (let i = 0; i < original.length; i++) {
        worstComponent = Math.max(
          worstComponent,
          Math.abs((original[i] as number) - (restored[i] as number)),
        )
      }
    }
    // Half a quantization step: the most `round(x · 127) / 127` can ever move a value.
    expect(worstComponent).toBeLessThanOrEqual(0.5 / 127 + 1e-6)

    for (const [a, b] of [
      [1, 1.01],
      [1, 2],
      [2, 3.7],
    ] as const) {
      const exact = l2(vector(a), vector(b))
      const quantized = l2(
        dequantize(quantizeToInt8(vector(a))),
        dequantize(quantizeToInt8(vector(b))),
      )
      expect(Math.abs(exact - quantized)).toBeLessThan(0.03)
    }
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
    seedThree('embeddinggemma-300m', true)
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

  it('keeps a candidate with no exact vector, on its rescaled quantized distance', () => {
    // With precise vectors off there is nothing to rescore against for *any* row, so
    // dropping such candidates — which is what an earlier version did, reading a missing
    // float row as "the indexes are mid-write" — would empty the vector branch entirely.
    seedThree('embeddinggemma-300m', true)
    opened.sqlite.prepare('DELETE FROM embeddings WHERE chunk_id = ?').run(chunkIds[0])

    const hits = knnChunks(opened.sqlite, vector(1), { k: 3, modelId: 'embeddinggemma-300m' })
    expect(hits.map((hit) => hit.chunkId)).toEqual([chunkIds[0], chunkIds[1], chunkIds[2]])
    // And the fallback distance is on the same scale as the exact ones beside it — the whole
    // point of `INT8_DISTANCE_SCALE`, since one result set can legitimately mix the two.
    expect(hits[0]?.distance).toBeCloseTo(0, 2)
    expect(hits[0]?.distance).toBeLessThan(hits[1]?.distance as number)
  })

  it('ranks the same way with and without the exact vectors to rescore against', () => {
    // The trade the "precise" setting offers is recall at the margin, not a different
    // ordering of clearly-separated neighbours.
    seedThree('embeddinggemma-300m', true)
    const withFloats = knnChunks(opened.sqlite, vector(1), { k: 3, modelId: 'embeddinggemma-300m' })
    opened.sqlite.prepare('DELETE FROM embeddings').run()
    const withoutFloats = knnChunks(opened.sqlite, vector(1), {
      k: 3,
      modelId: 'embeddinggemma-300m',
    })

    expect(withoutFloats.map((hit) => hit.chunkId)).toEqual(withFloats.map((hit) => hit.chunkId))
    for (const [index, hit] of withoutFloats.entries()) {
      // Within quantization error of the exact distance, not merely in the same order. The
      // bound is relative and it is 2 %, not 0.1 %, for the reason `quantizeToInt8` now
      // spells out: a unit vector in 768 dimensions has components near ±1/√768 ≈ 0.036, so
      // a fixed ×127 scale only ever reaches about a tenth of the int8 range.
      // Absolute, because the nearest hit's exact distance is 0 (the query *is* that vector)
      // and a relative bound there is 0/0. Over unit vectors L2 never exceeds 2, so 0.03 is
      // about 1.5 % of the full range.
      const exact = withFloats[index]?.distance as number
      expect(Math.abs(hit.distance - exact)).toBeLessThan(0.03)
    }
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
