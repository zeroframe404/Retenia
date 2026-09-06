import type { JobContext } from '@retenia/core'
import { describe, expect, it, vi } from 'vitest'
import { createDownloadModelJob } from './model-download'

/**
 * The queue-facing half of the model download (sub-phase 6.3). The transfer itself is tested
 * against a fake server in `packages/ingest/src/models/download.test.ts`; what is here is the
 * job contract: what it accepts, what it refuses, and where its progress goes.
 */

const ROOTS = ['/userData/blobs', '/userData/models']
const MODELS = '/userData/models'

function context(): JobContext & { readonly reports: [number, string | undefined][] } {
  const reports: [number, string | undefined][] = []
  return {
    jobId: 'job-1',
    progress: (value, message) => reports.push([value, message]),
    signal: { aborted: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reports,
  }
}

describe('the downloadModel job', () => {
  const job = createDownloadModelJob(MODELS, ROOTS)

  it('is registered under the kind the service enqueues', () => {
    expect(job.type).toBe('downloadModel')
  })

  it('allows more attempts than the queue’s default', () => {
    // A 300–570 MB transfer meets a closed laptop lid far more often than a CPU-bound job
    // does, and each retry resumes at the next file rather than starting over.
    expect(job.defaultMaxAttempts).toBeGreaterThan(3)
  })

  it('accepts a model id, with or without the verify flag', () => {
    expect(job.parseInput({ modelId: 'embeddinggemma-300m' })).toEqual({
      modelId: 'embeddinggemma-300m',
    })
    expect(job.parseInput({ modelId: 'bge-m3', verify: true })).toEqual({
      modelId: 'bge-m3',
      verify: true,
    })
  })

  it('refuses a payload that is not a model id', () => {
    // A job payload is persisted data, no more trustworthy than whoever wrote it.
    expect(() => job.parseInput({})).toThrow(/non-empty string "modelId"/)
    expect(() => job.parseInput({ modelId: '' })).toThrow(/non-empty string "modelId"/)
    expect(() => job.parseInput({ modelId: 42 as unknown as string })).toThrow(/modelId/)
    expect(() => job.parseInput({ modelId: 'bge-m3', verify: 'yes' })).toThrow(/boolean "verify"/)
  })

  it('fails clearly for a model this build does not have', async () => {
    await expect(job.run({ modelId: 'not-in-the-catalog' }, context())).rejects.toThrow(
      /No model "not-in-the-catalog"/,
    )
  })
})
