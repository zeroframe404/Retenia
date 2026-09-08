import type { AiCall, NewEntity } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, TEST_DEVICE_ID, testClock, testIds } from '../testing'
import { createAiCallRepository } from './ai-calls'
import type { RepositoryContext } from './context'
import { disabledOutboxWriter } from './outbox-writer'
import { createTransactionRunner } from './transaction'

/**
 * The cost log's read side, which sub-phase 7.1 is the first writer of.
 *
 * Two behaviours matter beyond CRUD, and both are load-bearing for the budget: a `custom_id`
 * is now shared by several rows (every attempt of one logical call), and a failed attempt
 * that burned tokens must count toward the month.
 */

let opened: OpenedDatabase
let clock: ReturnType<typeof testClock>
let repo: ReturnType<typeof createAiCallRepository>

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

function call(over: Partial<NewEntity<AiCall>> = {}): NewEntity<AiCall> {
  return {
    provider: 'google',
    model: 'gemini-3.7-flash',
    role: 'cheap',
    purpose: 'contextualize',
    status: 'ok',
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.001,
    latencyMs: 120,
    batchId: null,
    customId: null,
    promptVersion: null,
    schemaVersion: null,
    temperature: 0,
    jobId: null,
    error: null,
    meta: null,
    ...over,
  }
}

beforeEach(() => {
  opened = openTestDatabase()
  clock = testClock()
  repo = createAiCallRepository(context())
})

afterEach(() => {
  opened.sqlite.close()
})

describe('findByCustomId', () => {
  it('returns the first attempt when several rows share a key', async () => {
    // Retries and fallbacks of one logical unit of work carry the caller's idempotency key,
    // so this stopped being a lookup of one row in 7.1. SQLite does not promise index order
    // is insertion order, so 7.3's batch resumption could otherwise read the second attempt.
    const key = 'contextualize:1:src-1:chunk-7'
    const first = await repo.record(call({ customId: key, status: 'error', costUsd: 0 }))
    clock.advance(50)
    await repo.record(call({ customId: key, provider: 'anthropic', model: 'claude-haiku-4-5' }))

    const found = await repo.findByCustomId(key)
    expect(found?.id).toBe(first.id)
    expect(found?.status).toBe('error')
  })

  it('is undefined for a key nobody used', async () => {
    await expect(repo.findByCustomId('nope')).resolves.toBeUndefined()
  })
})

describe('sumCost', () => {
  it('counts a failed attempt that still burned tokens', async () => {
    // This is what makes per-attempt rows correct for free: `costPredicate` has no status
    // filter, so an honest cost on an error row lands in the month's total.
    await repo.record(call({ status: 'error', costUsd: 0.003, error: 'overloaded' }))
    await repo.record(call({ costUsd: 0.002 }))
    await expect(repo.sumCost({ from: new Date(0) })).resolves.toBeCloseTo(0.005, 9)
  })

  it('excludes the previous month by a millisecond, and includes this one', async () => {
    // The test clock starts at 2026-09-02 and only moves when told, so the boundary is
    // built relative to it rather than to a wall clock.
    const boundary = new Date(clock.nowMs())
    const before = createAiCallRepository({
      db: opened.db,
      clock: { now: () => new Date(boundary.getTime() - 1) },
      ids: testIds(clock),
      deviceId: TEST_DEVICE_ID,
      outbox: disabledOutboxWriter,
      run: createTransactionRunner(opened, { depth: 0 }),
    })
    await before.record(call({ costUsd: 99 }))
    await repo.record(call({ costUsd: 1 }))

    await expect(repo.sumCost({ from: boundary })).resolves.toBeCloseTo(1, 9)
  })
})

describe('costByPurpose', () => {
  it('groups by feature and provider, with a call count', async () => {
    await repo.record(call({ purpose: 'contextualize', costUsd: 0.01 }))
    await repo.record(call({ purpose: 'contextualize', costUsd: 0.02 }))
    await repo.record(call({ purpose: 'grade_long_text', provider: 'anthropic', costUsd: 0.05 }))

    const rows = await repo.costByPurpose({ from: new Date(0) })
    expect(rows).toEqual([
      { purpose: 'grade_long_text', provider: 'anthropic', costUsd: 0.05, calls: 1 },
      { purpose: 'contextualize', provider: 'google', costUsd: expect.closeTo(0.03, 9), calls: 2 },
    ])
  })

  it('totals to the same number sumCost reports over the same window', async () => {
    for (const [purpose, provider, costUsd] of [
      ['contextualize', 'google', 0.011],
      ['contextualize', 'anthropic', 0.022],
      ['tutor', 'google', 0.033],
    ] as const) {
      await repo.record(call({ purpose, provider, costUsd }))
    }
    const window = { from: new Date(0) }
    const grouped = (await repo.costByPurpose(window)).reduce((sum, r) => sum + r.costUsd, 0)
    await expect(repo.sumCost(window)).resolves.toBeCloseTo(grouped, 9)
  })

  it('is empty rather than undefined when nothing was spent', async () => {
    await expect(repo.costByPurpose({ from: new Date(0) })).resolves.toEqual([])
  })
})
