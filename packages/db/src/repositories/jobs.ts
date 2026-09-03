import type { Job, JobRepository, JobStatus, JsonObject, JsonValue, NewEntity } from '@retenia/core'
import { EntityNotFoundError } from '@retenia/core'
import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import { jobs } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import { mapConstraintErrors } from './errors'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObject,
  toJsonObjectOrNull,
  toJsonValueOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

const codec: TableCodec<Job, NewEntity<Job>, Partial<NewEntity<Job>> & { version?: number }> = {
  table: jobs,
  name: 'jobs',
  toEntity: (row: Row): Job => ({
    id: toText(row.id),
    kind: toText(row.kind),
    status: row.status as JobStatus,
    priority: toNumber(row.priority),
    payload: toJsonObject(row.payload),
    result: toJsonValueOrNull(row.result),
    progress: toJsonObjectOrNull(row.progress),
    attempts: toNumber(row.attempts),
    maxAttempts: toNumber(row.maxAttempts),
    runAfter: toDate(row.runAfter),
    lockedBy: toTextOrNull(row.lockedBy),
    lockedAt: toDateOrNull(row.lockedAt),
    startedAt: toDateOrNull(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    error: toTextOrNull(row.error),
    parentJobId: toTextOrNull(row.parentJobId),
    subjectId: toTextOrNull(row.subjectId),
    idempotencyKey: toTextOrNull(row.idempotencyKey),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      kind: input.kind,
      status: input.status,
      priority: input.priority,
      payload: input.payload,
      result: input.result ?? null,
      progress: input.progress ?? null,
      attempts: input.attempts,
      maxAttempts: input.maxAttempts,
      runAfter: input.runAfter.getTime(),
      lockedBy: input.lockedBy ?? null,
      lockedAt:
        input.lockedAt === null || input.lockedAt === undefined ? null : input.lockedAt.getTime(),
      startedAt:
        input.startedAt === null || input.startedAt === undefined
          ? null
          : input.startedAt.getTime(),
      finishedAt:
        input.finishedAt === null || input.finishedAt === undefined
          ? null
          : input.finishedAt.getTime(),
      error: input.error ?? null,
      parentJobId: input.parentJobId ?? null,
      subjectId: input.subjectId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      kind: patch.kind,
      status: patch.status,
      priority: patch.priority,
      payload: patch.payload,
      result: patch.result,
      progress: patch.progress,
      attempts: patch.attempts,
      maxAttempts: patch.maxAttempts,
      runAfter: patch.runAfter === undefined ? undefined : patch.runAfter.getTime(),
      lockedBy: patch.lockedBy,
      lockedAt: patch.lockedAt === undefined ? undefined : (patch.lockedAt?.getTime() ?? null),
      startedAt: patch.startedAt === undefined ? undefined : (patch.startedAt?.getTime() ?? null),
      finishedAt:
        patch.finishedAt === undefined ? undefined : (patch.finishedAt?.getTime() ?? null),
      error: patch.error,
      parentJobId: patch.parentJobId,
      subjectId: patch.subjectId,
      idempotencyKey: patch.idempotencyKey,
    }),
}

export function createJobRepository(ctx: RepositoryContext): JobRepository {
  const base = createBaseRepository(ctx, codec)

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

    /** An `idempotencyKey` that already names a live job returns that job instead of
     *  queueing a second one — how a re-triggered ingestion avoids duplicating work. */
    enqueue: async (kind, payload: JsonObject, options = {}) =>
      ctx.run(async () => {
        if (options.idempotencyKey !== undefined) {
          const existing = await base.findWhere(eq(jobs.idempotencyKey, options.idempotencyKey))
          if (existing[0] !== undefined) return existing[0]
        }
        return base.create({
          kind,
          status: 'queued',
          priority: options.priority ?? 0,
          payload,
          result: null,
          progress: null,
          attempts: 0,
          maxAttempts: options.maxAttempts ?? 3,
          runAfter: options.runAfter ?? ctx.clock.now(),
          lockedBy: null,
          lockedAt: null,
          startedAt: null,
          finishedAt: null,
          error: null,
          parentJobId: options.parentJobId ?? null,
          subjectId: options.subjectId ?? null,
          idempotencyKey: options.idempotencyKey ?? null,
        })
      }),

    /**
     * The claim of `docs/spec/07-architecture.md` §7, verbatim: one statement whose `WHERE`
     * names the winner by subquery, so two workers racing can never take the same job — the
     * loser's `UPDATE` matches zero rows. Bespoke rather than `base.update` because the row
     * to write is chosen by the statement itself.
     */
    claim: async (workerId, now, kinds) => {
      const at = now.getTime()
      // Bound parameters, never string interpolation: `kinds` reaches here from a worker
      // pool's configuration and must not be able to shape the SQL.
      const kindFilter =
        kinds === undefined || kinds.length === 0
          ? sql``
          : sql` and kind in (${sql.join(
              kinds.map((kind) => sql`${kind}`),
              sql`, `,
            )})`
      const rows = mapConstraintErrors('jobs', () =>
        ctx.db
          .update(jobs)
          .set({
            status: 'running',
            lockedBy: workerId,
            lockedAt: at,
            startedAt: at,
            attempts: sql`${jobs.attempts} + 1`,
            updatedAt: sql`max(${jobs.updatedAt}, ${at})`,
            deviceId: ctx.deviceId,
            version: sql`${jobs.version} + 1`,
          })
          .where(
            sql`${jobs.id} = (select id from ${jobs} where status = 'queued' and run_after <= ${at} and deleted_at is null${kindFilter} order by priority desc, created_at limit 1)`,
          )
          .returning()
          .all(),
      ) as Row[]
      const row = rows[0]
      if (row === undefined) return undefined
      ctx.outbox.append('update', 'jobs', { id: toText(row.id), version: toNumber(row.version) })
      return codec.toEntity(row)
    },

    heartbeat: async (id, at) => {
      await base.updateColumns(id, { lockedAt: at.getTime() })
    },

    reportProgress: async (id, progress) => {
      await base.updateColumns(id, { progress })
    },

    succeed: (id, result: JsonValue | null, at) =>
      base.updateColumns(id, {
        status: 'succeeded',
        result,
        finishedAt: at.getTime(),
        error: null,
        lockedBy: null,
        lockedAt: null,
      }),

    /** Re-queues when a `retryAt` is given and there are attempts left; otherwise the job
     *  is `failed` for good. Backoff itself is the queue's policy: `JobScheduler.failed`
     *  in `@retenia/core` computes the `retryAt` this receives. */
    fail: async (id, error, at, retryAt) =>
      ctx.run(async () => {
        const job = await base.findById(id)
        if (job === undefined) throw new EntityNotFoundError('jobs', id)
        const canRetry = retryAt !== undefined && job.attempts < job.maxAttempts
        return base.updateColumns(id, {
          status: canRetry ? 'queued' : 'failed',
          error,
          lockedBy: null,
          lockedAt: null,
          runAfter: canRetry ? retryAt.getTime() : job.runAfter.getTime(),
          finishedAt: canRetry ? null : at.getTime(),
        })
      }),

    cancel: (id, at) =>
      base.updateColumns(id, {
        status: 'cancelled',
        finishedAt: at.getTime(),
        lockedBy: null,
        lockedAt: null,
      }),

    listByStatus: (status, options) =>
      base.findWhere(eq(jobs.status, status), {
        ...options,
        orderBy: [desc(jobs.priority), asc(jobs.createdAt), asc(jobs.id)],
      }),

    listBySubject: (subjectId, options) =>
      base.findWhere(eq(jobs.subjectId, subjectId), {
        ...options,
        orderBy: [asc(jobs.createdAt), asc(jobs.id)],
      }),

    /** Jobs a dead process left `running`. Called at startup, before any worker claims. */
    reclaimOrphans: async (before, now) =>
      ctx.run(async () => {
        const stale = await base.findWhere(
          and(eq(jobs.status, 'running'), lte(jobs.lockedAt, before.getTime())),
        )
        for (const job of stale) {
          await base.updateColumns(job.id, {
            status: 'queued',
            lockedBy: null,
            lockedAt: null,
            startedAt: null,
            runAfter: now.getTime(),
          })
        }
        return stale.length
      }),

    countByStatus: async () => {
      const rows = ctx.db
        .select({ status: jobs.status, value: count() })
        .from(jobs)
        .where(isNull(jobs.deletedAt))
        .groupBy(jobs.status)
        .all() as Array<{ status: JobStatus; value: number }>
      const totals: Record<JobStatus, number> = {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      }
      for (const row of rows) totals[row.status] = row.value
      return totals
    },
  }
}
