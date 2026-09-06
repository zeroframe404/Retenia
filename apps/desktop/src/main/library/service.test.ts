import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type BlobStore,
  type Chunk,
  createJobRegistry,
  createJobScheduler,
  type EntityPatch,
  type Job,
  type JobScheduler,
  type ListOptions,
  type NewEntity,
  registerJob,
  type Source,
  type SourceUnit,
} from '@retenia/core'
import { createInMemoryJobRepository, fakeClock, fakeLiveness } from '@retenia/core/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFsBlobStore } from '../blobs/store'
import {
  ContextualizationUnavailableError,
  createLibraryService,
  type LibraryService,
} from './service'

/** Just enough of `SourceRepository` for this service — an in-memory `Map`, not a fake worth
 *  sharing: no contract test exercises it, since the real SQLite implementation already has
 *  one (`packages/db/src/repositories/contracts.test.ts`). */
function createInMemorySourceRepository() {
  const rows = new Map<string, Source>()
  let units: SourceUnit[] = []
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
    listUnits: async (sourceId: string) => units.filter((u) => u.sourceId === sourceId),
    createUnit: async () => {
      throw new Error('not used by this test')
    },
    replaceUnits: async (sourceId: string, replacements: readonly NewEntity<SourceUnit>[]) => {
      units = units.filter((u) => u.sourceId !== sourceId)
      const written = replacements.map(
        (unit, index): SourceUnit => ({
          ...unit,
          sourceId,
          id: `unit-${sourceId}-${index}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          deviceId: 'test-device',
          version: 1,
        }),
      )
      units.push(...written)
      return written
    },
    units: () => units,
  }
}

/** The chunk half of the store, keyed by `chunk_key` the way the real repository is. */
function createInMemoryChunkRepository() {
  let rows: Chunk[] = []

  const materialize = (input: NewEntity<Chunk>, id: string): Chunk => ({
    ...input,
    id,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deviceId: 'test-device',
    version: 1,
  })

  return {
    rows: () => rows,
    listBySource: async (sourceId: string) =>
      rows.filter((chunk) => chunk.sourceId === sourceId && chunk.deletedAt === null),
    replaceBySource: async (sourceId: string, inputs: readonly NewEntity<Chunk>[]) => {
      const existing = rows.filter((c) => c.sourceId === sourceId && c.deletedAt === null)
      const byKey = new Map(existing.filter((c) => c.chunkKey !== null).map((c) => [c.chunkKey, c]))
      const written = inputs.map((input, index) => {
        const match = input.chunkKey === null ? undefined : byKey.get(input.chunkKey)
        return materialize(input, match?.id ?? `chunk-${sourceId}-${rows.length + index}`)
      })
      const keys = new Set(written.map((c) => c.chunkKey))
      rows = rows
        .map((chunk) =>
          chunk.sourceId === sourceId && !keys.has(chunk.chunkKey)
            ? { ...chunk, deletedAt: new Date() }
            : chunk,
        )
        .filter((chunk) => !(chunk.sourceId === sourceId && keys.has(chunk.chunkKey)))
      rows.push(...written)
      return written
    },
    sourceIdsNeedingRechunk: async (version: string) => [
      ...new Set(
        rows
          .filter((chunk) => chunk.deletedAt === null && chunk.chunkingVersion !== version)
          .map((chunk) => chunk.sourceId),
      ),
    ],
    sourceIdsWithChunks: async () => [
      ...new Set(rows.filter((chunk) => chunk.deletedAt === null).map((chunk) => chunk.sourceId)),
    ],
    setContexts: async (
      sourceId: string,
      contexts: readonly { chunkKey: string; context: string }[],
    ) => {
      const wanted = new Map(contexts.map((entry) => [entry.chunkKey, entry.context]))
      let changed = 0
      rows = rows.map((chunk) => {
        const context = chunk.sourceId === sourceId ? wanted.get(chunk.chunkKey ?? '') : undefined
        if (context === undefined || context === chunk.context) return chunk
        changed += 1
        return { ...chunk, context }
      })
      return changed
    },
  }
}

const registry = createJobRegistry([
  registerJob({
    type: 'ingestParseSource',
    parseInput: (payload) => payload,
    run: async () => null,
  }),
  registerJob({
    type: 'ingestChunkSource',
    parseInput: (payload) => payload,
    run: async () => null,
  }),
])

/** A settled `Job`, with only the fields `onJobSettled` reads filled in for real. */
function settledJob(kind: string, sourceId: string, status: Job['status'], result: unknown): Job {
  const now = new Date()
  return {
    id: `job-${kind}-${sourceId}`,
    kind,
    status,
    priority: 0,
    payload: {},
    result: result as Job['result'],
    progress: null,
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    lockedBy: null,
    lockedAt: null,
    startedAt: now,
    finishedAt: now,
    error: null,
    parentJobId: null,
    subjectId: sourceId,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: 'test-device',
    version: 1,
  }
}

function parseJob(sourceId: string, status: Job['status']): Job {
  return settledJob('ingestParseSource', sourceId, status, {
    sourceDocBlobSha256: 'a'.repeat(64),
    title: 'notes.txt',
    language: 'en',
    blockCount: 3,
    assetCount: 0,
    needsOcr: false,
    ocrPages: [],
    warnings: [],
  })
}

function chunkJob(sourceId: string, status: Job['status'], draftsBlob: string): Job {
  return settledJob('ingestChunkSource', sourceId, status, {
    chunkDraftsBlobSha256: draftsBlob,
    chunkingVersion: '1:chars4',
    chunkCount: 2,
    unitCount: 2,
    frontmatterCount: 1,
    tokenCount: 60,
    warnings: [],
  })
}

/** What `ingestChunkSource` writes to its blob: a front-matter chunk and a content one, each
 *  naming its unit by key. */
function draftsFor(sourceId: string) {
  return {
    sourceId,
    chunkingVersion: '1:chars4',
    units: [
      {
        key: 'page:1',
        kind: 'page' as const,
        ordinal: 1,
        label: 'p. 1',
        tStartMs: null,
        tEndMs: null,
        text: 'Índice general',
        blockIds: ['b1'],
      },
      {
        key: 'page:2',
        kind: 'page' as const,
        ordinal: 2,
        label: 'p. 2',
        tStartMs: null,
        tEndMs: null,
        text: 'La memoria es',
        blockIds: ['b2'],
      },
    ],
    chunks: [
      {
        key: '1'.repeat(64),
        ordinal: 0,
        text: 'Índice general',
        tokenCount: 4,
        charStart: 0,
        charEnd: 14,
        hash: '2'.repeat(64),
        headingPath: 'Libro > Índice',
        blockIds: ['b1'],
        unitKey: 'page:1',
        sectionId: 's1',
        isFrontmatter: true,
        locator: { block_ids: ['b1'], page: 1, label: 'p. 1' },
      },
      {
        key: '3'.repeat(64),
        ordinal: 1,
        text: 'La memoria es',
        tokenCount: 4,
        charStart: 16,
        charEnd: 29,
        hash: '4'.repeat(64),
        headingPath: 'Libro > Capítulo 1',
        blockIds: ['b2'],
        unitKey: 'page:2',
        sectionId: 's2',
        isFrontmatter: false,
        locator: { block_ids: ['b2'], page: 2, label: 'p. 2' },
      },
    ],
  }
}

describe('LibraryService', () => {
  let dir: string
  let sources: ReturnType<typeof createInMemorySourceRepository>
  let chunks: ReturnType<typeof createInMemoryChunkRepository>
  let scheduler: JobScheduler
  let blobStore: BlobStore
  let service: LibraryService

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'retenia-library-')))
    sources = createInMemorySourceRepository()
    chunks = createInMemoryChunkRepository()
    const clock = fakeClock()
    scheduler = createJobScheduler({
      jobs: createInMemoryJobRepository(clock),
      clock,
      liveness: fakeLiveness(),
      registry,
      runId: 'run-under-test',
    })
    blobStore = createFsBlobStore(dir)
    service = createLibraryService({
      // Only `sources`, `chunks` and `transaction` are exercised; the rest of `Repositories`
      // is never read.
      repos: {
        sources,
        chunks,
        transaction: <T>(work: (tx: unknown) => Promise<T>) => work({ sources, chunks }),
      } as never,
      blobStore,
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

  it('queues chunking as soon as the parse succeeds, before the source reads as ready', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    await service.onJobSettled(parseJob(source.id, 'succeeded'))

    const chunkJob = (await scheduler.listActive()).find((j) => j.kind === 'ingestChunkSource')
    expect(chunkJob?.payload).toMatchObject({
      sourceId: source.id,
      sourceDocBlobSha256: 'a'.repeat(64),
    })
    expect(chunkJob?.subjectId).toBe(source.id)
  })

  it('writes the chunks and units a settled chunk job produced', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(draftsFor(source.id))),
      'application/json',
    )

    await service.onJobSettled(chunkJob(source.id, 'succeeded', sha256))

    const written = await service.getChunks(source.id)
    expect(written.map((chunk) => chunk.text)).toEqual(['Índice general', 'La memoria es'])
    expect(written.map((chunk) => chunk.isFrontmatter)).toEqual([true, false])
    // Each chunk points at the real `source_units` row its draft named by key.
    expect(written[0]?.unitId).toBe(sources.units()[0]?.id)
    expect(written[1]?.unitId).toBe(sources.units()[1]?.id)
    expect((await service.get(source.id))?.meta).toMatchObject({
      chunkCount: 2,
      unitCount: 2,
      frontmatterChunkCount: 1,
      chunkingVersion: '1:chars4',
    })
  })

  it('keeps a source readable when only its chunking failed', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    await service.onJobSettled(parseJob(source.id, 'succeeded'))
    await service.onJobSettled({
      ...chunkJob(source.id, 'failed', 'b'.repeat(64)),
      error: 'out of memory',
    })

    const updated = await service.get(source.id)
    // The text is still there and still readable; what is missing is retrieval.
    expect(updated?.status).toBe('ready')
    expect(updated?.error).toContain('out of memory')
  })

  it('re-chunks only the sources cut under another version, and only if they were parsed', async () => {
    const parsed = await service.addFromText('placeholder', 'parsed.txt')
    await service.onJobSettled(parseJob(parsed.id, 'succeeded'))
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(
        JSON.stringify({ ...draftsFor(parsed.id), chunkingVersion: '0:legacy' }),
      ),
      'application/json',
    )
    await service.onJobSettled(chunkJob(parsed.id, 'succeeded', sha256))

    // A second source whose chunks are stale but which has no parsed document to chunk.
    const orphan = await service.addFromText('placeholder', 'orphan.txt')
    await chunks.replaceBySource(orphan.id, [
      {
        sourceId: orphan.id,
        unitId: null,
        ordinal: 0,
        text: 'huérfano',
        charStart: 0,
        charEnd: 8,
        tokenCount: 2,
        hash: 'f'.repeat(64),
        headingPath: null,
        context: null,
        chunkKey: 'e'.repeat(64),
        chunkingVersion: '0:legacy',
        isFrontmatter: false,
        locator: null,
      },
    ])

    const queued = await service.rechunkStaleSources()
    expect(queued).toEqual([parsed.id])
    const jobs = (await scheduler.listActive()).filter((j) => j.kind === 'ingestChunkSource')
    expect(jobs.at(-1)?.payload).toMatchObject({ sourceId: parsed.id })
  })

  it('queues a ready source that has no chunks at all, not just stale ones', async () => {
    // Everything ingested before this sub-phase existed, and everything whose chunk job
    // failed: the version sweep cannot see them, because it looks at chunk rows.
    const source = await service.addFromText('placeholder', 'never-chunked.txt')
    await service.onJobSettled(parseJob(source.id, 'succeeded'))
    // Drain the chunk job the parse queued, so only the sweep's own enqueue is left to find.
    const before = (await scheduler.listActive()).filter((j) => j.kind === 'ingestChunkSource')

    expect(await service.rechunkStaleSources()).toEqual([source.id])
    const after = (await scheduler.listActive()).filter((j) => j.kind === 'ingestChunkSource')
    expect(after.length).toBe(before.length + 1)
  })

  it('quotes the improved index over the chunks that still have no context', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(draftsFor(source.id))),
      'application/json',
    )
    await service.onJobSettled(chunkJob(source.id, 'succeeded', sha256))

    const estimate = await service.estimateContextualization(source.id)
    expect(estimate.chunkCount).toBe(2)
    expect(estimate.usd).toBeGreaterThan(0)
    expect(estimate.outputTokens).toBeGreaterThan(0)
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

  it('enqueues the parse with the extension the blob was stored under, so the worker finds it', async () => {
    const file = join(dir, 'Cell Biology.pdf')
    writeFileSync(file, '%PDF-1.4 (not really)')

    const source = await service.addFromFile(file)

    const [job] = await scheduler.listActive()
    expect(job?.payload).toMatchObject({
      sourceId: source.id,
      blobSha256: source.blobSha256,
      kind: 'pdf',
      ext: 'pdf',
    })
    // The path the worker will build from that payload is the file `put` actually wrote.
    expect(await blobStore.has(source.blobSha256 as string, 'pdf')).toBe(true)
    expect(await blobStore.has(source.blobSha256 as string, null)).toBe(false)
  })

  it('refuses to contextualize when no provider is configured', async () => {
    const source = await service.addFromText('placeholder', 'notes.txt')
    await expect(service.contextualize(source.id)).rejects.toBeInstanceOf(
      ContextualizationUnavailableError,
    )
  })

  it('writes a context per chunk and reports what failed', async () => {
    const withProvider = createLibraryService({
      repos: {
        sources,
        chunks,
        transaction: <T>(work: (tx: unknown) => Promise<T>) => work({ sources, chunks }),
      } as never,
      blobStore,
      scheduler,
      // Keyed on the chunk block's own heading, not on the text: the document summary the
      // prompt carries quotes every chunk, so matching on body text would match both calls.
      textGenerator: async (request) => {
        if (request.prompt.includes('heading_path="Libro &gt; Capítulo 1"')) {
          throw new Error('429 rate limited')
        }
        return { text: 'Del índice del libro.', model: 'fake-cheap' }
      },
    })

    const source = await withProvider.addFromText('placeholder', 'notes.txt')
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(draftsFor(source.id))),
      'application/json',
    )
    await withProvider.onJobSettled(chunkJob(source.id, 'succeeded', sha256))

    const run = await withProvider.contextualize(source.id)
    expect(run).toEqual({ written: 1, failed: 1 })

    const written = await withProvider.getChunks(source.id)
    expect(written[0]?.context).toBe('Del índice del libro.')
    expect(written[1]?.context).toBeNull()

    // A second run quotes and asks only for what is still missing.
    expect((await withProvider.estimateContextualization(source.id)).chunkCount).toBe(1)
  })

  it('does nothing, and asks nothing, when every chunk already has a context', async () => {
    let calls = 0
    const withProvider = createLibraryService({
      repos: {
        sources,
        chunks,
        transaction: <T>(work: (tx: unknown) => Promise<T>) => work({ sources, chunks }),
      } as never,
      blobStore,
      scheduler,
      textGenerator: async () => {
        calls += 1
        return { text: 'Contexto.', model: 'fake-cheap' }
      },
    })

    const source = await withProvider.addFromText('placeholder', 'notes.txt')
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(draftsFor(source.id))),
      'application/json',
    )
    await withProvider.onJobSettled(chunkJob(source.id, 'succeeded', sha256))

    await withProvider.contextualize(source.id)
    expect(calls).toBe(2)
    expect(await withProvider.contextualize(source.id)).toEqual({ written: 0, failed: 0 })
    expect(calls).toBe(2)
  })

  it('imports dropped bytes by name alone, never a path, and rejects an unsupported name', async () => {
    const source = await service.addFromBytes('scan.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

    expect(source.kind).toBe('image')
    expect(source.originUri).toBeNull()
    expect(await blobStore.has(source.blobSha256 as string, 'png')).toBe(true)

    await expect(service.addFromBytes('archive.zip', new Uint8Array([1]))).rejects.toThrow(
      /not a supported file type/,
    )
  })

  it('re-enqueues a retry with the same extension', async () => {
    const source = await service.addFromBytes('scan.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    await sources.markFailed(source.id, 'boom')

    await service.retry(source.id)

    const jobs = await scheduler.listActive()
    expect(jobs).toHaveLength(2)
    for (const job of jobs) {
      expect(job.payload).toMatchObject({ sourceId: source.id, ext: 'png' })
    }
  })

  it('keeps the stored extension when the parse result lands in meta', async () => {
    const source = await service.addFromBytes('notes.md', new TextEncoder().encode('# Hi'))
    await service.onJobSettled({
      id: 'job-md',
      kind: 'ingestParseSource',
      status: 'succeeded',
      subjectId: source.id,
      error: null,
      result: {
        sourceDocBlobSha256: 'b'.repeat(64),
        title: 'notes.md',
        language: 'en',
        blockCount: 1,
        assetCount: 0,
        needsOcr: false,
        ocrPages: [],
        warnings: [],
      },
    } as unknown as Job)

    const updated = await service.get(source.id)
    expect(updated?.status).toBe('ready')
    expect(updated?.meta).toMatchObject({ blobExt: 'md', sourceDocBlobSha256: 'b'.repeat(64) })
  })
})
