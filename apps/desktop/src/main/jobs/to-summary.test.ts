import type { Job } from '@retenia/core'
import { jobSummarySchema } from '@retenia/ipc-contract'
import { describe, expect, it } from 'vitest'
import { toJobSummary } from './to-summary'

const at = new Date('2026-09-02T00:00:00.000Z')

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: '019213cd-0000-7000-8000-000000000001',
    kind: 'hashFile',
    status: 'running',
    priority: 0,
    payload: { path: '/userData/secret.pdf' },
    result: null,
    progress: null,
    attempts: 1,
    maxAttempts: 3,
    runAfter: at,
    lockedBy: 'pid:4242:w0',
    lockedAt: at,
    startedAt: at,
    finishedAt: null,
    error: null,
    parentJobId: null,
    subjectId: null,
    idempotencyKey: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deviceId: 'test-device',
    version: 1,
    ...overrides,
  }
}

describe('toJobSummary', () => {
  it('produces something the contract accepts', () => {
    expect(jobSummarySchema.safeParse(toJobSummary(job())).success).toBe(true)
  })

  it('never sends the payload or the lease across the bridge', () => {
    const summary = toJobSummary(job()) as Record<string, unknown>
    expect(summary).not.toHaveProperty('payload')
    expect(summary).not.toHaveProperty('lockedBy')
    expect(summary).not.toHaveProperty('lockedAt')
    expect(summary).not.toHaveProperty('deviceId')
  })

  it('renders dates as ISO strings, nulls included', () => {
    const summary = toJobSummary(job())
    expect(summary.createdAt).toBe('2026-09-02T00:00:00.000Z')
    expect(summary.startedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(summary.finishedAt).toBeNull()
  })

  it('flattens the stored progress object into a fraction and a message', () => {
    const summary = toJobSummary(job({ progress: { value: 0.25, message: 'reading' } }))
    expect(summary.progress).toBe(0.25)
    expect(summary.progressMessage).toBe('reading')
  })

  it('reads a job that has never reported as having no progress', () => {
    const summary = toJobSummary(job())
    expect(summary.progress).toBeNull()
    expect(summary.progressMessage).toBeNull()
  })

  /** The column is free-form JSON, so a row written by an older build may not match. */
  it('survives a progress object of an unexpected shape', () => {
    const summary = toJobSummary(job({ progress: { percent: 40 } }))
    expect(summary.progress).toBeNull()
    expect(summary.progressMessage).toBeNull()
    expect(jobSummarySchema.safeParse(summary).success).toBe(true)
  })

  it('carries the result and the error through', () => {
    const summary = toJobSummary(
      job({ status: 'failed', error: 'ffmpeg exited 1', result: { sha256: 'abc' } }),
    )
    expect(summary.error).toBe('ffmpeg exited 1')
    expect(summary.result).toEqual({ sha256: 'abc' })
  })
})
