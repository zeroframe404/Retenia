import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/** The persisted job queue (`docs/spec/07-architecture.md` §7). The worker pool that
 *  drives it is sub-phase 3.4; what matters here is that the claim is atomic. */
export function jobsContract(harness: RepositoryContractHarness): void {
  describe('job queue', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('queues a job ready to run now', async () => {
      const job = await ctx.repos.jobs.enqueue('ingest', { sourceId: 'abc' })
      expect(job).toMatchObject({ kind: 'ingest', status: 'queued', attempts: 0 })
      expect(job.payload).toEqual({ sourceId: 'abc' })
    })

    it('claims the job and marks it running', async () => {
      await ctx.repos.jobs.enqueue('ingest', {})
      const claimed = await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      expect(claimed).toMatchObject({ status: 'running', lockedBy: 'worker-1', attempts: 1 })
    })

    it('never hands the same job to two workers', async () => {
      await ctx.repos.jobs.enqueue('ingest', {})
      const first = await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      const second = await ctx.repos.jobs.claim('worker-2', ctx.clock.now())
      expect(first).toBeDefined()
      expect(second).toBeUndefined()
    })

    it('claims the highest priority first', async () => {
      await ctx.repos.jobs.enqueue('low', {}, { priority: 0 })
      await ctx.repos.jobs.enqueue('high', {}, { priority: 10 })
      const claimed = await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      expect(claimed?.kind).toBe('high')
    })

    it('does not claim a job scheduled for later', async () => {
      await ctx.repos.jobs.enqueue(
        'later',
        {},
        {
          runAfter: new Date(ctx.clock.now().getTime() + 60_000),
        },
      )
      expect(await ctx.repos.jobs.claim('worker-1', ctx.clock.now())).toBeUndefined()

      ctx.clock.advance(60_000)
      expect(await ctx.repos.jobs.claim('worker-1', ctx.clock.now())).toBeDefined()
    })

    it('restricts a claim to the kinds a worker handles', async () => {
      await ctx.repos.jobs.enqueue('transcribe', {})
      expect(await ctx.repos.jobs.claim('worker-1', ctx.clock.now(), ['embed'])).toBeUndefined()
      expect(await ctx.repos.jobs.claim('worker-1', ctx.clock.now(), ['transcribe'])).toBeDefined()
    })

    it('returns the live job instead of queueing a duplicate idempotency key', async () => {
      const first = await ctx.repos.jobs.enqueue('ingest', {}, { idempotencyKey: 'source:1' })
      const second = await ctx.repos.jobs.enqueue('ingest', {}, { idempotencyKey: 'source:1' })
      expect(second.id).toBe(first.id)
      expect(await ctx.countRows('jobs')).toBe(1)
    })

    it('records success with its result', async () => {
      const job = await ctx.repos.jobs.enqueue('ingest', {})
      await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      const done = await ctx.repos.jobs.succeed(job.id, { chunks: 42 }, ctx.clock.now())
      expect(done).toMatchObject({ status: 'succeeded', lockedBy: null })
      expect(done.result).toEqual({ chunks: 42 })
    })

    it('re-queues a failure while attempts remain', async () => {
      const job = await ctx.repos.jobs.enqueue('ingest', {}, { maxAttempts: 3 })
      await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      const retryAt = new Date(ctx.clock.now().getTime() + 120_000)
      const failed = await ctx.repos.jobs.fail(job.id, 'ffmpeg exited 1', ctx.clock.now(), retryAt)
      expect(failed).toMatchObject({ status: 'queued', error: 'ffmpeg exited 1' })
      expect(failed.runAfter.getTime()).toBe(retryAt.getTime())
    })

    it('gives up once the attempts are spent', async () => {
      const job = await ctx.repos.jobs.enqueue('ingest', {}, { maxAttempts: 1 })
      await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      const failed = await ctx.repos.jobs.fail(
        job.id,
        'permanent',
        ctx.clock.now(),
        new Date(ctx.clock.now().getTime() + 1000),
      )
      expect(failed.status).toBe('failed')
    })

    it('fails for good when no retry is offered', async () => {
      const job = await ctx.repos.jobs.enqueue('ingest', {})
      await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      const failed = await ctx.repos.jobs.fail(job.id, 'fatal', ctx.clock.now())
      expect(failed).toMatchObject({ status: 'failed', finishedAt: expect.any(Date) })
    })

    it('re-queues jobs a dead process left running', async () => {
      await ctx.repos.jobs.enqueue('ingest', {})
      await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      ctx.clock.advance(600_000)

      const reclaimed = await ctx.repos.jobs.reclaimOrphans(
        new Date(ctx.clock.now().getTime() - 300_000),
        ctx.clock.now(),
      )
      expect(reclaimed).toBe(1)
      expect(await ctx.repos.jobs.claim('worker-2', ctx.clock.now())).toBeDefined()
    })

    it('leaves a job with a fresh heartbeat alone', async () => {
      await ctx.repos.jobs.enqueue('ingest', {})
      const claimed = await ctx.repos.jobs.claim('worker-1', ctx.clock.now())
      if (claimed === undefined) throw new Error('expected a claim')
      ctx.clock.advance(600_000)
      await ctx.repos.jobs.heartbeat(claimed.id, ctx.clock.now())

      const reclaimed = await ctx.repos.jobs.reclaimOrphans(
        new Date(ctx.clock.now().getTime() - 300_000),
        ctx.clock.now(),
      )
      expect(reclaimed).toBe(0)
    })

    it('counts by status with every status present', async () => {
      await ctx.repos.jobs.enqueue('a', {})
      await ctx.repos.jobs.enqueue('b', {})
      await ctx.repos.jobs.claim('worker-1', ctx.clock.now())

      expect(await ctx.repos.jobs.countByStatus()).toEqual({
        queued: 1,
        running: 1,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      })
    })

    it('reports progress for the processing panel', async () => {
      const job = await ctx.repos.jobs.enqueue('ingest', {})
      await ctx.repos.jobs.reportProgress(job.id, { done: 3, total: 10 })
      expect((await ctx.repos.jobs.findById(job.id))?.progress).toEqual({ done: 3, total: 10 })
    })
  })
}
