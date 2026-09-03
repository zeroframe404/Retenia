import type { Job, JobStatus, JsonObject, JsonValue } from '../entities'
import type { ListOptions } from '../ports/audit'
import type { Clock } from '../ports/clock'
import { EntityNotFoundError } from '../ports/errors'
import type { EnqueueOptions, JobRepository } from '../ports/job-repository'
import type { ProcessLiveness } from '../ports/process-liveness'
import { type BackoffOptions, nextRetryAt } from './backoff'
import type { JobRegistry } from './registry'
import { formatWorkerId, parseWorkerId, type WorkerLease } from './worker-id'

/**
 * The queue's policy layer (`docs/spec/07-architecture.md` §7).
 *
 * `JobRepository` is the storage half and already owns the hard part — the atomic claim, the
 * ordering by priority then `created_at`, the `run_after` gate, idempotency keys. What lives
 * here is everything that is a *decision* rather than a write: which defaults a kind gets,
 * how long to wait before a retry, and which of the jobs left `running` by a previous run
 * are stranded. None of it touches Electron, Node or SQLite, so it is testable against an
 * in-memory repository and a clock that only moves when told to.
 */

/** Progress as the runner persists it, and as `jobs.progress` reads it back out. */
export interface JobProgress extends JsonObject {
  /** 0–1. */
  value: number
  message: string | null
}

export interface JobSchedulerDeps {
  jobs: JobRepository
  clock: Clock
  liveness: ProcessLiveness
  registry: JobRegistry
  /**
   * Identifies this run of the application. Minted once at startup and stamped into every
   * lease, so recovery can tell a lease this process took from one a previous run left
   * behind — which a pid cannot do, because the OS reuses them.
   */
  runId: string
  backoff?: BackoffOptions
  /**
   * How long a lease may go without a heartbeat before the job counts as stranded even
   * though its process is alive — a wedged worker, or a pid the OS has since handed to
   * something else. Must comfortably exceed the runner's heartbeat interval.
   */
  leaseTimeoutMs?: number
  /**
   * The pids of this process's own live workers. Recovery never touches their leases, even
   * if a heartbeat is late — we can see they are ours and running. Defaults to none, which
   * is correct at startup, when no worker has been forked yet.
   */
  ownWorkerPids?: () => ReadonlySet<number>
}

/** Five minutes: ten times the runner's 30 s heartbeat, so a slow disk never looks dead. */
export const DEFAULT_LEASE_TIMEOUT_MS = 5 * 60_000

export interface JobScheduler {
  /** Queue work. Rejects a kind the registry does not know. */
  enqueue(type: string, payload: JsonObject, options?: EnqueueOptions): Promise<Job>
  /** Mark a job cancelled. Stopping a worker that is *running* it is the runner's job —
   *  this only moves the row. */
  cancel(id: string): Promise<Job>
  /** Put a `failed` or `cancelled` job back in the queue with a clean slate. */
  retry(id: string): Promise<Job>
  /** `queued` and `running` together, the order they will run in. What the tray shows. */
  listActive(): Promise<Job[]>
  /**
   * One status, in queue order. The tray also wants `failed`, which is not "active".
   *
   * Pass a `limit`: `succeeded` and `failed` are never purged (rows are soft-deleted, never
   * removed), so an unbounded read grows with the lifetime of the install.
   */
  listByStatus(status: JobStatus, options?: ListOptions): Promise<Job[]>
  /** Take the next runnable job for a worker, stamping its lease. */
  claim(worker: Omit<WorkerLease, 'runId'>): Promise<Job | undefined>
  heartbeat(id: string): Promise<void>
  reportProgress(id: string, value: number, message?: string): Promise<void>
  complete(id: string, result: JsonValue): Promise<Job>
  /** Record a failure, re-queueing it 2ⁿ minutes out while attempts remain. */
  failed(id: string, error: string): Promise<Job>
  /**
   * Re-queue every job a dead process left `running`. Call once at startup, before any
   * worker claims. Returns how many jobs moved.
   */
  recoverOrphans(): Promise<number>
}

export function createJobScheduler(deps: JobSchedulerDeps): JobScheduler {
  const { jobs, clock, liveness, registry, runId } = deps
  const leaseTimeoutMs = deps.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS
  const ownWorkerPids = deps.ownWorkerPids ?? (() => new Set<number>())

  /** Puts a claimed row back in the queue, clearing the lease. Used by orphan recovery and
   *  by `retry`; `runAfter` differs between the two, so it is a parameter. */
  const requeue = (id: string, runAfter: Date, patch: Partial<Job> = {}): Promise<Job> =>
    jobs.update(id, {
      status: 'queued',
      lockedBy: null,
      lockedAt: null,
      startedAt: null,
      finishedAt: null,
      runAfter,
      ...patch,
    })

  const load = async (id: string): Promise<Job> => {
    const job = await jobs.findById(id)
    if (job === undefined) throw new EntityNotFoundError('jobs', id)
    return job
  }

  return {
    enqueue: async (type, payload, options = {}) => {
      const definition = registry.get(type)
      if (definition === undefined) {
        throw new Error(
          `No job definition is registered for "${type}" (known: ${registry.types().join(', ')})`,
        )
      }
      return jobs.enqueue(type, payload, {
        ...options,
        priority: options.priority ?? definition.defaultPriority,
        maxAttempts: options.maxAttempts ?? definition.defaultMaxAttempts,
      })
    },

    cancel: (id) => jobs.cancel(id, clock.now()),

    /**
     * A retry is a fresh start, not a continuation: `attempts` goes back to 0 so the user
     * gets the full backoff ladder again, and the stale error is cleared so the tray stops
     * showing it.
     */
    retry: async (id) => {
      const job = await load(id)
      if (job.status !== 'failed' && job.status !== 'cancelled') {
        throw new Error(`Only a failed or cancelled job can be retried; "${id}" is ${job.status}`)
      }
      return requeue(id, clock.now(), { attempts: 0, error: null, result: null })
    },

    listActive: async () => {
      const [queued, running] = await Promise.all([
        jobs.listByStatus('queued'),
        jobs.listByStatus('running'),
      ])
      // Running first — they are the ones with a progress bar — then queued in the order
      // the claim will actually take them (both lists arrive already sorted that way).
      return [...running, ...queued]
    },

    listByStatus: (status, options) => jobs.listByStatus(status, options),

    claim: (worker) =>
      jobs.claim(formatWorkerId({ ...worker, runId }), clock.now(), registry.types()),

    heartbeat: (id) => jobs.heartbeat(id, clock.now()),

    reportProgress: (id, value, message) => {
      const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
      const progress: JobProgress = { value: clamped, message: message ?? null }
      return jobs.reportProgress(id, progress)
    },

    complete: (id, result) => jobs.succeed(id, result, clock.now()),

    failed: async (id, error) => {
      const job = await load(id)
      const now = clock.now()
      // `retryAt` is always offered; the repository is what decides whether there are
      // attempts left to use it, so the ladder lives in one place rather than two.
      return jobs.fail(id, error, now, nextRetryAt(job.attempts, now, deps.backoff))
    },

    /**
     * A job counts as stranded when, past the grace window, either its owning process is
     * gone or its lease has simply gone quiet:
     *
     * - **The lease is from a previous run.** The common case, and the one the acceptance
     *   criterion names: the app was killed or crashed, and every job its workers had in
     *   flight is stranded the moment it restarts. This is settled by the run id alone, with
     *   no liveness question to get wrong — a run that is over is over, even if the OS has
     *   since handed that pid to something else.
     * - **The owner is gone.** A lease from *this* run whose worker process has died: the
     *   pool lost a child while the app kept going. The lease names the worker's pid, not
     *   main's, precisely so this is answerable. A lease we cannot parse counts as gone too —
     *   we cannot ask about a process we cannot name, and re-running a job is the recoverable
     *   direction.
     * - **The lease went stale.** The pid is alive but has not heartbeated in
     *   `leaseTimeoutMs`: a wedged worker.
     *
     * Only the second waits. There is no grace period for a dead owner: a process that no
     * longer exists will never heartbeat, so delaying before reclaiming its work buys
     * nothing — and because this runs at startup, a crash and restart inside such a window
     * would leave the job stranded with nothing left to sweep it up.
     *
     * Both are checked in one pass rather than delegating the second to
     * `JobRepository.reclaimOrphans`, because that bulk statement selects on `lockedAt`
     * alone: it cannot tell a wedged stranger from one of our own workers grinding through a
     * long job on a slow disk, and stealing the latter's claim would run that job twice.
     */
    recoverOrphans: async () => {
      const now = clock.now()
      const ours = ownWorkerPids()
      const staleBefore = now.getTime() - leaseTimeoutMs
      const running = await jobs.listByStatus('running')

      let recovered = 0
      for (const job of running) {
        const lease = parseWorkerId(job.lockedBy)

        // A lease this run took, held by a worker we can still see: leave it be.
        if (lease?.runId === runId && ours.has(lease.pid)) continue

        if (lease?.runId === runId && liveness.isAlive(lease.pid)) {
          // Ours, alive, but not in the pool — or in it and slow. Only the heartbeat can
          // tell a wedged worker from a busy one, so wait for the lease to expire.
          const lockedAt = job.lockedAt?.getTime() ?? 0
          if (lockedAt > staleBefore) continue
        }

        // Everything else is stranded: a lease from a run that has ended, one we cannot
        // read, or one whose worker process is gone. None of them will ever heartbeat, so
        // there is nothing to wait for.
        await requeue(job.id, now)
        recovered += 1
      }

      return recovered
    },
  }
}
