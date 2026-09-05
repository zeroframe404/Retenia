import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createJobRegistry,
  createJobScheduler,
  type EntityPatch,
  type Job,
  type JobScheduler,
  type ListOptions,
  type NewEntity,
  registerJob,
  type Source,
} from '@retenia/core'
import { createInMemoryJobRepository, fakeClock, fakeLiveness } from '@retenia/core/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFsBlobStore } from '../blobs/store'
import { createLibraryService, type LibraryService } from './service'

/** Just enough of `SourceRepository` for this service — an in-memory `Map`, not a fake worth
 *  sharing: no contract test exercises it, since the real SQLite implementation already has
 *  one (`packages/db/src/repositories/contracts.test.ts`). */
function createInMemorySourceRepository() {
  const rows = new Map<string, Source>()
  let counter = 0
  const nextId = () => {
    counter += 1
    return `source-${counter}`
  }

  return {
    rows,
    create: async (input: NewEntity<Source>): Promise<Source> => {
      const id = input.id ?? nextId()
      const now = new Date()
      const source: Source = {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deviceId: 'test-device',
        version: 1,
      }
      rows.set(id, source)
      return source
    },
    update: async (id: string, patch: EntityPatch<Source>): Promise<Source> => {
      const existing = rows.get(id)
      if (existing === undefined) throw new Error(`No source ${id}`)
      const updated: Source = {
        ...existing,
        ...patch,
        updatedAt: new Date(),
        version: existing.version + 1,
      }
      rows.set(id, updated)
      return updated
    },
    findById: async (id: string) => rows.get(id),
    findMany: async (ids: readonly string[]) => ids.flatMap((id) => rows.get(id) ?? []),
    list: async (_options?: ListOptions) => [...rows.values()],
    listByStatus: async (status: Source['status']) =>
      [...rows.values()].filter((s) => s.status === status),
    count: async () => rows.size,
    findByBlobSha256: async (sha256: string) =>
      [...rows.values()].find((s) => s.blobSha256 === sha256),
    markIngested: async (id: string, at: Date) => {
      const existing = rows.get(id)
      if (existing === undefined) throw new Error(`No source ${id}`)
      const updated: Source = {
        ...existing,
        status: 'ready',
        ingestedAt: at,
        error: null,
        updatedAt: at,
      }
      rows.set(id, updated)
      return updated
    },
    markFailed: async (id: string, message: string) => {
      const existing = rows.get(id)
      if (existing === undefined) throw new Error(`No source ${id}`)
      const updated: Source = {
        ...existing,
        status: 'failed',
        error: message,
        updatedAt: new Date(),
      }
      rows.set(id, updated)
      return updated
    },
    softDelete: async (id: string) => {
      const existing = rows.get(id)
      if (existing !== undefined) rows.set(id, { ...existing, deletedAt: new Date() })
    },
    restore: async () => {
      throw new Error('not used by this test')
    },
    save: async () => {
      throw new Error('not used by this test')
    },
    findUnit: async () => {
      throw new Error('not used by this test')
    },
    listUnits: async () => {
      throw new Error('not used by this test')
    },
    createUnit: async () => {
      throw new Error('not used by this test')
    },
    replaceUnits: async () => {
      throw new Error('not used by this test')
    },
  }
}

const registry = createJobRegistry([
  registerJob({
    type: 'ingestParseSource',
    parseInput: (payload) => payload,
    run: async () => null,
  }),
])

describe('LibraryService', () => {
  let dir: string
  let sources: ReturnType<typeof createInMemorySourceRepository>
  let scheduler: JobScheduler
  let service: LibraryService

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'retenia-library-')))
    sources = createInMemorySourceRepository()
    const clock = fakeClock()
    scheduler = createJobScheduler({
      jobs: createInMemoryJobRepository(clock),
      clock,
      liveness: fakeLiveness(),
      registry,
      runId: 'run-under-test',
    })
    service = createLibraryService({
      // Only `sources` is exercised; the rest of `Repositories` is never read.
      repos: { sources } as never,
      blobStore: createFsBlobStore(dir),
      scheduler,
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('adding text creates a pending source and enqueues its parse with the source as subject', async () => {
    const source = await service.addFromText('# Cells\n\nBasic units of life.', 'Cells.md')

    expect(source.kind).toBe('text')
    expect(source.status).toBe('pending')
    expect(source.blobSha256).toMatch(/^[0-9a-f]{64}$/)

    const active = await scheduler.listActive()
    expect(active).toHaveLength(1)
    expect(active[0]?.kind).toBe('ingestParseSource')
    expect(active[0]?.subjectId).toBe(source.id)
  })

  it('rejects an unsupported file extension', async () => {
    await expect(service.addFromFile('/tmp/whatever.exe')).rejects.toThrow(
      /not a supported file type/,
    )
  })

  it('applies a succeeded parse job onto the source', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    const job: Job = {
      id: 'job-1',
      kind: 'ingestParseSource',
      status: 'succeeded',
      priority: 0,
      payload: {},
      result: {
        sourceDocBlobSha256: 'a'.repeat(64),
        title: 'notes.txt',
        language: 'en',
        blockCount: 3,
        assetCount: 0,
        needsOcr: false,
        ocrPages: [],
        warnings: [],
      },
      progress: null,
      attempts: 1,
      maxAttempts: 3,
      runAfter: new Date(),
      lockedBy: null,
      lockedAt: null,
      startedAt: new Date(),
      finishedAt: new Date(),
      error: null,
      parentJobId: null,
      subjectId: source.id,
      idempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      deviceId: 'test-device',
      version: 1,
    }

    await service.onJobSettled(job)

    const updated = await service.get(source.id)
    expect(updated?.status).toBe('ready')
    expect(updated?.language).toBe('en')
    expect(updated?.meta).toMatchObject({ sourceDocBlobSha256: 'a'.repeat(64), blockCount: 3 })
  })

  it('marks the source failed when its parse job fails', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    await service.onJobSettled({
      ...(await scheduler.find((await scheduler.listActive())[0]?.id ?? '')),
      kind: 'ingestParseSource',
      status: 'failed',
      error: 'boom',
      subjectId: source.id,
    } as Job)

    const updated = await service.get(source.id)
    expect(updated?.status).toBe('failed')
    expect(updated?.error).toBe('boom')
  })

  it('ignores a settled job that is not one of its own', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    await service.onJobSettled({
      id: 'other',
      kind: 'fsrsOptimize',
      status: 'succeeded',
      subjectId: source.id,
      result: null,
      error: null,
    } as Job)

    const untouched = await service.get(source.id)
    expect(untouched?.status).toBe('pending')
  })
})
