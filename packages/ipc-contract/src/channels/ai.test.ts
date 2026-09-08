import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import { AI_BATCH_STATUSES, aiBatchSummarySchema } from './ai'

/** A valid summary, for tests that mutate one field at a time. */
const summary = {
  id: '019213cd-0000-7000-8000-000000000001',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  purpose: 'expand_lesson',
  status: 'in_progress' as const,
  requestCount: 38,
  succeededCount: 12,
  failedCount: 0,
  costEstimateUsd: 1.1,
  costUsd: 0.34,
  submittedAt: '2026-09-08T12:00:00.000Z',
  completedAt: null,
  error: null,
}

describe('batch status vocabulary', () => {
  /**
   * The six statuses exist in three places — here, `packages/core`'s `AI_BATCH_STATUSES` and
   * the `CHECK` constraint `packages/db` builds — because the architecture forbids this leaf
   * package from importing either of the others. Three copies is a drift hazard; this is the
   * assertion that catches it, with the matching parity test on `packages/db`'s side.
   */
  it('matches the domain vocabulary the database enforces', () => {
    expect([...AI_BATCH_STATUSES]).toEqual([
      'submitting',
      'submitted',
      'in_progress',
      'completed',
      'failed',
      'cancelled',
    ])
  })
})

describe('ai.listBatches', () => {
  const { input, output } = contract['ai.listBatches']

  it('takes no filter: the tray wants exactly what is in flight', () => {
    expect(input.parse({})).toEqual({})
  })

  it('accepts a well-formed summary', () => {
    expect(output.safeParse({ batches: [summary] }).success).toBe(true)
  })
})

describe('aiBatchSummarySchema', () => {
  it('never carries the provider job id across the bridge', () => {
    // An account-scoped handle the renderer cannot act on and has no use for; batches are
    // addressed by *our* id everywhere above main.
    const parsed = aiBatchSummarySchema.parse({ ...summary, providerBatchId: 'msgbatch_01' })
    expect(parsed).not.toHaveProperty('providerBatchId')
  })

  it('refuses negative counts and costs', () => {
    expect(aiBatchSummarySchema.safeParse({ ...summary, requestCount: -1 }).success).toBe(false)
    expect(aiBatchSummarySchema.safeParse({ ...summary, costUsd: -0.01 }).success).toBe(false)
  })

  it('requires real timestamps', () => {
    expect(aiBatchSummarySchema.safeParse({ ...summary, submittedAt: 'soon' }).success).toBe(false)
    expect(aiBatchSummarySchema.safeParse({ ...summary, submittedAt: null }).success).toBe(true)
  })

  it('refuses a status nobody has', () => {
    expect(aiBatchSummarySchema.safeParse({ ...summary, status: 'paused' }).success).toBe(false)
  })
})

describe('ai.cancelBatch', () => {
  const { input, output } = contract['ai.cancelBatch']

  it('takes a batch id', () => {
    expect(input.safeParse({ id: summary.id }).success).toBe(true)
    expect(input.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
  })

  it('resolves null for a batch that is no longer there', () => {
    expect(output.parse(null)).toBeNull()
  })
})
