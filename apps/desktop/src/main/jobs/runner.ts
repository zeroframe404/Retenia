import type { Job, JobScheduler } from '@retenia/core'
import type { JobProgressEvent } from '@retenia/ipc-contract'
import { log } from '../logging/log'
import type { JobPool, JobPoolHandlers } from './pool'
import { createProgressThrottle } from './progress-throttle'
import type { JobResponse } from './protocol'
import { redactPaths, redactPathsOrNull } from './redact'

/**
 * Drives the queue: claims work, hands it to the pool, and turns what comes back into
 * database writes and renderer pushes (`docs/spec/07-architecture.md` §7).
 *
 * The division of labour: `JobScheduler` (in `@retenia/core`) decides *policy* — priority,
 * backoff, which leases are stranded — and `JobPool` owns the processes. This is the piece
 * that knows about both, and it is the only writer of job state.
 */

export interface JobRunnerOptions {
  scheduler: JobScheduler
  /**
   * Builds the pool from the callbacks this runner needs to receive.
   *
   * A factory rather than a ready-made pool because the two reference each other: the runner
   * reacts to the pool's messages and the pool runs what the runner claims. It is also the
   * seam the unit tests use to stand in a fake pool, so the runner's state machine is
   * testable without forking a real `utilityProcess`.
   */
  createPool: (handlers: JobPoolHandlers) => JobPool
  emit: (event: JobProgressEvent) => void
  /** How often to refresh a running job's lease. Must be well inside the scheduler's
   *  `leaseTimeoutMs`, or a long job would keep re-queueing itself. */
  heartbeatMs?: number
  /** The claim loop's backstop tick, for jobs that become eligible with time (`runAfter`). */
  pollMs?: number
  /** How often a running job's progress is written to SQLite; pushes are not limited by it. */
  persistProgressMs?: number
}

export interface JobRunner {
  /** Recovers orphans, then starts the pool and the claim loop. */
  start(): Promise<void>
  /** Wake the claim loop — call after enqueueing so work starts without waiting for a tick. */
  kick(): void
  /** Cancel a job wherever it is: queued, or running in one of our workers. */
  cancel(id: string): Promise<Job>
  retry(id: string): Promise<Job>
  /** The pids of live workers, for the scheduler's orphan recovery. */
  livePids(): ReadonlySet<number>
  stop(): Promise<void>
}

export const DEFAULT_HEARTBEAT_MS = 30_000
export const DEFAULT_POLL_MS = 1_000
export const DEFAULT_PERSIST_PROGRESS_MS = 1_000

export function createJobRunner({
  scheduler,
  createPool,
  emit,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  pollMs = DEFAULT_POLL_MS,
  persistProgressMs = DEFAULT_PERSIST_PROGRESS_MS,
}: JobRunnerOptions): JobRunner {
  /** What we know about each job we handed out, so a message can become an event. */
  interface Running {
    kind: string
    progress: number | null
    message: string | null
    lastPersistedAt: number
  }
  const running = new Map<string, Running>()
  /**
   * Jobs cancelled *while running*, so the abort their worker reports a moment later is not
   * re-recorded as a failure and dragged back onto the retry ladder.
   *
   * Only running jobs go in: a queued job that is cancelled has no worker to hear from, so an
   * entry for it would never be cleared. Every path that gives a job a future — a retry, or a
   * fresh dispatch — clears it too, or the job could never be reported failed again.
   */
  const cancelled = new Set<string>()

  let started = false
  let claiming = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  const throttle = createProgressThrottle<JobProgressEvent>({ emit })

  /** Terminal events skip the throttle: the tray must never be left showing a stale bar. */
  const emitNow = (event: JobProgressEvent): void => {
    throttle.flush(event.id)
    emit(event)
  }

  const eventFor = (job: Job): JobProgressEvent => {
    const state = running.get(job.id)
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: state?.progress ?? null,
      message: state?.message ?? null,
      // Same rule as `toJobSummary`: no main-process paths cross the bridge.
      error: redactPathsOrNull(job.error),
    }
  }

  async function settle(jobId: string, finish: () => Promise<Job>): Promise<void> {
    try {
      const job = await finish()
      emitNow(eventFor(job))
    } catch (error) {
      log.error(`[jobs] could not record the outcome of ${jobId}:`, error)
    } finally {
      running.delete(jobId)
      cancelled.delete(jobId)
      throttle.flush(jobId)
    }
  }

  async function onProgress(jobId: string, value: number, message: string | null): Promise<void> {
    const state = running.get(jobId)
    if (state === undefined) return
    state.progress = value
    state.message = message

    throttle.push(jobId, {
      id: jobId,
      kind: state.kind,
      status: 'running',
      progress: value,
      message: message === null ? null : redactPaths(message),
      error: null,
    })

    // Persisted far more slowly than it is pushed: better-sqlite3 writes synchronously on
    // main's thread, and nothing reads this column until the next `jobs.list`.
    const now = Date.now()
    if (now - state.lastPersistedAt < persistProgressMs) return
    state.lastPersistedAt = now
    try {
      await scheduler.reportProgress(jobId, value, message ?? undefined)
    } catch (error) {
      log.error(`[jobs] could not persist progress for ${jobId}:`, error)
    }
  }

  async function onMessage(message: JobResponse): Promise<void> {
    switch (message.type) {
      case 'progress':
        await onProgress(message.jobId, message.value, message.message)
        return

      case 'done':
        await settle(message.jobId, () => scheduler.complete(message.jobId, message.result ?? null))
        return

      case 'error':
        // A cancelled job is already `cancelled`; recording a failure on top of that would
        // put it back on the retry ladder the user just took it off.
        if (message.cancelled || cancelled.has(message.jobId)) {
          running.delete(message.jobId)
          cancelled.delete(message.jobId)
          throttle.flush(message.jobId)
          return
        }
        await settle(message.jobId, () => scheduler.failed(message.jobId, message.message))
        return

      case 'log':
        log[message.level](`[job ${message.jobId}]`, message.message)
        return

      case 'ready':
      case 'idle':
        return
    }
  }

  const pool: JobPool = createPool({
    /**
     * A worker may only speak about the job it was actually given.
     *
     * `dispatchedJobId` is the pool's own record of what that slot is running; the `jobId`
     * inside the message is the worker's claim. Today both ends are our code, but the worker
     * is the process that will later run untrusted parsers (PDF, EPUB, ffmpeg output) — the
     * component most likely to be memory-corrupted — and without this check a compromised one
     * could mark any job in the queue succeeded with a result of its choosing.
     */
    onMessage: (slotId, message, dispatchedJobId) => {
      if ('jobId' in message && message.jobId !== dispatchedJobId) {
        log.error(
          `[jobs] ${slotId} sent a "${message.type}" for ${message.jobId}, which it was not given`,
        )
        return
      }
      void onMessage(message)
    },

    /** A worker that dies mid-job leaves the row `running` with a lease nobody holds. Fail it
     *  now so the backoff can re-queue it, rather than waiting for orphan recovery. */
    onWorkerLost: (slotId, jobId, reason) => {
      log.warn(`[jobs] ${slotId} lost job ${jobId}: ${reason}`)
      if (cancelled.has(jobId)) {
        running.delete(jobId)
        cancelled.delete(jobId)
        return
      }
      void settle(jobId, () => scheduler.failed(jobId, reason))
    },

    onIdle: () => {
      kick()
    },
  })

  /**
   * Claim and dispatch until there is either no capacity or no work.
   *
   * Guarded by `claiming` because every completion calls it and the awaits inside give other
   * callers a window: two overlapping runs would each see the same free slot, and the second
   * `dispatch` would fail having already taken its job out of the queue.
   */
  async function claimLoop(): Promise<void> {
    if (claiming || !started) return
    claiming = true
    try {
      while (started) {
        // `retiring` matters as much as `busy`: the pool refuses to dispatch to a worker on
        // its way out, so claiming for one would take the job out of the queue only to fail
        // it for want of a worker — burning an attempt on every recycle.
        const slot = pool
          .slots()
          .find((candidate) => candidate.ready && !candidate.busy && !candidate.retiring)
        if (slot?.pid === undefined) return

        const job = await scheduler.claim({ pid: slot.pid, workerId: slot.id })
        if (job === undefined) return

        // This job has a worker again, so any suppression left from a previous cancellation
        // must not outlive the dispatch — otherwise its next genuine failure is swallowed and
        // the row sits `running` for good.
        cancelled.delete(job.id)
        running.set(job.id, { kind: job.kind, progress: null, message: null, lastPersistedAt: 0 })

        const dispatched = pool.dispatch({
          type: 'start',
          jobId: job.id,
          kind: job.kind,
          payload: job.payload,
          attempt: job.attempts,
        })

        if (!dispatched) {
          // The slot went away between the claim and the dispatch. Put the job back rather
          // than leaving it `running` for orphan recovery to find minutes later.
          running.delete(job.id)
          await scheduler.failed(job.id, 'No worker was available to run this job')
          return
        }
        emitNow(eventFor(job))
      }
    } catch (error) {
      log.error('[jobs] claim loop failed:', error)
    } finally {
      claiming = false
    }
  }

  function kick(): void {
    void claimLoop()
  }

  return {
    start: async () => {
      if (started) return
      // Before any worker can claim: everything still marked `running` belongs to a process
      // that is gone, and leaving it would strand the job until its lease timed out.
      const recovered = await scheduler.recoverOrphans()
      if (recovered > 0) log.info(`[jobs] re-queued ${recovered} orphaned job(s) at startup`)

      started = true
      pool.start()
      // The pool also calls `onIdle` as each worker reports ready, which is what normally
      // starts the first claim. Kicking here too costs nothing (the loop returns immediately
      // while no slot is ready) and means a pool that is already warm does not sit idle until
      // the first poll tick.
      kick()

      pollTimer = setInterval(kick, pollMs)
      heartbeatTimer = setInterval(() => {
        for (const jobId of running.keys()) {
          void scheduler.heartbeat(jobId).catch((error: unknown) => {
            log.error(`[jobs] heartbeat failed for ${jobId}:`, error)
          })
        }
      }, heartbeatMs)
    },

    kick,

    cancel: async (id) => {
      // The row moves first: whether or not a worker is holding this job, the user asked for
      // it to stop, and a cancel that depended on a live worker would silently do nothing for
      // a queued one.
      const wasRunning = running.has(id)
      const job = await scheduler.cancel(id)
      // Only a job that had a worker will produce an abort message to suppress.
      if (wasRunning) cancelled.add(id)
      pool.cancel(id)
      running.delete(id)
      emitNow({
        id: job.id,
        kind: job.kind,
        status: job.status,
        progress: null,
        message: null,
        error: redactPathsOrNull(job.error),
      })
      return job
    },

    retry: async (id) => {
      const job = await scheduler.retry(id)
      // A retried job must be able to fail again.
      cancelled.delete(id)
      emitNow(eventFor(job))
      kick()
      return job
    },

    livePids: () => pool.livePids(),

    stop: async () => {
      started = false
      if (pollTimer !== undefined) clearInterval(pollTimer)
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      pollTimer = undefined
      heartbeatTimer = undefined
      throttle.dispose()
      await pool.stop()
      running.clear()
      cancelled.clear()
    },
  }
}
