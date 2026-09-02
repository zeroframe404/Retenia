import type { Job, JobStatus, JsonObject, JsonValue } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

export interface EnqueueOptions {
  priority?: number
  /** Not eligible before this instant. Defaults to now. */
  runAfter?: Date
  maxAttempts?: number
  parentJobId?: string
  subjectId?: string
  /** While a live job with this key exists, enqueuing again returns it instead of a new
   *  one — how a re-triggered ingestion avoids duplicating work. */
  idempotencyKey?: string
}

/**
 * The persisted job queue (`docs/spec/07-architecture.md` §7). This is the storage half
 * only: the `utilityProcess` pool that consumes it is sub-phase 3.4.
 */
export interface JobRepository extends CrudRepository<Job> {
  enqueue(kind: string, payload: JsonObject, options?: EnqueueOptions): Promise<Job>
  /**
   * Atomically takes the highest-priority queued job whose `runAfter` has passed, marks it
   * `running` and stamps `lockedBy`/`lockedAt`/`startedAt`. Returns undefined when there is
   * nothing to do. Two workers racing can never claim the same job.
   */
  claim(workerId: string, now: Date, kinds?: readonly string[]): Promise<Job | undefined>
  /** Refreshes `lockedAt` so a long job is not mistaken for an orphan. */
  heartbeat(id: string, at: Date): Promise<void>
  reportProgress(id: string, progress: JsonObject): Promise<void>
  succeed(id: string, result: JsonValue | null, at: Date): Promise<Job>
  /** Records the failure and either re-queues it (`retryAt` given, `attempts` still under
   *  `maxAttempts`) or marks it `failed`. */
  fail(id: string, error: string, at: Date, retryAt?: Date): Promise<Job>
  cancel(id: string, at: Date): Promise<Job>
  listByStatus(status: JobStatus, options?: ListOptions): Promise<Job[]>
  listBySubject(subjectId: string, options?: ListOptions): Promise<Job[]>
  /** Jobs left `running` by a process that died — `lockedAt` older than `before`. Puts them
   *  back in the queue and returns how many. Called at startup. */
  reclaimOrphans(before: Date, now: Date): Promise<number>
  countByStatus(): Promise<Record<JobStatus, number>>
  /** Only used by tests and importers; normal callers go through `enqueue`. */
  create(input: NewEntity<Job>): Promise<Job>
}
