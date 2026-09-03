import type { Job, JobStatus, JsonObject, JsonValue } from '../entities'
import type { EntityPatch, ListOptions, NewEntity } from '../ports/audit'
import type { Clock } from '../ports/clock'
import { EntityNotFoundError } from '../ports/errors'
import type { EnqueueOptions, JobRepository } from '../ports/job-repository'
import type { ProcessLiveness } from '../ports/process-liveness'

/**
 * An in-memory `JobRepository` and the fake clock that drives it.
 *
 * `packages/db` proves the *real* repository against `jobsContract`; this double exists so
 * the scheduler's policy — backoff, orphan recovery, the retry reset — can be tested in
 * `packages/core`, which by rule depends on nothing (`tooling/scripts/check-deps.mjs`) and
 * so cannot reach `@retenia/db/testing`.
 *
 * It reproduces the behaviours the scheduler actually leans on: the claim picks the highest
 * priority whose `run_after` has passed and increments `attempts`, `fail` re-queues only
 * while attempts remain, soft deletes hide rows. It is not a second implementation of the
 * schema and does not try to be.
 */

/** A clock that only moves when told to. Mirrors `@retenia/db/testing`'s `testClock`. */
export interface FakeClock extends Clock {
  advance(ms: number): void
  set(ms: number): void
}

export function fakeClock(startMs: number = Date.UTC(2026, 8, 2)): FakeClock {
  let current = startMs
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms
    },
    set: (ms) => {
      current = ms
    },
  }
}

/** A `ProcessLiveness` whose answers the test controls. Unknown pids are dead. */
export interface FakeLiveness extends ProcessLiveness {
  setAlive(pid: number, alive: boolean): void
}

export function fakeLiveness(alivePids: readonly number[] = []): FakeLiveness {
  const alive = new Set(alivePids)
  return {
    isAlive: (pid) => alive.has(pid),
    setAlive: (pid, value) => {
      if (value) alive.add(pid)
      else alive.delete(pid)
    },
  }
}

export interface InMemoryJobRepository extends JobRepository {
  /** Every row, deleted ones included — what a test asserts against directly. */
  all(): Job[]
}

export function createInMemoryJobRepository(
  clock: Clock,
  options: { deviceId?: string } = {},
): InMemoryJobRepository {
  const deviceId = options.deviceId ?? 'test-device'
  const rows = new Map<string, Job>()
  let sequence = 0

  /** Ids only have to sort in creation order for the queue's tie-break to be meaningful. */
  const nextId = (): string => {
    sequence += 1
    return `00000000-0000-7000-8000-${String(sequence).padStart(12, '0')}`
  }

  const live = (): Job[] => [...rows.values()].filter((job) => job.deletedAt === null)

  const get = (id: string): Job => {
    const job = rows.get(id)
    if (job === undefined || job.deletedAt !== null) throw new EntityNotFoundError('jobs', id)
    return job
  }

  const write = (job: Job): Job => {
    rows.set(job.id, job)
    return job
  }

  const touch = (job: Job, patch: Partial<Job>): Job =>
    write({ ...job, ...patch, updatedAt: clock.now(), version: job.version + 1 })

  /** Priority desc, then creation order — the repository's `ORDER BY priority DESC, created_at`. */
  const byQueueOrder = (a: Job, b: Job): number =>
    b.priority - a.priority ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)

  const page = <T>(items: T[], options?: ListOptions): T[] => {
    const offset = options?.offset ?? 0
    return options?.limit === undefined
      ? items.slice(offset)
      : items.slice(offset, offset + options.limit)
  }

  const create = async (input: NewEntity<Job>): Promise<Job> => {
    const now = clock.now()
    return write({
      ...input,
      id: input.id ?? nextId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deviceId,
      version: 1,
    })
  }

  return {
    all: () => [...rows.values()],

    findById: async (id, findOptions) => {
      const job = rows.get(id)
      if (job === undefined) return undefined
      return job.deletedAt === null || findOptions?.includeDeleted === true ? job : undefined
    },
    findMany: async (ids) =>
      ids.map((id) => rows.get(id)).filter((job) => job?.deletedAt === null) as Job[],
    list: async (listOptions) => page(live().sort(byQueueOrder), listOptions),
    count: async (countOptions) =>
      countOptions?.includeDeleted === true ? rows.size : live().length,
    create,

    update: async (id, patch: EntityPatch<Job>) => {
      const job = get(id)
      if (patch.version !== undefined && patch.version !== job.version) {
        throw new Error(
          `jobs ${id} moved on (expected version ${patch.version}, found ${job.version})`,
        )
      }
      const { version: _ignored, ...fields } = patch
      return touch(job, fields as Partial<Job>)
    },

    save: async (entity) => {
      const existing = rows.get(entity.id)
      if (existing === undefined) return create(entity)
      return touch(existing, entity as Partial<Job>)
    },

    softDelete: async (id) => {
      const job = rows.get(id)
      if (job === undefined || job.deletedAt !== null) return
      touch(job, { deletedAt: clock.now() })
    },

    restore: async (id) => {
      const job = rows.get(id)
      if (job === undefined || job.deletedAt === null) return
      touch(job, { deletedAt: null })
    },

    enqueue: async (kind, payload: JsonObject, enqueueOptions: EnqueueOptions = {}) => {
      if (enqueueOptions.idempotencyKey !== undefined) {
        const existing = live().find((job) => job.idempotencyKey === enqueueOptions.idempotencyKey)
        if (existing !== undefined) return existing
      }
      return create({
        kind,
        status: 'queued',
        priority: enqueueOptions.priority ?? 0,
        payload,
        result: null,
        progress: null,
        attempts: 0,
        maxAttempts: enqueueOptions.maxAttempts ?? 3,
        runAfter: enqueueOptions.runAfter ?? clock.now(),
        lockedBy: null,
        lockedAt: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        parentJobId: enqueueOptions.parentJobId ?? null,
        subjectId: enqueueOptions.subjectId ?? null,
        idempotencyKey: enqueueOptions.idempotencyKey ?? null,
      })
    },

    claim: async (workerId, now, kinds) => {
      const candidate = live()
        .filter(
          (job) =>
            job.status === 'queued' &&
            job.runAfter.getTime() <= now.getTime() &&
            (kinds === undefined || kinds.length === 0 || kinds.includes(job.kind)),
        )
        .sort(byQueueOrder)[0]
      if (candidate === undefined) return undefined
      return touch(candidate, {
        status: 'running',
        lockedBy: workerId,
        lockedAt: now,
        startedAt: now,
        attempts: candidate.attempts + 1,
      })
    },

    heartbeat: async (id, at) => {
      touch(get(id), { lockedAt: at })
    },

    reportProgress: async (id, progress: JsonObject) => {
      touch(get(id), { progress })
    },

    succeed: async (id, result: JsonValue | null, at) =>
      touch(get(id), {
        status: 'succeeded',
        result,
        finishedAt: at,
        error: null,
        lockedBy: null,
        lockedAt: null,
      }),

    fail: async (id, error, at, retryAt) => {
      const job = get(id)
      const canRetry = retryAt !== undefined && job.attempts < job.maxAttempts
      return touch(job, {
        status: canRetry ? 'queued' : 'failed',
        error,
        lockedBy: null,
        lockedAt: null,
        runAfter: canRetry ? retryAt : job.runAfter,
        finishedAt: canRetry ? null : at,
      })
    },

    cancel: async (id, at) =>
      touch(get(id), { status: 'cancelled', finishedAt: at, lockedBy: null, lockedAt: null }),

    listByStatus: async (status, listOptions) =>
      page(
        live()
          .filter((job) => job.status === status)
          .sort(byQueueOrder),
        listOptions,
      ),

    listBySubject: async (subjectId, listOptions) =>
      page(
        live()
          .filter((job) => job.subjectId === subjectId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        listOptions,
      ),

    reclaimOrphans: async (before, now) => {
      const stale = live().filter(
        (job) =>
          job.status === 'running' &&
          job.lockedAt !== null &&
          job.lockedAt.getTime() <= before.getTime(),
      )
      for (const job of stale) {
        touch(job, {
          status: 'queued',
          lockedBy: null,
          lockedAt: null,
          startedAt: null,
          runAfter: now,
        })
      }
      return stale.length
    },

    countByStatus: async () => {
      const totals: Record<JobStatus, number> = {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      }
      for (const job of live()) totals[job.status] += 1
      return totals
    },
  }
}
