import type { AiBatchRecord } from '@retenia/ai'
import { createManualTimers } from '@retenia/ai/testing'
import { describe, expect, it } from 'vitest'
import { batchPollDelayMs, waitForBatch } from './await-batch'

const NOW = new Date('2026-09-09T12:00:00Z')
const clock = { now: () => NOW }

function record(overrides: Partial<AiBatchRecord>): AiBatchRecord {
  return {
    id: 'batch-1',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    role: 'cheap',
    purpose: 'path_generation',
    stage: 'P1_extract_chunk',
    status: 'in_progress',
    providerBatchId: 'p-1',
    requestCount: 10,
    succeededCount: 0,
    failedCount: 0,
    costEstimateUsd: 0,
    costUsd: 0,
    attempts: 1,
    submittedAt: NOW,
    nextPollAt: null,
    completedAt: null,
    promptVersion: '1',
    schemaVersion: '1',
    error: null,
    createdAt: NOW,
    ...overrides,
  }
}

describe('batchPollDelayMs()', () => {
  it('waits for the runner’s own schedule, plus slack, never under five seconds', () => {
    expect(batchPollDelayMs(record({ nextPollAt: null }), NOW)).toBe(5_000)
    expect(batchPollDelayMs(record({ nextPollAt: new Date(NOW.getTime() + 60_000) }), NOW)).toBe(
      61_000,
    )
    expect(batchPollDelayMs(record({ nextPollAt: new Date(NOW.getTime() - 60_000) }), NOW)).toBe(
      5_000,
    )
  })
})

describe('waitForBatch()', () => {
  it('polls until the batch is terminal, sleeping between polls', async () => {
    const timers = createManualTimers()
    const seen: string[] = []
    const script = [
      record({ status: 'in_progress', nextPollAt: new Date(NOW.getTime() + 10_000) }),
      record({ status: 'in_progress', succeededCount: 5 }),
      record({ status: 'completed', succeededCount: 10 }),
    ]
    let polls = 0
    const runner = {
      list: async () => [script[0] as AiBatchRecord],
      poll: async () => {
        polls += 1
        return script[polls]
      },
    }
    const final = await waitForBatch('batch-1', {
      runner,
      clock,
      timers,
      onPoll: (batch) => seen.push(`${batch.status}:${batch.succeededCount}`),
    })
    expect(final?.status).toBe('completed')
    expect(polls).toBe(2)
    expect(timers.slept).toEqual([11_000, 5_000])
    expect(seen).toEqual(['in_progress:0', 'in_progress:5'])
  })

  it('starts from the record it is given and returns at once when it is terminal', async () => {
    const timers = createManualTimers()
    const runner = {
      list: async () => {
        throw new Error('not consulted')
      },
      poll: async () => {
        throw new Error('not polled')
      },
    }
    const done = record({ status: 'completed' })
    expect(await waitForBatch('batch-1', { runner, clock, timers }, done)).toBe(done)
    expect(timers.slept).toEqual([])
  })

  it('polls once for a batch the runner no longer lists, and gives up on an unknown one', async () => {
    const timers = createManualTimers()
    const done = record({ status: 'cancelled' })
    const runner = { list: async () => [], poll: async () => done }
    expect(await waitForBatch('batch-1', { runner, clock, timers })).toBe(done)

    const unknown = { list: async () => [], poll: async () => undefined }
    expect(await waitForBatch('batch-9', { runner: unknown, clock, timers })).toBeUndefined()
  })

  it('returns the last record seen when the caller cancels while waiting', async () => {
    const signal = { aborted: false }
    const timers = {
      sleep: async () => {
        signal.aborted = true
      },
    }
    const pending = record({ status: 'in_progress' })
    let polls = 0
    const runner = {
      list: async () => [pending],
      poll: async () => {
        polls += 1
        return pending
      },
    }
    expect(await waitForBatch('batch-1', { runner, clock, timers, signal })).toBe(pending)
    expect(polls).toBe(0)

    const early = { aborted: true }
    expect(await waitForBatch('batch-1', { runner, clock, timers, signal: early })).toBe(pending)
  })
})
