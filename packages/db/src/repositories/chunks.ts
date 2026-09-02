import type { Chunk, ChunkRepository, ChunkSearchHit, NewEntity } from '@retenia/core'
import { asc, eq } from 'drizzle-orm'
import { chunks } from '../schema'
import { ftsQuery, knnChunks, searchChunksFts } from '../search'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObjectOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

type NewChunk = NewEntity<Chunk>
type ChunkPatch = Partial<NewChunk> & { version?: number }

const codec: TableCodec<Chunk, NewChunk, ChunkPatch> = {
  table: chunks,
  name: 'chunks',
  toEntity: (row: Row): Chunk => ({
    id: toText(row.id),
    sourceId: toText(row.sourceId),
    unitId: toTextOrNull(row.unitId),
    ordinal: toNumber(row.ordinal),
    text: toText(row.text),
    charStart: toNumber(row.charStart),
    charEnd: toNumber(row.charEnd),
    tokenCount: toNumber(row.tokenCount),
    hash: toText(row.hash),
    headingPath: toTextOrNull(row.headingPath),
    context: toTextOrNull(row.context),
    locator: toJsonObjectOrNull(row.locator),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      sourceId: input.sourceId,
      unitId: input.unitId ?? null,
      ordinal: input.ordinal,
      text: input.text,
      charStart: input.charStart,
      charEnd: input.charEnd,
      tokenCount: input.tokenCount,
      hash: input.hash,
      headingPath: input.headingPath ?? null,
      context: input.context ?? null,
      locator: input.locator ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      sourceId: patch.sourceId,
      unitId: patch.unitId,
      ordinal: patch.ordinal,
      text: patch.text,
      charStart: patch.charStart,
      charEnd: patch.charEnd,
      tokenCount: patch.tokenCount,
      hash: patch.hash,
      headingPath: patch.headingPath,
      context: patch.context,
      locator: patch.locator,
    }),
}

/**
 * Reciprocal Rank Fusion's smoothing constant (Cormack et al. 2009), the value
 * `docs/spec/05-ingestion-rag.md` §4 assumes.
 *
 * RRF rather than score normalisation because the two branches are not comparable:
 * `bm25()` is negative and lower-is-better, an L2 distance is positive and lower-is-better,
 * and min-max normalising either one per query is wildly unstable when a branch returns two
 * hits. RRF uses only the ordinal rank, which is exactly why it is the standard fusion here.
 */
const RRF_K = 60

/** How many candidates each branch contributes before fusion. */
function candidateCount(k: number): number {
  return Math.max(k * 3, 50)
}

export function createChunkRepository(ctx: RepositoryContext): ChunkRepository {
  const base: BaseRepository<Chunk, NewChunk, ChunkPatch> = createBaseRepository(ctx, codec)

  /** One batched read rather than N `findById` calls, preserving the fused order. */
  async function hydrate(ids: readonly string[]): Promise<Map<string, Chunk>> {
    if (ids.length === 0) return new Map()
    const rows = await base.findMany(ids)
    return new Map(rows.map((chunk) => [chunk.id, chunk]))
  }

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,
    softDelete: base.softDelete,
    restore: base.restore,

    listBySource: (sourceId, options) =>
      base.findWhere(eq(chunks.sourceId, sourceId), {
        ...options,
        orderBy: [asc(chunks.ordinal), asc(chunks.id)],
      }),

    findByHash: (hash) => base.findWhere(eq(chunks.hash, hash)),

    createMany: base.createMany,

    /**
     * `fts` and `vector` rank by their own index; `hybrid` fuses the two with RRF. Soft
     * deletes need no filtering here: the triggers of migration `0001` drop a chunk's FTS
     * entry and its vectors the moment it is soft-deleted, so neither index can return one.
     *
     * The local reranker on top of these candidates is sub-phase 3.3.
     */
    search: async (query, options): Promise<ChunkSearchHit[]> => {
      const k = options.k ?? 10
      if (k <= 0) return []
      const sqlite = ctx.db.$client
      const candidates = candidateCount(k)

      if (options.mode === 'fts') {
        const hits = searchChunksFts(sqlite, ftsQuery(query), {
          limit: k,
          sourceId: options.sourceId,
          snippetTokens: options.snippetTokens,
        })
        const byId = await hydrate(hits.map((hit) => hit.chunkId))
        return hits.flatMap((hit, index) => {
          const chunk = byId.get(hit.chunkId)
          return chunk === undefined
            ? []
            : [
                {
                  chunk,
                  score: 1 / (RRF_K + index + 1),
                  snippet: hit.snippet,
                  fts: { rank: hit.rank },
                },
              ]
        })
      }

      if (options.mode === 'vector') {
        const hits = knnChunks(sqlite, options.embedding, {
          k,
          modelId: options.modelId,
          sourceId: options.sourceId,
        })
        const byId = await hydrate(hits.map((hit) => hit.chunkId))
        return hits.flatMap((hit, index) => {
          const chunk = byId.get(hit.chunkId)
          return chunk === undefined
            ? []
            : [{ chunk, score: 1 / (RRF_K + index + 1), vector: { distance: hit.distance } }]
        })
      }

      const ftsHits = searchChunksFts(sqlite, ftsQuery(query), {
        limit: candidates,
        sourceId: options.sourceId,
        snippetTokens: options.snippetTokens,
      })
      const vectorHits = knnChunks(sqlite, options.embedding, {
        k: candidates,
        modelId: options.modelId,
        sourceId: options.sourceId,
      })

      const scores = new Map<string, number>()
      const addRanks = (ids: readonly string[]) => {
        ids.forEach((chunkId, index) => {
          scores.set(chunkId, (scores.get(chunkId) ?? 0) + 1 / (RRF_K + index + 1))
        })
      }
      addRanks(ftsHits.map((hit) => hit.chunkId))
      addRanks(vectorHits.map((hit) => hit.chunkId))

      const ftsById = new Map(ftsHits.map((hit) => [hit.chunkId, hit]))
      const vectorById = new Map(vectorHits.map((hit) => [hit.chunkId, hit]))

      const ranked = [...scores.entries()]
        // Ids are UUIDv7, so the tie-break is stable and tests are deterministic.
        .sort(([leftId, left], [rightId, right]) =>
          right === left ? leftId.localeCompare(rightId) : right - left,
        )
        .slice(0, k)

      const byId = await hydrate(ranked.map(([chunkId]) => chunkId))
      return ranked.flatMap(([chunkId, score]) => {
        const chunk = byId.get(chunkId)
        if (chunk === undefined) return []
        const fts = ftsById.get(chunkId)
        const vector = vectorById.get(chunkId)
        return [
          {
            chunk,
            score,
            ...(fts === undefined ? {} : { snippet: fts.snippet, fts: { rank: fts.rank } }),
            ...(vector === undefined ? {} : { vector: { distance: vector.distance } }),
          },
        ]
      })
    },
  }
}
