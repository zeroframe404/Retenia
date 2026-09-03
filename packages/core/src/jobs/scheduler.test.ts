import { beforeEach, describe, expect, it } from 'vitest'
import {
  createInMemoryJobRepository,
  type FakeClock,
  type FakeLiveness,
  fakeClock,
  fakeLiveness,
  type InMemoryJobRepository,
} from '../testing/in-memory-job-repository'
import { registerJob } from './definition'
import { createJobRegistry } from './registry'
import { createJobScheduler, type JobScheduler } from './scheduler'
import { formatWorkerId } from './worker-id'

const MINUTE = 60_000

/** Two kinds, so "the registry decides the defaults" and the kind filter are both testable. */
const registry = createJobRegistry([
  registerJob({
    type: 'sleep',
    parseInput: (payload) => payload,
    run: async () => null,
  }),
  registerJob({
    type: 'hashFile',
    parseInput: (payload) => payload,
    run: async () => null,
    defaultPriority: 5,
    defaultMaxAttempts: 2,
  }),
])

describe('JobScheduler', () => {
  let clock: FakeClock
  let liveness: FakeLiveness
  let jobs: InMemoryJobRepository
  let scheduler: JobScheduler

  /** The pid of "our worker" in the happy path. */
  const WORKER_PID = 4242
  const RUN_ID = 'run-a'
  const lease = { pid: WORKER_PID, workerId: 'w0' }

  beforeEach(() => {
    clock = fakeClock()
    liveness = fakeLiveness([WORKER_PID])
    jobs = createInMemoryJobRepository(clock)
    scheduler = createJobScheduler({ jobs, clock, liveness, registry, runId: RUN_ID })
  })

  describe('enqueue', () => {
    it('refuses a kind nothing can run, rather than queueing it forever', async () => {
      await expect(scheduler.enqueue('transcribe', {})).rejects.toThrow(
        /No job definition is registered for "transcribe"/,
      )
    })

    it('takes the priority and attempt budget from the definition', async () => {
      const job = await scheduler.enqueue('hashFile', { path: 'a' })
      expect(job).toMatchObject({ priority: 5, maxAttempts: 2 })
    })

    it('lets the caller override the definition defaults', async () => {
      const job = await scheduler.enqueue('hashFile', {}, { priority: 9, maxAttempts: 1 })
      expect(job).toMatchObject({ priority: 9, maxAttempts: 1 })
    })
  })

  describe('claim', () => {
    it('takes the highest priority first', async () => {
      await scheduler.enqueue('sleep', {}, { priority: 0 })
      await scheduler.enqueue('sleep', {}, { priority: 10 })
      const claimed = await scheduler.claim(lease)
      expect(claimed?.priority).toBe(10)
    })

    it('breaks a priority tie by age', async () => {
      const first = await scheduler.enqueue('sleep', { n: 1 })
      clock.advance(1000)
      await scheduler.enqueue('sleep', { n: 2 })
      expect((await scheduler.claim(lease))?.id).toBe(first.id)
    })

    it('leaves a job alone until its run_after has passed', async () => {
      await scheduler.enqueue('sleep', {}, { runAfter: new Date(clock.now().getTime() + MINUTE) })
      expect(await scheduler.claim(lease)).toBeUndefined()

      clock.advance(MINUTE)
      expect(await scheduler.claim(lease)).toBeDefined()
    })

    it('stamps a lease naming the worker process, so recovery can ask about it', async () => {
      await scheduler.enqueue('sleep', {})
      const claimed = await scheduler.claim(lease)
      expect(claimed?.lockedBy).toBe(formatWorkerId({ ...lease, runId: RUN_ID }))
    })
  })

  describe('failure and backoff', () => {
    it('re-queues 2^n minutes out while attempts remain', async () => {
      const queued = await scheduler.enqueue('sleep', {}, { maxAttempts: 3 })
      const start = clock.now().getTime()

      await scheduler.claim(lease)
      const first = await scheduler.failed(queued.id, 'boom')
      expect(first.status).toBe('queued')
      expect(first.runAfter.getTime()).toBe(start + 2 * MINUTE)

      clock.advance(2 * MINUTE)
      await scheduler.claim(lease)
      const second = await scheduler.failed(queued.id, 'boom')
      expect(second.runAfter.getTime()).toBe(clock.now().getTime() + 4 * MINUTE)
    })

    it('really is invisible to a claim until the backoff has elapsed', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      await scheduler.claim(lease)
      await scheduler.failed(queued.id, 'boom')

      clock.advance(2 * MINUTE - 1)
      expect(await scheduler.claim(lease)).toBeUndefined()
      clock.advance(1)
      expect(await scheduler.claim(lease)).toBeDefined()
    })

    it('gives up once the attempts are spent', async () => {
      const queued = await scheduler.enqueue('sleep', {}, { maxAttempts: 1 })
      await scheduler.claim(lease)
      const failed = await scheduler.failed(queued.id, 'permanent')
      expect(failed).toMatchObject({ status: 'failed', error: 'permanent' })
      expect(failed.finishedAt).not.toBeNull()
    })

    it('records the result of a success', async () => {
      const queued = await scheduler.enqueue('hashFile', {})
      await scheduler.claim(lease)
      const done = await scheduler.complete(queued.id, { sha256: 'abc' })
      expect(done).toMatchObject({ status: 'succeeded', lockedBy: null })
      expect(done.result).toEqual({ sha256: 'abc' })
    })
  })

  describe('cancel and retry', () => {
    it('cancels a queued job', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      expect((await scheduler.cancel(queued.id)).status).toBe('cancelled')
      expect(await scheduler.claim(lease)).toBeUndefined()
    })

    it('cancels a job mid-run and releases its lease', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      await scheduler.claim(lease)

      const cancelled = await scheduler.cancel(queued.id)
      expect(cancelled).toMatchObject({ status: 'cancelled', lockedBy: null, lockedAt: null })
      // A cancelled job is not re-run: it is out of the queue for good until someone retries.
      expect(await scheduler.claim(lease)).toBeUndefined()
    })

    it('retries a failed job with a clean slate, not its last attempt', async () => {
      const queued = await scheduler.enqueue('sleep', {}, { maxAttempts: 1 })
      await scheduler.claim(lease)
      await scheduler.failed(queued.id, 'boom')

      const retried = await scheduler.retry(queued.id)
      expect(retried).toMatchObject({ status: 'queued', attempts: 0, error: null })
      expect(retried.runAfter.getTime()).toBe(clock.now().getTime())
      expect(await scheduler.claim(lease)).toBeDefined()
    })

    it('retries a cancelled job', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      await scheduler.cancel(queued.id)
      expect((await scheduler.retry(queued.id)).status).toBe('queued')
    })

    it('refuses to retry a job that has not finished', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      await expect(scheduler.retry(queued.id)).rejects.toThrow(/Only a failed or cancelled job/)

      await scheduler.claim(lease)
      await expect(scheduler.retry(queued.id)).rejects.toThrow(/is running/)
    })
  })

  describe('progress', () => {
    it('clamps what a job reports, so a bad divisor cannot produce 400%', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      await scheduler.reportProgress(queued.id, 4, 'reading')
      expect((await jobs.findById(queued.id))?.progress).toEqual({ value: 1, message: 'reading' })

      await scheduler.reportProgress(queued.id, Number.NaN)
      expect((await jobs.findById(queued.id))?.progress).toEqual({ value: 0, message: null })
    })
  })

  describe('listActive', () => {
    it('shows running jobs before queued ones', async () => {
      await scheduler.enqueue('sleep', { n: 1 })
      const running = await scheduler.claim(lease)
      await scheduler.enqueue('sleep', { n: 2 })
      await scheduler.enqueue('sleep', { n: 3 })

      const active = await scheduler.listActive()
      expect(active).toHaveLength(3)
      expect(active[0]?.id).toBe(running?.id)
      expect(active[0]?.status).toBe('running')
    })

    it('leaves finished jobs out', async () => {
      const queued = await scheduler.enqueue('sleep', {})
      await scheduler.claim(lease)
      await scheduler.complete(queued.id, null)
      expect(await scheduler.listActive()).toEqual([])
    })
  })

  describe('recoverOrphans', () => {
    const claimAs = async (pid: number, workerId = 'w0') => {
      const job = await scheduler.enqueue('sleep', {})
      liveness.setAlive(pid, true)
      const claimed = await scheduler.claim({ pid, workerId })
      return { job, claimed }
    }

    it('re-queues a job whose worker process is gone', async () => {
      const { job } = await claimAs(9999)
      clock.advance(10_000)
      liveness.setAlive(9999, false)

      expect(await scheduler.recoverOrphans()).toBe(1)
      const recovered = await jobs.findById(job.id)
      expect(recovered).toMatchObject({ status: 'queued', lockedBy: null, startedAt: null })
      expect(await scheduler.claim(lease)).toBeDefined()
    })

    it('re-queues a job whose lease it cannot read', async () => {
      const { job } = await claimAs(9999)
      await jobs.update(job.id, { lockedBy: 'some-older-format' })
      clock.advance(10_000)

      expect(await scheduler.recoverOrphans()).toBe(1)
      expect((await jobs.findById(job.id))?.status).toBe('queued')
    })

    it('leaves a job alone while its worker is alive and heartbeating', async () => {
      const { job } = await claimAs(WORKER_PID)
      clock.advance(10_000)
      await jobs.heartbeat(job.id, clock.now())

      expect(await scheduler.recoverOrphans()).toBe(0)
      expect((await jobs.findById(job.id))?.status).toBe('running')
    })

    it('never steals a lease from one of its own live workers, however late the heartbeat', async () => {
      const { job } = await claimAs(WORKER_PID)
      clock.advance(60 * MINUTE)

      const guarded = createJobScheduler({
        jobs,
        clock,
        liveness,
        registry,
        runId: RUN_ID,
        ownWorkerPids: () => new Set([WORKER_PID]),
      })
      expect(await guarded.recoverOrphans()).toBe(0)
      expect((await jobs.findById(job.id))?.status).toBe('running')
    })

    it('re-queues a live but silent worker once the lease goes stale', async () => {
      const { job } = await claimAs(WORKER_PID)
      // The pid is alive and is not ours — a recycled pid, or a wedged worker. Only the
      // heartbeat can tell us, so nothing happens until the lease times out.
      clock.advance(10_000)
      expect(await scheduler.recoverOrphans()).toBe(0)

      clock.advance(6 * MINUTE)
      expect(await scheduler.recoverOrphans()).toBe(1)
      expect((await jobs.findById(job.id))?.status).toBe('queued')
    })

    /**
     * The crash-and-restart case, and the reason there is no grace window for a dead owner:
     * recovery only runs at startup, so a job skipped here because its claim looked "recent"
     * would stay `running` forever with nothing left to sweep it up.
     */
    it('reclaims a dead owner immediately, however recently it claimed', async () => {
      const { job } = await claimAs(9999)
      liveness.setAlive(9999, false)

      expect(await scheduler.recoverOrphans()).toBe(1)
      expect((await jobs.findById(job.id))?.status).toBe('queued')
    })

    it('gives a live owner until the lease expires before taking its work', async () => {
      const { job } = await claimAs(WORKER_PID)

      // Alive and recently claimed: it may simply not have heartbeated yet.
      expect(await scheduler.recoverOrphans()).toBe(0)
      expect((await jobs.findById(job.id))?.status).toBe('running')
    })

    it('recovers nothing when nothing was running', async () => {
      await scheduler.enqueue('sleep', {})
      expect(await scheduler.recoverOrphans()).toBe(0)
    })

    /**
     * The reason the lease carries a run id. After a crash and restart the OS can hand the
     * dead worker's pid to an unrelated program; a pid-only check would then see "alive",
     * skip the row, and — since recovery runs at startup — leave the job stranded for the
     * whole session.
     */
    it('reclaims a previous run even when its pid now belongs to something else', async () => {
      const previousRun = createJobScheduler({
        jobs,
        clock,
        liveness,
        registry,
        runId: 'run-that-crashed',
      })
      await previousRun.enqueue('sleep', {})
      await previousRun.claim({ pid: WORKER_PID, workerId: 'w0' })

      // This run's pool holds that very pid, and it is alive — the pid was recycled.
      const restarted = createJobScheduler({
        jobs,
        clock,
        liveness,
        registry,
        runId: RUN_ID,
        ownWorkerPids: () => new Set([WORKER_PID]),
      })

      expect(await restarted.recoverOrphans()).toBe(1)
      expect(await restarted.claim(lease)).toBeDefined()
    })
  })
})
