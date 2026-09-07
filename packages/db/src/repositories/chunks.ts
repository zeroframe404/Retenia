import type { Chunk, ChunkRepository, NewEntity } from '@retenia/core'
import { and, asc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { createHybridSearch } from '../hybrid-search'
import { chunks } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toBool,
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
    chunkKey: toTextOrNull(row.chunkKey),
    chunkingVersion: toTextOrNull(row.chunkingVersion),
    isFrontmatter: toBool(row.isFrontmatter),
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
      chunkKey: input.chunkKey ?? null,
      chunkingVersion: input.chunkingVersion ?? null,
      isFrontmatter: input.isFrontmatter ?? false,
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
      chunkKey: patch.chunkKey,
      chunkingVersion: patch.chunkingVersion,
      isFrontmatter: patch.isFrontmatter,
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
     * Re-chunking, by key rather than by wholesale replacement.
     *
     * The obvious implementation — soft-delete everything, insert the new set — is what
     * `SourceRepository.replaceUnits` does, and it is wrong here: the vec0 triggers of
     * migrations 0001/0002 drop a chunk's embeddings the moment it is soft-deleted, so
     * re-chunking an unchanged book (the same stored `SourceDoc`, cut again after a
     * `chunking_version` bump — `rechunkStaleSources`) would throw away every vector and pay
     * to compute them again. Matching on `chunk_key` — which the chunker derives from the
     * text and the `SourceDoc`'s own block ids — means only the chunks that genuinely changed
     * move.
     *
     * This buys nothing across a genuine **re-parse** (`library.retry`, which re-runs the
     * format parser itself): `chunk_key` folds in block ids, and every parser mints those
     * fresh (`ParseContext.id()`, a UUIDv7 per call), so a re-parsed document's chunks get new
     * keys even where the text is byte-identical, and the old rows are tombstoned rather than
     * matched. That is only reached on a source whose earlier parse or chunk failed — a
     * healthy source has nothing to retry — so it costs a full re-embed of a source that had
     * no usable vectors to preserve anyway.
     */
    replaceBySource: (sourceId, inputs) =>
      ctx.run(async () => {
        // Tombstones are matched too, and that is not an optimization: `chunks_source_key` is
        // unique over *every* row, so a chunk that goes away and comes back — the user edits a
        // paragraph, re-parses, reverts, re-parses — would otherwise collide with its own
        // soft-deleted self. Restoring it is also the better outcome: the row keeps its id, so
        // anything that cited it still resolves.
        const existing = await base.findWhere(eq(chunks.sourceId, sourceId), {
          includeDeleted: true,
        })
        const byKey = new Map(
          existing
            .filter((chunk) => chunk.chunkKey !== null)
            .map((chunk) => [chunk.chunkKey as string, chunk]),
        )
        const seen = new Set<string>()
        const result: Chunk[] = []

        for (const input of inputs) {
          const key = input.chunkKey
          // A draft with no key has no identity to match on, so it is always an insert. That
          // is the honest reading of "this chunk did not come from the chunker".
          const match = key == null ? undefined : byKey.get(key)
          if (match === undefined || key == null) {
            result.push(await base.create({ ...input, sourceId }))
            continue
          }
          seen.add(key)
          if (match.deletedAt !== null) await base.restore(match.id)
          // The ordinal and the unit can have moved even when the text did not — the chunk
          // before this one may have been split — but the *context* is kept: the key is a hash
          // of the text, so a match means this is the same span, and the 50–100 tokens someone
          // paid a model to write about it still describe it. An incoming context wins.
          const context = input.context ?? match.context
          result.push(await base.update(match.id, { ...input, sourceId, context }))
        }

        for (const chunk of existing) {
          if (chunk.deletedAt !== null) continue
          if (chunk.chunkKey !== null && seen.has(chunk.chunkKey)) continue
          await base.softDelete(chunk.id)
        }

        return result
      }),

    /**
     * One `SELECT DISTINCT` over an index, not a scan of every stale chunk: this runs at
     * startup over the whole library, and the alternative reads a book's worth of text per
     * source to throw all of it away but the id.
     */
    sourceIdsNeedingRechunk: async (chunkingVersion) => {
      const rows = await ctx.db
        .selectDistinct({ sourceId: chunks.sourceId })
        .from(chunks)
        .where(
          and(
            isNull(chunks.deletedAt),
            or(isNull(chunks.chunkingVersion), ne(chunks.chunkingVersion, chunkingVersion)),
          ),
        )
        .orderBy(asc(chunks.sourceId))
      return rows.map((row) => row.sourceId)
    },

    sourceIdsWithChunks: async () => {
      const rows = await ctx.db
        .selectDistinct({ sourceId: chunks.sourceId })
        .from(chunks)
        .where(isNull(chunks.deletedAt))
        .orderBy(asc(chunks.sourceId))
      return rows.map((row) => row.sourceId)
    },

    setContexts: (sourceId, contexts) =>
      ctx.run(async () => {
        if (contexts.length === 0) return 0
        const wanted = new Map(contexts.map((entry) => [entry.chunkKey, entry.context]))
        const existing = await base.findWhere(
          and(eq(chunks.sourceId, sourceId), isNotNull(chunks.chunkKey)),
        )
        let changed = 0
        for (const chunk of existing) {
          const context = wanted.get(chunk.chunkKey as string)
          // Unchanged text would still bump `version` and re-fire the FTS trigger; skipping is
          // both cheaper and quieter in the outbox.
          if (context === undefined || context === chunk.context) continue
          await base.update(chunk.id, { context })
          changed += 1
        }
        return changed
      }),

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
