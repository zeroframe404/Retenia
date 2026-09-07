import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BlobStore,
  Chunk,
  Job,
  JobScheduler,
  RerankResult,
  SettingsMap,
  Source,
  UnitOfWork,
} from '@retenia/core'
import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { createRepositories, knnChunks, type OpenedDatabase } from '@retenia/db'
import { openTestDatabase, testClock, testIds } from '@retenia/db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbedTextsBlob, EmbedVectorsBlob, IngestEmbedResult } from '../../jobs/ingest-embed'
import { createFsBlobStore } from '../blobs/store'
import type { EmbeddingHost } from '../embeddings/host'
import { createEmbeddingService, type EmbeddingService, embeddableText } from './embedding-service'

// The service logs through `main/logging/log.ts`, which pulls in Electron for `is.dev`.
// Same stub every other main-process suite uses; the log output is not what is under test.
vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/**
 * The vector half of the library (sub-phase 6.3): what gets queued, what gets written, and
 * what a query does when the model is not there.
 *
 * The embedding *model* is the deterministic hashing-trick fake from `@retenia/core/testing`
 * — this suite is about the orchestration, not about onnxruntime — but everything under it
 * is real: a real SQLite file with the real vec0 tables, the real repositories, the real
 * blob store on a temp directory.
 */

const GEMMA = 'embeddinggemma-300m@768'
const clock = testClock()
const provider = createFakeEmbeddingProvider({ modelId: GEMMA })

describe('the embedding service', () => {
  let opened: OpenedDatabase
  let repos: UnitOfWork
  let root: string
  let blobStore: BlobStore
  let service: EmbeddingService
  let settings: Partial<SettingsMap>
  let enqueued: { kind: string; payload: Record<string, unknown>; subjectId?: string }[]
  let host: EmbeddingHost
  let rerankResults: RerankResult[] | undefined
  let embedQueryFails: boolean

  const scheduler = {
    enqueue: vi.fn(async (kind: string, payload: Record<string, unknown>, options) => {
      enqueued.push({ kind, payload, subjectId: options?.subjectId })
      return { id: `job-${enqueued.length}` } as unknown as Job
    }),
  } as unknown as JobScheduler

  const newSource = (title = 'Libro'): Promise<Source> =>
    repos.sources.create({
      kind: 'pdf',
      title,
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: null,
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
      lastLocator: null,
      lastOpenedAt: null,
    })

  const addChunks = async (sourceId: string, texts: readonly string[]): Promise<Chunk[]> =>
    repos.chunks.createMany(
      texts.map((text, ordinal) => ({
        sourceId,
        unitId: null,
        ordinal,
        text,
        charStart: 0,
        charEnd: text.length,
        tokenCount: Math.ceil(text.length / 4),
        hash: `${ordinal}`.padStart(64, '0'),
        headingPath: 'Libro > Capítulo 1',
        context: null,
        chunkKey: `${sourceId}:${ordinal}`,
        chunkingVersion: '1:chars4',
        isFrontmatter: false,
        locator: { page: ordinal + 1, block_ids: [`b${ordinal}`] },
      })),
    )

  /** Runs what the worker would run, over the texts blob the service wrote. */
  const runEmbedJob = async (): Promise<Job> => {
    const queued = enqueued.at(-1)
    if (queued === undefined) throw new Error('nothing was enqueued')
    const texts = JSON.parse(
      new TextDecoder().decode(
        await blobStore.get(queued.payload.textsBlobSha256 as string, 'json'),
      ),
    ) as EmbedTextsBlob

    const vectors = await provider.embed(texts.chunks.map((chunk) => chunk.text))
    const flat = new Float32Array(vectors.length * provider.dims)
    vectors.forEach((vector, index) => {
      flat.set(vector, index * provider.dims)
    })
    const blob: EmbedVectorsBlob = {
      sourceId: texts.sourceId,
      modelId: provider.modelId,
      dims: provider.dims,
      chunkIds: texts.chunks.map((chunk) => chunk.chunkId),
      vectors: Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64'),
    }
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(blob)),
      'application/json',
    )
    const result: IngestEmbedResult = {
      vectorsBlobSha256: sha256,
      modelId: provider.modelId,
      dims: provider.dims,
      chunkCount: blob.chunkIds.length,
      device: 'cpu',
      embedMs: 1,
    }
    return {
      kind: 'ingestEmbedSource',
      subjectId: queued.subjectId ?? null,
      status: 'succeeded',
      result: result as unknown as Job['result'],
      error: null,
    } as Job
  }

  beforeEach(async () => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: 'device-test', clock, ids: testIds(clock) })
    root = await mkdtemp(join(tmpdir(), 'retenia-embed-'))
    blobStore = createFsBlobStore(root)
    enqueued = []
    rerankResults = undefined
    embedQueryFails = false
    settings = { 'retrieval.embeddingModel': 'embeddinggemma-300m' }

    host = {
      embedQuery: vi.fn(async (_model, text: string) => {
        if (embedQueryFails) throw new Error('the host is not running')
        const [vector] = await provider.embed([text])
        return { vector: vector as Float32Array, modelId: GEMMA }
      }),
      rerank: vi.fn(async () => rerankResults ?? []),
      isRunning: () => true,
      stop: async () => {},
    }

    service = createEmbeddingService({
      repos,
      sqlite: opened.sqlite,
      blobStore,
      scheduler,
      host,
      ids: testIds(clock),
      getSetting: (async (key: keyof SettingsMap) =>
        (settings as Record<string, unknown>)[key] ??
        (await import('@retenia/core')).SETTINGS_DEFAULTS[key]) as never,
    })
  })

  afterEach(async () => {
    opened.close()
    await rm(root, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('what is embedded', () => {
    it('is the contextual-retrieval context in front of the chunk’s own text', () => {
      // The whole point of §4.2's context: a paragraph that only says "this phase" carries
      // the name its chapter gave it into the vector too.
      expect(
        embeddableText({ text: 'Dura de 6 a 8 horas.', context: 'La fase REM del sueño.' }),
      ).toBe('La fase REM del sueño.\n\nDura de 6 a 8 horas.')
    })

    it('is the text alone when the improved index has not run', () => {
      expect(embeddableText({ text: 'Dura 8 horas.', context: null })).toBe('Dura 8 horas.')
      expect(embeddableText({ text: 'Dura 8 horas.', context: '' })).toBe('Dura 8 horas.')
    })
  })

  describe('queuing a source', () => {
    it('writes the chunks to a blob and enqueues the job against that source', async () => {
      const source = await newSource()
      await addChunks(source.id, ['El corazón bombea sangre.', 'Las mitocondrias.'])
      await service.embedSource(source.id)

      expect(enqueued).toHaveLength(1)
      expect(enqueued[0]).toMatchObject({
        kind: 'ingestEmbedSource',
        subjectId: source.id,
        payload: { sourceId: source.id, modelId: 'embeddinggemma-300m' },
      })
      // `running`, not `ready`: the job has not produced a single vector yet.
      expect((await repos.sources.findById(source.id))?.embeddingStatus).toBe('running')
    })

    it('leaves a source with no chunks pending rather than failing it', async () => {
      const source = await newSource()
      await service.embedSource(source.id)
      expect(enqueued).toEqual([])
      expect((await repos.sources.findById(source.id))?.embeddingStatus).toBe('pending')
    })

    it('fails the source when no embedding model is configured', async () => {
      settings = { 'retrieval.embeddingModel': 'a-model-this-build-does-not-have' }
      const source = await newSource()
      await addChunks(source.id, ['x'])
      await service.embedSource(source.id)

      const after = await repos.sources.findById(source.id)
      expect(after?.embeddingStatus).toBe('failed')
      expect(after?.embeddingError).toMatch(/No embedding model is configured/)
      expect(enqueued).toEqual([])
    })
  })

  describe('applying the vectors', () => {
    it('writes them, records the space, and makes the source findable by vector', async () => {
      const source = await newSource()
      const chunks = await addChunks(source.id, [
        'El corazón bombea sangre por el sistema circulatorio.',
        'Las mitocondrias producen ATP.',
      ])
      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())

      const after = await repos.sources.findById(source.id)
      expect(after?.embeddingStatus).toBe('ready')
      expect(after?.embeddingModelId).toBe(GEMMA)

      const [query] = await provider.embed([
        'El corazón bombea sangre por el sistema circulatorio.',
      ])
      const hits = knnChunks(opened.sqlite, query as Float32Array, { k: 2, modelId: GEMMA })
      expect(hits[0]?.chunkId).toBe(chunks[0]?.id)
    })

    it('writes only the quantized index unless precise vectors are on', async () => {
      const source = await newSource()
      await addChunks(source.id, ['a', 'b'])
      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())

      const count = (table: string): number =>
        (opened.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
      expect(count('embeddings_i8')).toBe(2)
      expect(count('embeddings')).toBe(0)

      settings['retrieval.preciseVectors'] = true
      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())
      expect(count('embeddings')).toBe(2)
    })

    it('is idempotent: re-running the job does not double the vectors', async () => {
      // vec0 has no unique constraint, so a retried job would otherwise leave two vectors
      // per chunk and a KNN query would return the same chunk twice.
      const source = await newSource()
      await addChunks(source.id, ['a', 'b'])
      await service.embedSource(source.id)
      const job = await runEmbedJob()
      await service.onJobSettled(job)
      await service.onJobSettled(job)

      const count = (
        opened.sqlite.prepare('SELECT count(*) AS n FROM embeddings_i8').get() as {
          n: number
        }
      ).n
      expect(count).toBe(2)
    })

    it('records the failure and leaves no vectors when the job fails', async () => {
      const source = await newSource()
      await addChunks(source.id, ['a'])
      await service.embedSource(source.id)
      await service.onJobSettled({
        kind: 'ingestEmbedSource',
        subjectId: source.id,
        status: 'failed',
        result: null,
        error: 'out of memory',
      } as Job)

      const after = await repos.sources.findById(source.id)
      expect(after?.embeddingStatus).toBe('failed')
      expect(after?.embeddingError).toBe('out of memory')
      expect(after?.embeddingModelId).toBeNull()
    })

    it('does not claim a source is ready when the vectors could not be applied', async () => {
      const source = await newSource()
      await addChunks(source.id, ['a'])
      await service.embedSource(source.id)
      await service.onJobSettled({
        kind: 'ingestEmbedSource',
        subjectId: source.id,
        status: 'succeeded',
        result: { vectorsBlobSha256: 'f'.repeat(64), dims: 768 } as unknown as Job['result'],
        error: null,
      } as Job)

      const after = await repos.sources.findById(source.id)
      expect(after?.embeddingStatus).toBe('failed')
      expect(after?.embeddingModelId).toBeNull()
    })

    it('ignores a job of another kind', async () => {
      await service.onJobSettled({
        kind: 'ingestChunkSource',
        subjectId: 'x',
        status: 'succeeded',
        result: null,
        error: null,
      } as Job)
      expect(enqueued).toEqual([])
    })
  })

  describe('the reindex sweep', () => {
    it('queues a source embedded under another model, and drops its old vectors first', async () => {
      const source = await newSource()
      await addChunks(source.id, ['El corazón bombea sangre.'])
      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())

      const before = (
        opened.sqlite.prepare('SELECT count(*) AS n FROM embeddings_i8').get() as {
          n: number
        }
      ).n
      expect(before).toBe(1)

      // The user switches models. The old space must be gone before the new one arrives —
      // two models' vectors in one partition answer a KNN query with distances that are not
      // comparable.
      settings['retrieval.embeddingModel'] = 'bge-m3'
      expect(await service.reindexStaleSources()).toEqual([source.id])
      const after = (
        opened.sqlite.prepare('SELECT count(*) AS n FROM embeddings_i8').get() as {
          n: number
        }
      ).n
      expect(after).toBe(0)
      expect((await repos.sources.findById(source.id))?.embeddingStatus).toBe('running')
    })

    it('queues nothing when every source is already in the active space', async () => {
      const source = await newSource()
      await addChunks(source.id, ['a'])
      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())
      expect(await service.reindexStaleSources()).toEqual([])
    })

    it('queues nothing at all when no model is configured', async () => {
      settings = { 'retrieval.embeddingModel': 'nonexistent' }
      const source = await newSource()
      await addChunks(source.id, ['a'])
      expect(await service.reindexStaleSources()).toEqual([])
    })
  })

  describe('searching', () => {
    const seed = async (): Promise<Chunk[]> => {
      const source = await newSource()
      const chunks = await addChunks(source.id, [
        'El corazón bombea sangre por el sistema circulatorio.',
        'Las mitocondrias son los orgánulos que producen ATP.',
        'La fotosíntesis convierte la luz solar en energía química.',
      ])
      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())
      return chunks
    }

    it('finds the right chunk for a Spanish query', async () => {
      const chunks = await seed()
      const hits = await service.search('mitocondrias producen ATP')
      expect(hits[0]?.chunk.id).toBe(chunks[1]?.id)
      expect(hits[0]?.snippet).toContain('<b>')
    })

    it('fuses both branches: a hit can carry an FTS rank and a vector rank', async () => {
      await seed()
      const hits = await service.search('sangre circulatorio')
      expect(hits[0]?.fts).toBeDefined()
      expect(hits[0]?.vector).toBeDefined()
    })

    it('degrades to full text — not to nothing — when the query cannot be embedded', async () => {
      const chunks = await seed()
      embedQueryFails = true
      const hits = await service.search('mitocondrias')
      expect(hits[0]?.chunk.id).toBe(chunks[1]?.id)
      expect(hits[0]?.vector).toBeUndefined()
    })

    it('returns nothing for a vector-only search with no working model', async () => {
      // There is no full-text fallback to offer here: the caller asked for semantics.
      await seed()
      embedQueryFails = true
      expect(await service.search('mitocondrias', { mode: 'vector' })).toEqual([])
    })

    it('never embeds the query for an fts-only search', async () => {
      await seed()
      vi.mocked(host.embedQuery).mockClear()
      await service.search('mitocondrias', { mode: 'fts' })
      expect(host.embedQuery).not.toHaveBeenCalled()
    })

    it('runs the reranker only when it is turned on, and lets it reorder', async () => {
      const chunks = await seed()
      await service.search('mitocondrias')
      expect(host.rerank).not.toHaveBeenCalled()

      settings['retrieval.rerankerEnabled'] = true
      // The reranker overrules the fusion: it puts the photosynthesis chunk first.
      rerankResults = [
        { id: chunks[2]?.id as string, score: 0.99 },
        { id: chunks[1]?.id as string, score: 0.4 },
      ]
      const reranked = await service.search('mitocondrias')
      expect(host.rerank).toHaveBeenCalled()
      expect(reranked.map((hit) => hit.chunk.id)).toEqual([chunks[2]?.id, chunks[1]?.id])
    })

    it('restricts to the sources the filter names', async () => {
      const chunks = await seed()
      const other = await newSource('Otro')
      await addChunks(other.id, ['Las mitocondrias otra vez.'])

      const hits = await service.search('mitocondrias', { sourceIds: [other.id] })
      expect(hits.every((hit) => hit.chunk.sourceId === other.id)).toBe(true)
      expect(hits.map((hit) => hit.chunk.id)).not.toContain(chunks[1]?.id)
    })
  })

  describe('the status line', () => {
    it('reports the active space and how many sources are still outside it', async () => {
      const source = await newSource()
      await addChunks(source.id, ['a'])
      expect(await service.status()).toEqual({
        modelId: GEMMA,
        pendingSources: 1,
        rerankerEnabled: false,
      })

      await service.embedSource(source.id)
      await service.onJobSettled(await runEmbedJob())
      expect(await service.status()).toMatchObject({ pendingSources: 0 })
    })

    it('reports no model at all when the setting names one this build does not have', async () => {
      settings = { 'retrieval.embeddingModel': 'nope' }
      expect(await service.status()).toMatchObject({ modelId: null, pendingSources: 0 })
    })
  })
})
