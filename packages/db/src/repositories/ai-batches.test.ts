import type { AiBatch, NewEntity } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, TEST_DEVICE_ID, testClock, testIds } from '../testing'
import { createAiBatchRepository } from './ai-batches'
import type { RepositoryContext } from './context'
import { disabledOutboxWriter } from './outbox-writer'
import { createTransactionRunner } from './transaction'

/**
 * `ai_batches`, and the one property the whole feature rests on: **a batch outlives the
 * process that submitted it**.
 *
 * The acceptance criterion of sub-phase 7.3 is that killing the app mid-batch and restarting
 * resumes polling, which in storage terms is `listActive()` finding the row with its
 * `provider_batch_id`, its `attempts` and its `next_poll_at` intact.
 */

let opened: OpenedDatabase
let clock: ReturnType<typeof testClock>
let repo: ReturnType<typeof createAiBatchRepository>

function context(): RepositoryContext {
  return {
    db: opened.db,
    clock,
    ids: testIds(clock),
    deviceId: TEST_DEVICE_ID,
    outbox: disabledOutboxWriter,
    run: createTransactionRunner(opened, { depth: 0 }),
  }
}

function batch(over: Partial<NewEntity<AiBatch>> = {}): NewEntity<AiBatch> {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    role: 'smart',
    purpose: 'expand_lesson',
    stage: 'P3_write_lesson',
    status: 'submitting',
    providerBatchId: null,
    requestCount: 38,
    succeededCount: 0,
    failedCount: 0,
    costEstimateUsd: 1.18,
    costUsd: 0,
    attempts: 0,
    submittedAt: null,
    nextPollAt: null,
    completedAt: null,
    promptVersion: '3',
    schemaVersion: 'lesson@1',
    error: null,
    meta: null,
    ...over,
  }
}

beforeEach(() => {
  opened = openTestDatabase()
  clock = testClock()
  repo = createAiBatchRepository(context())
})

afterEach(() => {
  opened.close()
})

describe('createAiBatchRepository', () => {
  it('round-trips every column, timestamps included', async () => {
    const submittedAt = new Date('2026-09-08T12:00:00Z')
    const nextPollAt = new Date('2026-09-08T12:05:00Z')

    const created = await repo.create(
      batch({
        status: 'in_progress',
        providerBatchId: 'msgbatch_01',
        succeededCount: 12,
        costUsd: 0.34,
        attempts: 4,
        submittedAt,
        nextPollAt,
        meta: { pricingRevision: '2026-09-07' },
      }),
    )

    const read = await repo.findById(created.id)
    expect(read).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      role: 'smart',
      purpose: 'expand_lesson',
      stage: 'P3_write_lesson',
      status: 'in_progress',
      providerBatchId: 'msgbatch_01',
      requestCount: 38,
      succeededCount: 12,
      costEstimateUsd: 1.18,
      costUsd: 0.34,
      attempts: 4,
      promptVersion: '3',
      schemaVersion: 'lesson@1',
      meta: { pricingRevision: '2026-09-07' },
    })
    expect(read?.submittedAt?.getTime()).toBe(submittedAt.getTime())
    expect(read?.nextPollAt?.getTime()).toBe(nextPollAt.getTime())
  })

  it('lists exactly the batches still in flight, oldest first', async () => {
    // What `resume()` reads at startup. Ordered oldest first so the batch that has been
    // waiting longest is polled before the one submitted a minute ago.
    const first = await repo.create(batch({ status: 'submitted' }))
    clock.advance(60_000)
    const second = await repo.create(batch({ status: 'in_progress' }))
    clock.advance(60_000)
    await repo.create(batch({ status: 'completed' }))
    await repo.create(batch({ status: 'failed' }))
    await repo.create(batch({ status: 'cancelled' }))

    const active = await repo.listActive()

    expect(active.map((row) => row.id)).toEqual([first.id, second.id])
  })

  it('keeps a submitting row visible, so a crash mid-submission is not silent', async () => {
    // The row is written before the provider is called on purpose. If `listActive` skipped
    // this state, a crash in that window would leave a job that may be running upstream with
    // nothing here that ever looks at it again.
    const created = await repo.create(batch({ status: 'submitting' }))
    expect((await repo.listActive()).map((row) => row.id)).toEqual([created.id])
  })

  it('finds a batch by the id the provider knows it as', async () => {
    await repo.create(batch({ status: 'in_progress', providerBatchId: 'batches/abc' }))
    const found = await repo.findByProviderBatchId('batches/abc')
    expect(found?.providerBatchId).toBe('batches/abc')
    expect(await repo.findByProviderBatchId('batches/nope')).toBeUndefined()
  })

  it('lists finished batches newest first, for the usage history', async () => {
    const older = await repo.create(batch({ status: 'completed' }))
    clock.advance(60_000)
    const newer = await repo.create(batch({ status: 'completed' }))

    expect((await repo.listRecent({ limit: 2 })).map((row) => row.id)).toEqual([newer.id, older.id])
  })

  it('patches only what it is given', async () => {
    // A poll writes four columns; a partial patch that nulled the rest would lose the
    // provider id and leave a running batch impossible to address.
    const created = await repo.create(
      batch({ status: 'submitted', providerBatchId: 'msgbatch_01', submittedAt: new Date(1) }),
    )

    const updated = await repo.update(created.id, { status: 'in_progress', attempts: 3 })

    expect(updated).toMatchObject({
      status: 'in_progress',
      attempts: 3,
      providerBatchId: 'msgbatch_01',
      requestCount: 38,
    })
    expect(updated.submittedAt?.getTime()).toBe(1)
  })

  it('refuses a status the schema does not know', async () => {
    await expect(
      repo.create(batch({ status: 'paused' as unknown as AiBatch['status'] })),
    ).rejects.toThrow()
  })

  it('refuses negative counts and costs', async () => {
    await expect(repo.create(batch({ requestCount: -1 }))).rejects.toThrow()
    await expect(repo.create(batch({ costUsd: -0.01 }))).rejects.toThrow()
  })
})
