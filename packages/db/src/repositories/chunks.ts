import type { Chunk, ChunkRepository, NewEntity } from '@retenia/core'
import { asc, eq } from 'drizzle-orm'
import { createHybridSearch } from '../hybrid-search'
import { chunks } from '../schema'
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

export function createChunkRepository(ctx: RepositoryContext): ChunkRepository {
  const base: BaseRepository<Chunk, NewChunk, ChunkPatch> = createBaseRepository(ctx, codec)

  /**
   * The retrieval pipeline of `docs/spec/05-ingestion-rag.md` §4. It lives in
   * `../hybrid-search.ts` rather than here because it is a service over two indexes, not a
   * table mapping: it is built once per repository set and reused across calls (its
   * statements are cached per connection), and the vector index behind it is a port, so a
   * future LanceDB backend replaces it without touching this file.
   */
  const hybrid = createHybridSearch({
    sqlite: ctx.db.$client,
    loadChunks: (ids) => base.findMany(ids),
    ...(ctx.vectorIndex === undefined ? {} : { vectorIndex: ctx.vectorIndex }),
    ...(ctx.reranker === undefined ? {} : { reranker: ctx.reranker }),
  })

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
     * `fts` and `vector` rank by their own index; `hybrid` fuses the two with RRF and, when
     * one is configured, hands the survivors to the reranker.
     *
     * Soft deletes need no filtering here: the triggers of migrations 0001 and 0002 drop a
     * chunk's FTS entry and its vectors the moment it is soft-deleted, so neither index can
     * return one.
     */
    search: (query, options) => hybrid.search(query, options),
  }
}
