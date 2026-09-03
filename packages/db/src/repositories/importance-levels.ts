import type {
  ImportanceLevel,
  ImportanceLevelConfig,
  ImportanceLevelPatch,
  ImportanceLevelRepository,
  LeechAction,
  NewEntity,
} from '@retenia/core'
import { asc, eq } from 'drizzle-orm'
import { importanceLevels } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import { EntityNotFoundError } from './errors'
import {
  defined,
  fromBool,
  toBool,
  toDate,
  toDateOrNull,
  toNumber,
  toNumberOrNull,
  toText,
} from './mapping'

/**
 * The five rows of `importance_levels` (docs/spec/02-memory-system.md §7), seeded by
 * migration `0001` and addressed by `name`.
 *
 * They are read on every scheduling decision, through the in-memory `ImportanceCatalog`
 * built from `listOrdered()` — never per card.
 */

type NewImportanceLevel = NewEntity<ImportanceLevelConfig>
type ImportanceLevelColumns = Partial<NewImportanceLevel> & { version?: number }

const codec: TableCodec<ImportanceLevelConfig, NewImportanceLevel, ImportanceLevelColumns> = {
  table: importanceLevels,
  name: 'importance_levels',
  toEntity: (row: Row): ImportanceLevelConfig => ({
    id: toText(row.id),
    name: toText(row.name) as ImportanceLevel,
    desiredRetention: toNumberOrNull(row.desiredRetention),
    maxIntervalDays: toNumberOrNull(row.maxIntervalDays),
    orderRank: toNumber(row.orderRank),
    postponeAllowed: toBool(row.postponeAllowed),
    newPerDay: toNumberOrNull(row.newPerDay),
    leechThreshold: toNumber(row.leechThreshold),
    leechAction: toText(row.leechAction) as LeechAction,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      name: input.name,
      desiredRetention: input.desiredRetention ?? null,
      maxIntervalDays: input.maxIntervalDays ?? null,
      orderRank: input.orderRank,
      postponeAllowed: fromBool(input.postponeAllowed),
      newPerDay: input.newPerDay ?? null,
      leechThreshold: input.leechThreshold,
      leechAction: input.leechAction,
    }),
  toUpdate: (patch) =>
    defined({
      name: patch.name,
      desiredRetention: patch.desiredRetention,
      maxIntervalDays: patch.maxIntervalDays,
      orderRank: patch.orderRank,
      postponeAllowed:
        patch.postponeAllowed === undefined ? undefined : fromBool(patch.postponeAllowed),
      newPerDay: patch.newPerDay,
      leechThreshold: patch.leechThreshold,
      leechAction: patch.leechAction,
    }),
}

export function createImportanceLevelRepository(ctx: RepositoryContext): ImportanceLevelRepository {
  const base: BaseRepository<ImportanceLevelConfig, NewImportanceLevel, ImportanceLevelColumns> =
    createBaseRepository(ctx, codec)

  const findByName = async (name: ImportanceLevel): Promise<ImportanceLevelConfig | undefined> => {
    const [row] = await base.findWhere(eq(importanceLevels.name, name), { limit: 1 })
    return row
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

    findByName,

    listOrdered: () => base.findWhere(undefined, { orderBy: [asc(importanceLevels.orderRank)] }),

    /** Resolves the row by its natural key, then goes through the one write path so the
     *  audit set, the version bump and the outbox entry are handled exactly as everywhere
     *  else. */
    updateByName: async (name, patch: ImportanceLevelPatch) => {
      const existing = await findByName(name)
      if (existing === undefined) throw new EntityNotFoundError('importance_levels', name)
      return base.update(existing.id, patch)
    },
  }
}
