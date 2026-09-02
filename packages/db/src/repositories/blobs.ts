import type { Blob, BlobRepository, ListOptions, NewEntity } from '@retenia/core'
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { blobs, sources, sourceUnits } from '../schema'
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

type NewBlob = NewEntity<Blob>
type BlobPatch = Partial<NewBlob> & { version?: number }

const codec: TableCodec<Blob, NewBlob, BlobPatch> = {
  table: blobs,
  name: 'blobs',
  toEntity: (row: Row): Blob => ({
    id: toText(row.id),
    sha256: toText(row.sha256),
    mime: toText(row.mime),
    bytes: toNumber(row.bytes),
    ext: toTextOrNull(row.ext),
    originalName: toTextOrNull(row.originalName),
    meta: toJsonObjectOrNull(row.meta),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      sha256: input.sha256,
      mime: input.mime,
      bytes: input.bytes,
      ext: input.ext ?? null,
      originalName: input.originalName ?? null,
      meta: input.meta ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      sha256: patch.sha256,
      mime: patch.mime,
      bytes: patch.bytes,
      ext: patch.ext,
      originalName: patch.originalName,
      meta: patch.meta,
    }),
}

/** A blob is referenced while any live `sources` or `source_units` row points at its sha. */
function referencedShas(ctx: RepositoryContext): string[] {
  const fromSources = ctx.db
    .select({ sha: sources.blobSha256 })
    .from(sources)
    .where(and(isNull(sources.deletedAt), sql`${sources.blobSha256} is not null`))
    .all() as Array<{ sha: string | null }>
  const fromUnits = ctx.db
    .select({ sha: sourceUnits.blobSha256 })
    .from(sourceUnits)
    .where(and(isNull(sourceUnits.deletedAt), sql`${sourceUnits.blobSha256} is not null`))
    .all() as Array<{ sha: string | null }>
  const shas = new Set<string>()
  for (const row of [...fromSources, ...fromUnits]) {
    if (row.sha !== null) shas.add(row.sha)
  }
  return [...shas]
}

export function createBlobRepository(ctx: RepositoryContext): BlobRepository {
  const base: BaseRepository<Blob, NewBlob, BlobPatch> = createBaseRepository(ctx, codec)

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

    findBySha256: async (sha256) => (await base.findWhere(eq(blobs.sha256, sha256)))[0],

    listUnreferenced: async (options?: ListOptions) => {
      const referenced = referencedShas(ctx)
      const unreferenced =
        referenced.length === 0 ? undefined : notInArray(blobs.sha256, referenced)
      // A soft-deleted blob is unreferenced too — and is exactly what GC is for.
      return base.findWhere(unreferenced, {
        ...options,
        includeDeleted: true,
        orderBy: [asc(blobs.createdAt), asc(blobs.id)],
      })
    },

    /**
     * The documented exception to "no hard deletes" (`docs/spec/00-conventions.md`): an
     * unreferenced blob is garbage, not history. Refuses any sha something still points at,
     * so a caller passing a stale list cannot orphan a source. Removing the file from disk
     * is the blob store's job (sub-phase 3.5).
     */
    collectGarbage: async (shas) => {
      if (shas.length === 0) return 0
      return ctx.run(async () => {
        const referenced = new Set(referencedShas(ctx))
        const stillUsed = shas.filter((sha) => referenced.has(sha))
        if (stillUsed.length > 0) {
          throw new Error(
            `blobs: refusing to collect ${stillUsed.length} blob(s) still referenced by a live source or unit (${stillUsed[0]})`,
          )
        }
        return ctx.db
          .delete(blobs)
          .where(inArray(blobs.sha256, [...shas]))
          .run().changes
      })
    },
  }
}
