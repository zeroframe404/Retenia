import type {
  ListOptions,
  NewEntity,
  ReviewSession,
  ReviewSessionRepository,
  ReviewSessionStatus,
} from '@retenia/core'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { reviewSessions } from '../schema'
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
  toNumberOrNull,
  toText,
} from './mapping'

/**
 * `review_sessions` (docs/spec/02-memory-system.md §12): one row per run through the daily
 * queue, so closing the app mid-session does not lose the queue.
 *
 * Ordinary CRUD — the row carries no scheduler state, only a frozen queue order and a
 * cursor, so there is nothing here the append-only rules apply to.
 */

type NewReviewSession = NewEntity<ReviewSession>
type ReviewSessionColumns = Partial<NewReviewSession> & { version?: number }

const codec: TableCodec<ReviewSession, NewReviewSession, ReviewSessionColumns> = {
  table: reviewSessions,
  name: 'review_sessions',
  toEntity: (row: Row): ReviewSession => ({
    id: toText(row.id),
    status: toText(row.status) as ReviewSessionStatus,
    startedAt: toDate(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    durationMs: toNumberOrNull(row.durationMs),
    seed: toText(row.seed),
    plan: toJsonObject(row.plan),
    progress: toJsonObject(row.progress),
    reviewed: toNumber(row.reviewed),
    again: toNumber(row.again),
    hard: toNumber(row.hard),
    postponed: toNumber(row.postponed),
    accuracy: toNumberOrNull(row.accuracy),
    xp: toNumber(row.xp),
    summary: toJsonObjectOrNull(row.summary),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      status: input.status,
      startedAt: fromDate(input.startedAt),
      finishedAt: fromDateOrNull(input.finishedAt),
      durationMs: input.durationMs ?? null,
      seed: input.seed,
      plan: input.plan,
      progress: input.progress,
      reviewed: input.reviewed,
      again: input.again,
      hard: input.hard,
      postponed: input.postponed,
      accuracy: input.accuracy ?? null,
      xp: input.xp,
      summary: input.summary ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      status: patch.status,
      startedAt: patch.startedAt === undefined ? undefined : fromDate(patch.startedAt),
      finishedAt: patch.finishedAt === undefined ? undefined : fromDateOrNull(patch.finishedAt),
      durationMs: patch.durationMs,
      seed: patch.seed,
      plan: patch.plan,
      progress: patch.progress,
      reviewed: patch.reviewed,
      again: patch.again,
      hard: patch.hard,
      postponed: patch.postponed,
      accuracy: patch.accuracy,
      xp: patch.xp,
      summary: patch.summary,
    }),
}

export function createReviewSessionRepository(ctx: RepositoryContext): ReviewSessionRepository {
  const base: BaseRepository<ReviewSession, NewReviewSession, ReviewSessionColumns> =
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

    /** Newest first, so a stale row a crash left behind never shadows a newer session. */
    findActive: async () => {
      const [row] = await base.findWhere(eq(reviewSessions.status, 'in_progress'), {
        orderBy: [desc(reviewSessions.startedAt), desc(reviewSessions.id)],
        limit: 1,
      })
      return row
    },

    listSince: (from: Date, to?: Date, options?: ListOptions) =>
      base.findWhere(
        and(
          gte(reviewSessions.startedAt, fromDate(from)),
          ...(to === undefined ? [] : [lt(reviewSessions.startedAt, fromDate(to))]),
        ),
        { ...options, orderBy: [desc(reviewSessions.startedAt), desc(reviewSessions.id)] },
      ),

    /** One `UPDATE` rather than a read-then-write loop: this runs on every start and is
     *  almost always a no-op, so it must not cost a query per stale row. */
    abandonStale: async (before: Date) => {
      const stale = await base.findWhere(
        and(
          eq(reviewSessions.status, 'in_progress'),
          lt(reviewSessions.startedAt, fromDate(before)),
        ),
      )
      for (const session of stale) await base.update(session.id, { status: 'abandoned' })
      return stale.length
    },
  }
}
