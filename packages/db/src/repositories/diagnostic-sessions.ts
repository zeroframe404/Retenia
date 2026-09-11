import type {
  DiagnosticSession,
  DiagnosticSessionRepository,
  DiagnosticSessionStatus,
  NewEntity,
} from '@retenia/core'
import { and, asc, desc, eq } from 'drizzle-orm'
import { diagnosticSessions } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  fromDate,
  fromDateOrNull,
  toDate,
  toDateOrNull,
  toJsonArray,
  toJsonObject,
  toJsonObjectOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

/**
 * `diagnostic_sessions` (docs/spec/04-path-generation.md §10, sub-phase 8.5): one row per run
 * of the prior-knowledge diagnostic over a path version.
 *
 * Ordinary CRUD — the row holds the answer log the engine replays and a record of what the
 * result wrote; the lessons and cards themselves live in their own tables.
 */

type NewDiagnosticSession = NewEntity<DiagnosticSession>
type DiagnosticSessionColumns = Partial<NewDiagnosticSession> & { version?: number }

const codec: TableCodec<DiagnosticSession, NewDiagnosticSession, DiagnosticSessionColumns> = {
  table: diagnosticSessions,
  name: 'diagnostic_sessions',
  toEntity: (row: Row): DiagnosticSession => ({
    id: toText(row.id),
    pathVersionId: toText(row.pathVersionId),
    status: toText(row.status) as DiagnosticSessionStatus,
    entry: toText(row.entry) as DiagnosticSession['entry'],
    selfAssessment: toJsonObject(row.selfAssessment),
    answers: toJsonArray(row.answers),
    pending: toJsonObjectOrNull(row.pending),
    result: toJsonObjectOrNull(row.result),
    applied: toJsonObject(row.applied),
    stopReason: toTextOrNull(row.stopReason) as DiagnosticSession['stopReason'],
    startedAt: toDate(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      pathVersionId: input.pathVersionId,
      status: input.status,
      entry: input.entry,
      selfAssessment: input.selfAssessment,
      answers: input.answers,
      pending: input.pending ?? null,
      result: input.result ?? null,
      applied: input.applied,
      stopReason: input.stopReason ?? null,
      startedAt: fromDate(input.startedAt),
      finishedAt: fromDateOrNull(input.finishedAt),
    }),
  toUpdate: (patch) =>
    defined({
      pathVersionId: patch.pathVersionId,
      status: patch.status,
      entry: patch.entry,
      selfAssessment: patch.selfAssessment,
      answers: patch.answers,
      pending: patch.pending,
      result: patch.result,
      applied: patch.applied,
      stopReason: patch.stopReason,
      startedAt: patch.startedAt === undefined ? undefined : fromDate(patch.startedAt),
      finishedAt: patch.finishedAt === undefined ? undefined : fromDateOrNull(patch.finishedAt),
    }),
}

export function createDiagnosticSessionRepository(
  ctx: RepositoryContext,
): DiagnosticSessionRepository {
  const base: BaseRepository<DiagnosticSession, NewDiagnosticSession, DiagnosticSessionColumns> =
    createBaseRepository(ctx, codec)

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

    /** Newest first, so a stale row a crash left behind never shadows a newer session. The
     *  `diagnostic_sessions_active` partial index covers exactly this predicate. */
    findActive: async (pathVersionId) => {
      const [row] = await base.findWhere(
        and(
          eq(diagnosticSessions.pathVersionId, pathVersionId),
          eq(diagnosticSessions.status, 'in_progress'),
        ),
        { orderBy: [desc(diagnosticSessions.startedAt), desc(diagnosticSessions.id)], limit: 1 },
      )
      return row
    },

    listByPathVersion: (pathVersionId, options) =>
      base.findWhere(eq(diagnosticSessions.pathVersionId, pathVersionId), {
        ...options,
        orderBy: [asc(diagnosticSessions.startedAt), asc(diagnosticSessions.id)],
      }),

    listByStatus: (status, options) =>
      base.findWhere(eq(diagnosticSessions.status, status), {
        ...options,
        orderBy: [asc(diagnosticSessions.startedAt), asc(diagnosticSessions.id)],
      }),
  }
}
