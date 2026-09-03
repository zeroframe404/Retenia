import {
  createJobRegistry,
  createJobScheduler,
  type JobScheduler,
  registerJob,
} from '@retenia/core'
import { createInMemoryJobRepository, fakeClock, fakeLiveness } from '@retenia/core/testing'
import type { JobProgressEvent } from '@retenia/ipc-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobPool, JobPoolHandlers, WorkerSlot } from './pool'
import type { JobResponse } from './protocol'
import { createJobRunner, type JobRunner } from './runner'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/**
 * A pool that records what it was asked to run instead of forking anything, so the runner's
 * state machine — claim, dispatch, settle, cancel, re-queue — is testable without Electron.
 * `e2e/jobs.spec.ts` is what proves the real `utilityProcess` path.
 */
function fakePool(slotCount = 1) {
  const slots: WorkerSlot[] = Array.from({ length: slotCount }, (_unused, index) => ({
    id: `w${index}`,
    pid: 1000 + index,
    busy: false,
    ready: true,
    retiring: false,
  }))
  const dispatched: { jobId: string; kind: string }[] = []
  const cancelled: string[] = []
  /** Which job each slot is running, mirroring what the real pool records. */
  const jobBySlot = new Map<string, string>()
  let handlers: JobPoolHandlers

  const setBusy = (slotId: string, busy: boolean): void => {
    const index = slots.findIndex((slot) => slot.id === slotId)
    const slot = slots[index]
    if (slot !== undefined) slots[index] = { ...slot, busy }
  }

  const pool: JobPool = {
    // The real pool calls `onIdle` as each worker reports ready; that is what wakes the
    // claim loop, so the fake has to do it too.
    start: vi.fn(() => handlers.onIdle()),
    dispatch: (request) => {
      const free = slots.find((slot) => !slot.busy && !slot.retiring)
      if (free === undefined) return false
      setBusy(free.id, true)
      jobBySlot.set(free.id, request.jobId)
      dispatched.push({ jobId: request.jobId, kind: request.kind })
      return true
    },
    cancel: (jobId) => {
      cancelled.push(jobId)
      return true
    },
    livePids: () => new Set(slots.map((slot) => slot.pid).filter((pid) => pid !== undefined)),
    hasCapacity: () => slots.some((slot) => !slot.busy),
    slots: () => slots,
    stop: vi.fn(async () => {}),
  }

  return {
    pool,
    dispatched,
    cancelled,
    create: (given: JobPoolHandlers) => {
      handlers = given
      return pool
    },
    /** Free the slot the job was on and tell the runner, as a real worker's `idle` does. */
    finish(jobId: string) {
      const index = dispatched.findIndex((entry) => entry.jobId === jobId)
      const slot = slots[index]
      if (slot !== undefined) {
        setBusy(slot.id, false)
        jobBySlot.delete(slot.id)
      }
    },
    /**
     * A message from the worker on `slotId`, carrying the job that slot was actually
     * dispatched — which is what the real pool passes, and what lets the runner reject a
     * worker speaking about somebody else's job.
     */
    fromWorker(slotId: string, message: JobResponse) {
      handlers.onMessage(slotId, message, jobBySlot.get(slotId))
    },
    /** Put every slot into the retiring state the pool refuses to dispatch to. */
    retireAll() {
      for (const [index, slot] of slots.entries()) {
        slots[index] = { ...slot, retiring: true }
      }
    },
    /** A message whose slot is *lying* about which job it holds. */
    fromWorkerClaiming(slotId: string, message: JobResponse, claimedJobId: string | undefined) {
      handlers.onMessage(slotId, message, claimedJobId)
    },
    handlers: () => handlers,
  }
}

const registry = createJobRegistry([
  registerJob({ type: 'sleep', parseInput: (payload) => payload, run: async () => null }),
  registerJob({ type: 'hashFile', parseInput: (payload) => payload, run: async () => null }),
])

/** Lets the runner's floating promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('JobRunner', () => {
  let clock: ReturnType<typeof fakeClock>
  let jobs: ReturnType<typeof createInMemoryJobRepository>
  let scheduler: JobScheduler
  let pool: ReturnType<typeof fakePool>
  let events: JobProgressEvent[]
  let runner: JobRunner

  beforeEach(() => {
    clock = fakeClock()
    jobs = createInMemoryJobRepository(clock)
    scheduler = createJobScheduler({
      jobs,
      clock,
      liveness: fakeLiveness(),
      registry,
      runId: 'run-under-test',
    })
    pool = fakePool(2)
    events = []
    runner = createJobRunner({
      scheduler,
      createPool: pool.create,
      emit: (event) => events.push(event),
      // Long enough that no timer fires during a test; every kick here is explicit.
      pollMs: 60_000,
      heartbeatMs: 60_000,
    })
  })

  afterEach(async () => {
    await runner.stop()
  })

  it('claims queued work and hands it to a worker', async () => {
    await scheduler.enqueue('hashFile', { path: '/tmp/a' })
    await runner.start()
    await settle()

    expect(pool.dispatched).toEqual([{ jobId: expect.any(String), kind: 'hashFile' }])
    expect((await scheduler.listByStatus('running')).length).toBe(1)
  })

  it('fills every free slot, and stops at capacity', async () => {
    for (let index = 0; index < 4; index += 1) await scheduler.enqueue('sleep', { n: index })
    await runner.start()
    await settle()

    expect(pool.dispatched).toHaveLength(2)
    expect((await scheduler.listByStatus('queued')).length).toBe(2)
  })

  it('takes the highest priority first', async () => {
    await scheduler.enqueue('sleep', {}, { priority: 0 })
    await scheduler.enqueue('hashFile', {}, { priority: 10 })
    await runner.start()
    await settle()

    expect(pool.dispatched[0]?.kind).toBe('hashFile')
  })

  it('recovers orphans before any worker claims', async () => {
    await scheduler.enqueue('sleep', {})
    // A job left `running` by a process that is gone: its lease names a pid nothing reports
    // as alive, and the grace window has long passed.
    await scheduler.claim({ pid: 424_242, workerId: 'dead' })
    clock.advance(60_000)

    await runner.start()
    await settle()

    expect(pool.dispatched).toHaveLength(1)
  })

  it('records a success and frees the slot', async () => {
    const job = await scheduler.enqueue('sleep', {})
    await runner.start()
    await settle()

    pool.fromWorker('w0', { type: 'done', jobId: job.id, result: { ok: true } })
    await settle()

    const stored = await jobs.findById(job.id)
    expect(stored).toMatchObject({ status: 'succeeded' })
    expect(stored?.result).toEqual({ ok: true })
  })

  it('re-queues a failure with the backoff, rather than losing it', async () => {
    const job = await scheduler.enqueue('sleep', {}, { maxAttempts: 3 })
    await runner.start()
    await settle()

    pool.fromWorker('w0', {
      type: 'error',
      jobId: job.id,
      message: 'boom',
      cancelled: false,
    })
    await settle()

    const stored = await jobs.findById(job.id)
    expect(stored).toMatchObject({ status: 'queued', error: 'boom' })
    expect(stored?.runAfter.getTime()).toBe(clock.now().getTime() + 120_000)
  })

  it('re-queues a job whose worker died holding it', async () => {
    const job = await scheduler.enqueue('sleep', {})
    await runner.start()
    await settle()

    pool.handlers().onWorkerLost('w0', job.id, 'worker exited with code 1')
    await settle()

    expect(await jobs.findById(job.id)).toMatchObject({
      status: 'queued',
      error: 'worker exited with code 1',
    })
  })

  describe('cancel', () => {
    it('stops the worker and marks the row, for a running job', async () => {
      const job = await scheduler.enqueue('sleep', {})
      await runner.start()
      await settle()

      await runner.cancel(job.id)

      expect(pool.cancelled).toEqual([job.id])
      expect(await jobs.findById(job.id)).toMatchObject({ status: 'cancelled' })
    })

    it('works for a job that never started, where there is no worker to tell', async () => {
      const job = await scheduler.enqueue('sleep', {})
      await runner.start()
      await runner.cancel(job.id)

      expect(await jobs.findById(job.id)).toMatchObject({ status: 'cancelled' })
    })

    /**
     * A cancelled job's worker still reports the abort as an error. Recording it would put
     * the job back on the retry ladder the user just took it off.
     */
    it('ignores the error the aborted worker sends back afterwards', async () => {
      const job = await scheduler.enqueue('sleep', {})
      await runner.start()
      await settle()
      await runner.cancel(job.id)

      pool.fromWorker('w0', {
        type: 'error',
        jobId: job.id,
        message: 'The job was cancelled',
        cancelled: true,
      })
      await settle()

      expect(await jobs.findById(job.id)).toMatchObject({ status: 'cancelled' })
    })

    /**
     * The bug this exists to prevent: `cancel` suppresses the abort message the worker sends
     * back, and if that suppression outlived the cancellation, a retried job could never be
     * recorded as failed again — it would sit `running` with a stale lease until the next
     * app restart, showing a stuck bar in the tray.
     */
    it('lets a retried job fail again', async () => {
      const job = await scheduler.enqueue('sleep', {})
      await runner.start()
      await settle()
      await runner.cancel(job.id)

      pool.finish(job.id)
      await runner.retry(job.id)
      await settle()

      pool.fromWorker('w0', {
        type: 'error',
        jobId: job.id,
        message: 'boom',
        cancelled: false,
      })
      await settle()

      expect(await jobs.findById(job.id)).toMatchObject({ status: 'queued', error: 'boom' })
    })

    it('lets a job that ran again after a cancellation fail on its own', async () => {
      const job = await scheduler.enqueue('sleep', {}, { maxAttempts: 1 })
      await runner.start()
      await settle()
      await runner.cancel(job.id)
      pool.finish(job.id)

      // Re-queued by a retry, claimed again, and this time it genuinely fails.
      await runner.retry(job.id)
      await settle()
      pool.fromWorker('w0', {
        type: 'error',
        jobId: job.id,
        message: 'still broken',
        cancelled: false,
      })
      await settle()

      expect((await jobs.findById(job.id))?.error).toBe('still broken')
    })

    it('does not re-queue a cancelled job when its worker is then killed', async () => {
      const job = await scheduler.enqueue('sleep', {})
      await runner.start()
      await settle()
      await runner.cancel(job.id)

      pool.handlers().onWorkerLost('w0', job.id, 'worker exited with code null')
      await settle()

      expect(await jobs.findById(job.id)).toMatchObject({ status: 'cancelled' })
    })
  })

  it('retries a failed job and starts it again', async () => {
    const job = await scheduler.enqueue('sleep', {}, { maxAttempts: 1 })
    await runner.start()
    await settle()
    pool.fromWorker('w0', {
      type: 'error',
      jobId: job.id,
      message: 'boom',
      cancelled: false,
    })
    await settle()
    expect(await jobs.findById(job.id)).toMatchObject({ status: 'failed' })

    pool.finish(job.id)
    await runner.retry(job.id)
    await settle()

    expect(await jobs.findById(job.id)).toMatchObject({ status: 'running', attempts: 1 })
  })

  it('ignores a worker speaking about a job it was not given', async () => {
    const job = await scheduler.enqueue('sleep', {})
    await runner.start()
    await settle()

    // The pool reports the job it actually dispatched; the message names another. Acting on
    // it would let one worker mark any job in the queue succeeded.
    pool.fromWorkerClaiming(
      'w0',
      { type: 'done', jobId: job.id, result: { forged: true } },
      'j-other',
    )
    await settle()

    expect((await jobs.findById(job.id))?.status).toBe('running')
  })

  it('does not claim for a worker that is on its way out', async () => {
    await scheduler.enqueue('sleep', {})
    await runner.start()
    await settle()
    pool.dispatched.length = 0

    // Both slots retiring: claiming for one would take the job out of the queue only for
    // `dispatch` to refuse it, burning an attempt on every recycle.
    pool.retireAll()
    await scheduler.enqueue('sleep', {})
    runner.kick()
    await settle()

    expect(pool.dispatched).toEqual([])
    expect((await scheduler.listByStatus('queued')).length).toBeGreaterThan(0)
  })

  describe('progress', () => {
    it('pushes the first update straight through to the renderer', async () => {
      const job = await scheduler.enqueue('hashFile', {})
      await runner.start()
      await settle()
      events.length = 0

      pool.fromWorker('w0', {
        type: 'progress',
        jobId: job.id,
        value: 0.25,
        message: '25/100 bytes',
      })
      await settle()

      expect(events).toEqual([
        {
          id: job.id,
          kind: 'hashFile',
          status: 'running',
          progress: 0.25,
          message: '25/100 bytes',
          error: null,
        },
      ])
    })

    it('persists progress far less often than it pushes it', async () => {
      const job = await scheduler.enqueue('hashFile', {})
      await runner.start()
      await settle()

      const persist = vi.spyOn(scheduler, 'reportProgress')
      for (let step = 1; step <= 20; step += 1) {
        pool.fromWorker('w0', {
          type: 'progress',
          jobId: job.id,
          value: step / 20,
          message: null,
        })
      }
      await settle()

      // A database write per tick would be pure amplification: nothing reads the column
      // until the next `jobs.list`.
      expect(persist.mock.calls.length).toBeLessThan(20)
    })

    it('ignores progress for a job it is not running', async () => {
      await runner.start()
      events.length = 0

      pool.fromWorker('w0', {
        type: 'progress',
        jobId: 'not-a-job',
        value: 0.5,
        message: null,
      })
      await settle()

      expect(events).toEqual([])
    })

    it('always emits a terminal status, so the tray never keeps a stale bar', async () => {
      const job = await scheduler.enqueue('sleep', {})
      await runner.start()
      await settle()

      pool.fromWorker('w0', { type: 'done', jobId: job.id, result: null })
      await settle()

      expect(events.at(-1)).toMatchObject({ id: job.id, status: 'succeeded' })
    })
  })
})
