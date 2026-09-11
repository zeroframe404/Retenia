import type {
  NewEntity,
  Remediation,
  RemediationRefusal,
  RemediationRepository,
  RemediationStatus,
  RemediationTrigger,
} from '@retenia/core'
import { asc, eq, gte, inArray } from 'drizzle-orm'
import { pathVersions, remediations } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  fromDate,
  fromDateOrNull,
  toDate,
  toDateOrNull,
  toJsonObject,
  toJsonObjectOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

/**
 * `remediations` (docs/spec/04-path-generation.md §11, sub-phase 8.6): the remediation log.
 *
 * Ordinary CRUD plus the four reads the limits and the sweeps make. The detour itself is a
 * `lessons` row of kind `remediation`; this is the decision and its evidence.
 */

type NewRemediation = NewEntity<Remediation>
type RemediationColumns = Partial<NewRemediation> & { version?: number }

const codec: TableCodec<Remediation, NewRemediation, RemediationColumns> = {
  table: remediations,
  name: 'remediations',
  toEntity: (row: Row): Remediation => ({
    id: toText(row.id),
    pathVersionId: toText(row.pathVersionId),
    moduleId: toTextOrNull(row.moduleId),
    conceptId: toText(row.conceptId),
    misconceptionId: toTextOrNull(row.misconceptionId),
    trigger: toText(row.trigger) as RemediationTrigger,
    status: toText(row.status) as RemediationStatus,
    refusal: toTextOrNull(row.refusal) as RemediationRefusal | null,
    anchorLessonId: toTextOrNull(row.anchorLessonId),
    lessonId: toTextOrNull(row.lessonId),
    specId: toTextOrNull(row.specId),
    evidence: toJsonObject(row.evidence),
    boost: toJsonObject(row.boost),
    outcome: toJsonObjectOrNull(row.outcome),
    resolvedAt: toDateOrNull(row.resolvedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      pathVersionId: input.pathVersionId,
      moduleId: input.moduleId ?? null,
      conceptId: input.conceptId,
      misconceptionId: input.misconceptionId ?? null,
      trigger: input.trigger,
      status: input.status,
      refusal: input.refusal ?? null,
      anchorLessonId: input.anchorLessonId ?? null,
      lessonId: input.lessonId ?? null,
      specId: input.specId ?? null,
      evidence: input.evidence,
      boost: input.boost,
      outcome: input.outcome ?? null,
      resolvedAt: fromDateOrNull(input.resolvedAt),
    }),
  toUpdate: (patch) =>
    defined({
      pathVersionId: patch.pathVersionId,
      moduleId: patch.moduleId,
      conceptId: patch.conceptId,
      misconceptionId: patch.misconceptionId,
      trigger: patch.trigger,
      status: patch.status,
      refusal: patch.refusal,
      anchorLessonId: patch.anchorLessonId,
      lessonId: patch.lessonId,
      specId: patch.specId,
      evidence: patch.evidence,
      boost: patch.boost,
      outcome: patch.outcome,
      resolvedAt: patch.resolvedAt === undefined ? undefined : fromDateOrNull(patch.resolvedAt),
    }),
}

export function createRemediationRepository(ctx: RepositoryContext): RemediationRepository {
  const base: BaseRepository<Remediation, NewRemediation, RemediationColumns> =
    createBaseRepository(ctx, codec)
  const oldestFirst = [asc(remediations.createdAt), asc(remediations.id)]

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

    listByPathVersion: (pathVersionId, options) =>
      base.findWhere(eq(remediations.pathVersionId, pathVersionId), {
        ...options,
        orderBy: oldestFirst,
      }),

    listByPathId: async (pathId, options) => {
      // No join on the codec table (`base.findWhere` only): the path's version ids first,
      // then the ordinary indexed `pathVersionId IN (...)` read — the same two-step shape
      // `paths.loadTree` uses to cross a foreign key.
      const versionRows = ctx.db
        .select({ id: pathVersions.id })
        .from(pathVersions)
        .where(eq(pathVersions.pathId, pathId))
        .all() as Array<{ id: string }>
      if (versionRows.length === 0) return []
      return base.findWhere(
        inArray(
          remediations.pathVersionId,
          versionRows.map((row) => row.id),
        ),
        { ...options, orderBy: oldestFirst },
      )
    },

    listByStatus: async (statuses, options) =>
      statuses.length === 0
        ? []
        : base.findWhere(inArray(remediations.status, [...statuses]), {
            ...options,
            orderBy: oldestFirst,
          }),

    listSince: (from, options) =>
      base.findWhere(gte(remediations.createdAt, fromDate(from)), {
        ...options,
        orderBy: oldestFirst,
      }),

    findByLesson: async (lessonId) => {
      const [row] = await base.findWhere(eq(remediations.lessonId, lessonId), {
        orderBy: oldestFirst,
        limit: 1,
      })
      return row
    },
  }
}
