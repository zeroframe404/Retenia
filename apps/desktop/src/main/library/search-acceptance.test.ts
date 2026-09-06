import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BlobStore, Job, JobScheduler, SettingsMap, UnitOfWork } from '@retenia/core'
import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { createRepositories, type OpenedDatabase } from '@retenia/db'
import { openTestDatabase, testClock, testIds } from '@retenia/db/testing'
import { chunkSourceDoc, createTokenCounter, parseDocument } from '@retenia/ingest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EmbedTextsBlob, EmbedVectorsBlob, IngestEmbedResult } from '../../jobs/ingest-embed'
import { createFsBlobStore } from '../blobs/store'
import type { EmbeddingHost } from '../embeddings/host'
import { persistChunkDrafts } from './chunk-store'
import { createEmbeddingService, type EmbeddingService } from './embedding-service'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/**
 * Sub-phase 6.3's acceptance criterion, end to end over a real fixture book:
 *
 *   > a Spanish query returns the expected chunk from the fixture book in < 150 ms after
 *   > indexing.
 *
 * Everything below the model is the real pipeline: the committed PDF is parsed by
 * `@retenia/ingest`, chunked by the real chunker, persisted through the real repositories
 * into a real SQLite file with the real FTS5 and vec0 tables, embedded through the real
 * service, and searched through the real hybrid retrieval.
 *
 * The *model* is the deterministic hashing-trick fake, and that is deliberate rather than a
 * shortcut: a 300 MB ONNX download would make this test un-runnable in CI, and the criterion
 * being measured here is the **retrieval path's latency**, which is dominated by the FTS5
 * scan, the vec0 scan, the fusion and the hydration — not by the forward pass, which happens
 * in the warm model host and is measured separately in `docs/perf/rag.md`.
 */

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/ingest/test/fixtures/pdf/book-with-frontmatter.pdf',
)

/** The criterion's budget, for the retrieval path measured here. */
const BUDGET_MS = 150
/** Chunks in the synthetic corpus the latency is measured over — `docs/spec/05-ingestion-rag.md`
 *  §3's 300-page book at 300–500 tokens a chunk. */
const BOOK_CHUNKS = 600

const clock = testClock()
const provider = createFakeEmbeddingProvider({ modelId: 'embeddinggemma-300m@768' })

describe('a Spanish query over the fixture book', () => {
  let opened: OpenedDatabase
  let repos: UnitOfWork
  let root: string
  let blobStore: BlobStore
  let service: EmbeddingService
  let sourceId: string

  const enqueued: { payload: Record<string, unknown>; subjectId?: string }[] = []

  beforeAll(async () => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: 'device-test', clock, ids: testIds(clock) })
    root = await mkdtemp(join(tmpdir(), 'retenia-acceptance-'))
    blobStore = createFsBlobStore(root)

    const scheduler = {
      enqueue: async (
        _kind: string,
        payload: Record<string, unknown>,
        options?: { subjectId?: string },
      ) => {
        enqueued.push({ payload, subjectId: options?.subjectId })
        return { id: 'job-1' } as unknown as Job
      },
    } as unknown as JobScheduler

    const host: EmbeddingHost = {
      embedQuery: async (_model, text: string) => {
        const [vector] = await provider.embed([text])
        return { vector: vector as Float32Array, modelId: provider.modelId }
      },
      rerank: async () => [],
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
        key === 'retrieval.embeddingModel'
          ? 'embeddinggemma-300m'
          : (await import('@retenia/core')).SETTINGS_DEFAULTS[key]) as never,
    })

    // 1. Import — the real source row.
    const source = await repos.sources.create({
      kind: 'pdf',
      title: 'Memoria y repaso espaciado',
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: new Date(),
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
    })
    sourceId = source.id

    // 2. Parse — the real PDF parser over the committed fixture.
    const { createTesseractOcrProvider } = await import('@retenia/ingest')
    const ids = testIds(clock)
    const doc = await parseDocument(
      'pdf',
      { bytes: new Uint8Array(await readFile(FIXTURE)), fallbackTitle: source.title },
      {
        id: () => ids.next(),
        putAsset: async (bytes, mime, kind) => {
          const put = await blobStore.put(bytes, mime)
          return { id: ids.next(), blobSha256: put.sha256, mime: put.mime, kind }
        },
      },
      createTesseractOcrProvider(),
    )

    // 3. Chunk — the real structural chunker.
    const chunked = chunkSourceDoc(doc, {
      sourceId,
      tokenizer: { id: 'chars4', count: await createTokenCounter('chars4') },
    })
    await persistChunkDrafts(repos, {
      sourceId,
      chunkingVersion: chunked.chunkingVersion,
      units: chunked.units,
      chunks: chunked.chunks,
    })

    // 4. Embed — the real service, the real vec0 write, through the job's own blob shapes.
    await service.embedSource(sourceId)
    const queued = enqueued.at(-1)
    const texts = JSON.parse(
      new TextDecoder().decode(
        await blobStore.get(queued?.payload.textsBlobSha256 as string, 'json'),
      ),
    ) as EmbedTextsBlob
    const vectors = await provider.embed(texts.chunks.map((chunk) => chunk.text))
    const flat = new Float32Array(vectors.length * provider.dims)
    vectors.forEach((vector, index) => {
      flat.set(vector, index * provider.dims)
    })
    const blob: EmbedVectorsBlob = {
      sourceId,
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
      embedMs: 0,
    }
    await service.onJobSettled({
      kind: 'ingestEmbedSource',
      subjectId: sourceId,
      status: 'succeeded',
      result: result as unknown as Job['result'],
      error: null,
    } as Job)
  }, 60_000)

  afterAll(async () => {
    opened.close()
    await rm(root, { recursive: true, force: true })
  })

  it('indexed the whole book, and recorded which space it is in', async () => {
    const source = await repos.sources.findById(sourceId)
    expect(source?.embeddingStatus).toBe('ready')
    expect(source?.embeddingModelId).toBe('embeddinggemma-300m@768')

    const chunks = await repos.chunks.listBySource(sourceId)
    expect(chunks.length).toBeGreaterThan(1)
    const vectors = (
      opened.sqlite.prepare('SELECT count(*) AS n FROM embeddings_i8').get() as { n: number }
    ).n
    expect(vectors).toBe(chunks.length)
    // The front matter is indexed, not dropped — `docs/spec/05-ingestion-rag.md` keeps it
    // citable — but it is flagged, so path generation can exclude it later.
    expect(chunks.some((chunk) => chunk.isFrontmatter)).toBe(true)
  })

  it('returns the chapter the question is about, with a citable page', async () => {
    // "Sílabas sin sentido" is Ebbinghaus's method, and it appears only in the body — the
    // table of contents names the section but not what it says, which is exactly the
    // difference between finding a chapter and finding an answer.
    const hits = await service.search('sílabas sin sentido a distintos intervalos')

    expect(hits.length).toBeGreaterThan(0)
    const top = hits[0]
    expect(top?.chunk.text).toMatch(/Ebbinghaus/)
    expect(top?.chunk.isFrontmatter).toBe(false)
    expect(top?.chunk.headingPath).toMatch(/Capítulo 1/)
    // A hit is only useful if it can be cited, and a page is what a PDF citation is.
    expect(top?.sourceLocator.page).toBeGreaterThan(0)
    expect(top?.blockIds.length).toBeGreaterThan(0)
    // Both branches agreed on it, which is the point of fusing them.
    expect(top?.fts).toBeDefined()
    expect(top?.vector).toBeDefined()
  })

  it('matches through the accents the query leaves out', async () => {
    // The FTS5 tokenizer is `unicode61 remove_diacritics 2`, and the fake embedding
    // tokenizer strips diacritics for the same reason: nobody types `práctica` with the
    // accent into a search box.
    const withAccents = await service.search('¿qué midió Ebbinghaus?')
    const without = await service.search('que midio Ebbinghaus')
    expect(without.map((hit) => hit.chunk.id)).toEqual(withAccents.map((hit) => hit.chunk.id))
    expect(withAccents[0]?.chunk.text).toMatch(/Ebbinghaus/)
  })

  it('answers a question the book cannot answer with weak, keyword-free hits', async () => {
    // Worth pinning, because it is the honest shape of the result and it surprises people:
    // a KNN branch has no distance floor, so it always returns *its* nearest neighbours,
    // however far. What tells the two cases apart is that none of them matched a keyword.
    const unrelated = await service.search('termodinámica de los agujeros negros')
    expect(unrelated.every((hit) => hit.fts === undefined)).toBe(true)
    expect(await service.search('termodinámica de los agujeros negros', { mode: 'fts' })).toEqual(
      [],
    )
    // Deliberately *not* asserted here: that the distances are larger than for a query the
    // book does answer. They are, with a real model — but this suite runs a hashing-trick
    // fake, and asserting that would be asserting the fake's arithmetic rather than the
    // system's behaviour. The real separation is measured in `docs/perf/rag.md`.
  })

  it('never mixes spaces: a query in another model’s space finds no vectors', async () => {
    // The guarantee the whole `model_id` design exists for. Switching the setting without
    // reindexing must return *nothing* from the vector branch rather than nonsense from it.
    const { knnChunks } = await import('@retenia/db')
    const [vector] = await provider.embed(['curva del olvido'])
    expect(
      knnChunks(opened.sqlite, vector as Float32Array, { k: 5, modelId: 'bge-m3@768' }),
    ).toEqual([])
    expect(
      knnChunks(opened.sqlite, vector as Float32Array, { k: 5, modelId: 'embeddinggemma-300m@768' })
        .length,
    ).toBeGreaterThan(0)
  })

  it(`answers in well under ${BUDGET_MS} ms at the scale of a real book`, async () => {
    // The fixture book is three chunks — enough to prove the *right* chunk comes back, far
    // too small to say anything about latency. So the same index is loaded with a
    // book-sized Spanish corpus (`docs/spec/05-ingestion-rag.md` §3 sizes a 300-page book at
    // roughly this many chunks) and the query path is measured over that.
    const filler = await repos.sources.create({
      kind: 'pdf',
      title: 'Corpus sintético',
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: new Date(),
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
    })

    const TOPICS = [
      'La consolidación de la memoria ocurre durante el sueño de ondas lentas',
      'El efecto de espaciamiento distribuye los repasos en el tiempo',
      'La retroalimentación inmediata corrige el error antes de que se afiance',
      'El intervalo óptimo crece con la estabilidad del recuerdo',
      'La interferencia retroactiva explica parte del olvido cotidiano',
    ]
    const drafts = Array.from({ length: BOOK_CHUNKS }, (_unused, index) => {
      const text = `${TOPICS[index % TOPICS.length]} — párrafo ${index} del corpus sintético, con suficiente texto para parecerse a un fragmento real de trescientas a quinientas fichas de un libro de estudio en castellano.`
      return {
        sourceId: filler.id,
        unitId: null,
        ordinal: index,
        text,
        charStart: 0,
        charEnd: text.length,
        tokenCount: Math.ceil(text.length / 4),
        hash: index.toString(16).padStart(64, '0'),
        headingPath: `Corpus sintético > Capítulo ${Math.floor(index / 20) + 1}`,
        context: null,
        chunkKey: `filler-${index}`,
        chunkingVersion: '1:chars4',
        isFrontmatter: false,
        locator: { page: Math.floor(index / 2) + 1, block_ids: [`fb${index}`] },
      }
    })
    const stored = await repos.chunks.createMany(drafts)

    const { insertEmbedding } = await import('@retenia/db')
    const fillerVectors = await provider.embed(stored.map((chunk) => chunk.text))
    const ids = testIds(clock)
    await repos.transaction(() => {
      stored.forEach((chunk, index) => {
        insertEmbedding(opened.sqlite, {
          id: ids.next(),
          sourceId: filler.id,
          chunkId: chunk.id,
          modelId: provider.modelId,
          embedding: fillerVectors[index] as Float32Array,
        })
      })
    })

    const total = (
      opened.sqlite.prepare('SELECT count(*) AS n FROM embeddings_i8').get() as { n: number }
    ).n
    expect(total).toBeGreaterThanOrEqual(BOOK_CHUNKS)

    const queries = [
      '¿qué midió Ebbinghaus?',
      'consolidación de la memoria durante el sueño',
      'el intervalo óptimo crece con la estabilidad',
      'interferencia retroactiva y olvido cotidiano',
    ]
    // Warm the prepared-statement cache the way a second keystroke would; the criterion is
    // about a search in a running app, not about the first query after a cold start.
    for (const query of queries) await service.search(query)

    const timings: number[] = []
    for (const query of queries) {
      const startedAt = performance.now()
      const hits = await service.search(query)
      timings.push(performance.now() - startedAt)
      expect(hits.length).toBeGreaterThan(0)
    }

    const worst = Math.max(...timings)
    // Reported so a regression shows the number rather than only the verdict; the same
    // measurement is written up in `docs/perf/rag.md`.
    console.info(
      `[acceptance] hybrid query over ${total} chunks: ${timings.map((ms) => ms.toFixed(1)).join(' / ')} ms`,
    )
    expect(worst).toBeLessThan(BUDGET_MS)
  }, 60_000)
})
