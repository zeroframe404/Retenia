import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import { JOB_STATUSES, jobSummarySchema } from './jobs'

/** A valid summary, for tests that mutate one field at a time. */
const summary = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'hashFile',
  status: 'running' as const,
  priority: 0,
  progress: 0.5,
  progressMessage: 'hashing',
  attempts: 1,
  maxAttempts: 3,
  error: null,
  subjectId: null,
  result: null,
  runAfter: '2026-09-02T00:00:00.000Z',
  createdAt: '2026-09-02T00:00:00.000Z',
  startedAt: '2026-09-02T00:00:00.000Z',
  finishedAt: null,
}

describe('job status vocabulary', () => {
  /**
   * The five statuses exist in three places — here, `packages/core`'s `JOB_STATUSES`, and
   * the `CHECK` constraint `packages/db` builds — because the architecture forbids this
   * leaf package from importing either of the others. Three copies is a drift hazard, so
   * this is the assertion that catches it. `packages/db` has the matching parity test on
   * its own side.
   */
  it('matches the domain vocabulary the database enforces', () => {
    expect([...JOB_STATUSES]).toEqual(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
  })
})

describe('jobs.list', () => {
  const { input, output } = contract['jobs.list']

  it('defaults both filters to the handler, which knows what the tray wants', () => {
    expect(input.parse({})).toEqual({})
  })

  it('accepts a status filter and a limit', () => {
    expect(input.parse({ statuses: ['queued', 'running'], limit: 20 })).toEqual({
      statuses: ['queued', 'running'],
      limit: 20,
    })
  })

  it('rejects an empty status filter, which would silently mean "nothing"', () => {
    expect(input.safeParse({ statuses: [] }).success).toBe(false)
  })

  it('rejects a status nobody has', () => {
    expect(input.safeParse({ statuses: ['paused'] }).success).toBe(false)
  })

  it('caps the limit so one call cannot drag the whole table across the bridge', () => {
    expect(input.safeParse({ limit: 201 }).success).toBe(false)
    expect(input.safeParse({ limit: 0 }).success).toBe(false)
  })

  it('accepts a well-formed summary', () => {
    expect(output.safeParse({ jobs: [summary] }).success).toBe(true)
  })
})

describe('jobSummarySchema', () => {
  it('keeps progress a fraction, not a percentage', () => {
    expect(jobSummarySchema.safeParse({ ...summary, progress: 50 }).success).toBe(false)
    expect(jobSummarySchema.safeParse({ ...summary, progress: 1 }).success).toBe(true)
    expect(jobSummarySchema.safeParse({ ...summary, progress: null }).success).toBe(true)
  })

  it('requires real timestamps', () => {
    expect(jobSummarySchema.safeParse({ ...summary, createdAt: 'yesterday' }).success).toBe(false)
  })

  it('never carries the payload', () => {
    const parsed = jobSummarySchema.parse({ ...summary, payload: { secret: 'value' } })
    expect(parsed).not.toHaveProperty('payload')
  })
})

describe('jobs.enqueueDemo', () => {
  const { input, output } = contract['jobs.enqueueDemo']

  it('takes a duration for sleep', () => {
    expect(input.parse({ kind: 'sleep', ms: 500 })).toEqual({ kind: 'sleep', ms: 500 })
  })

  it('takes nothing but the kind for hashFile — main chooses the file, not the renderer', () => {
    expect(input.parse({ kind: 'hashFile' })).toEqual({ kind: 'hashFile' })
    const parsed = input.parse({ kind: 'hashFile', path: '/etc/passwd' } as never)
    expect(parsed).not.toHaveProperty('path')
  })

  it('refuses a kind that is not one of the demos', () => {
    expect(input.safeParse({ kind: 'ingest' }).success).toBe(false)
  })

  it('bounds the sleep so a typo cannot pin a worker for an hour', () => {
    expect(input.safeParse({ kind: 'sleep', ms: 120_001 }).success).toBe(false)
    expect(input.safeParse({ kind: 'sleep', ms: -1 }).success).toBe(false)
  })

  it('resolves nulls when the build refuses to queue anything', () => {
    expect(output.parse({ job: null, subject: null })).toEqual({ job: null, subject: null })
  })
})

describe('jobs.cancel and jobs.retry', () => {
  it.each(['jobs.cancel', 'jobs.retry'] as const)('%s takes a job id', (channel) => {
    const { input } = contract[channel]
    expect(input.safeParse({ id: summary.id }).success).toBe(true)
    expect(input.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
  })
})
