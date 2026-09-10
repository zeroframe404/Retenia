import type {
  BlobStore,
  Chunk,
  ChunkSearchHit,
  ChunkSearchOptions,
  EmbeddingStatus,
  IdGenerator,
  Job,
  JobScheduler,
  Reranker,
  SettingsMap,
  Source,
  UnitOfWork,
} from '@retenia/core'
import { createHybridSearch, deleteEmbeddingsForSource, insertEmbedding } from '@retenia/db'
import type { Database } from 'better-sqlite3'
import type { EmbedTextsBlob, EmbedVectorsBlob, IngestEmbedResult } from '../../jobs/ingest-embed'
import type { EmbeddingHost } from '../embeddings/host'
import type { EmbeddingHostModel } from '../embeddings/protocol'
import { log } from '../logging/log'

/**
 * The vector half of the library (sub-phase 6.3; `docs/spec/05-ingestion-rag.md` §3, §4).
 *
 * It owns three things and keeps them consistent with each other:
 *
 *  1. **Which space the library is in.** One setting, `retrieval.embeddingModel`, decides it.
 *     Every vector row records it, every query filters on it, and changing it re-embeds the
 *     library — because two spaces answering one query is not a degraded result, it is a
 *     meaningless one.
 *  2. **Getting sources into that space.** It writes what to embed to a blob, enqueues
 *     `ingestEmbedSource`, and applies the vectors the job returns. The job never touches
 *     SQLite; main is its single writer.
 *  3. **Answering a query.** The query vector comes from the warm model host, not from a
 *     queue job — a search has a 150 ms budget and a job has a model load in front of it.
 */

const EMBED_JOB_KIND = 'ingestEmbedSource'

export interface EmbeddingSearchOptions {
  /** `hybrid` (the default), `fts` or `vector`. */
  mode?: ChunkSearchOptions['mode']
  k?: number
  sourceIds?: readonly string[]
  pathId?: string
  prefix?: boolean
  snippetTokens?: number
}

export interface EmbeddingService {
  /** The space the library is indexed in right now — `undefined` when nothing is configured. */
  activeModelId(): Promise<string | undefined>
  /** Queues one source for embedding, dropping whatever space it was in. */
  embedSource(sourceId: string): Promise<void>
  /**
   * The reindex sweep: queues every source that is not in the active space
   * (`SourceRepository.sourceIdsNeedingEmbedding`). Returns the sources it queued.
   */
  reindexStaleSources(): Promise<string[]>
  /**
   * Hybrid retrieval. Embeds the query through the warm host when a vector branch is wanted,
   * and degrades to full text — rather than to nothing — when it cannot.
   */
  search(query: string, options?: EmbeddingSearchOptions): Promise<ChunkSearchHit[]>
  /**
   * Embeds a handful of short strings in the active space, or `undefined` when there is no
   * model configured or the host could not answer.
   *
   * For comparing texts to each other rather than for searching: sub-phase 8.3's flashcard
   * dedupe asks whether two fronts mean the same thing (§1.2 rule 11's *"cosine > 0.92"*).
   * `undefined` rather than a throw, because the caller has a cheaper exact-match pass and a
   * path generated without embeddings is degraded, not broken. The space's id travels with
   * the vectors so a caller can record which one they were compared in — distances across
   * spaces are meaningless, and a manifest that named the wrong one would be worse than one
   * that names none.
   */
  embedMany(
    texts: readonly string[],
  ): Promise<{ modelId: string; vectors: Float32Array[] } | undefined>
  /** What retrieval is configured with, for the search screen's status line. */
  status(): Promise<{ modelId: string | null; pendingSources: number; rerankerEnabled: boolean }>
  /** Wired into the runner's `onSettled`; a no-op for any job that is not ours. */
  onJobSettled(job: Job): Promise<void>
}

export interface EmbeddingServiceOptions {
  repos: UnitOfWork
  sqlite: Database
  blobStore: BlobStore
  scheduler: JobScheduler
  host: EmbeddingHost
  /** Mints the UUIDv7 of each `embeddings` row. */
  ids: IdGenerator
  /** Reads `retrieval.*`. Injected so this is testable without the settings table. */
  getSetting: <K extends keyof SettingsMap>(key: K) => Promise<SettingsMap[K]>
}

/** What is embedded: the contextual-retrieval context in front of the chunk's own text
 *  (`docs/spec/05-ingestion-rag.md` §4.2), or the text alone when there is no context. */
export function embeddableText(chunk: Pick<Chunk, 'text' | 'context'>): string {
  return chunk.context === null || chunk.context.length === 0
    ? chunk.text
    : `${chunk.context}\n\n${chunk.text}`
}

export function createEmbeddingService(options: EmbeddingServiceOptions): EmbeddingService {
  const { repos, sqlite, blobStore, scheduler, host, ids, getSetting } = options

  /**
   * The provider description, from settings.
   *
   * `modelId` here is the *space* id, which is what rows carry and queries filter on. For a
   * catalog model it is the catalog's `spaceId`; for a server it is the one
   * `createOllamaEmbedding` mints. Both are resolved by actually constructing the
   * description rather than by string-building, so the two can never drift.
   */
  const activeModel = async (): Promise<
    { model: EmbeddingHostModel; jobPayload: Record<string, unknown>; modelId: string } | undefined
  > => {
    const configured = await getSetting('retrieval.embeddingModel')
    const device = await getSetting('retrieval.device')

    if (configured === 'ollama') {
      const baseUrl = await getSetting('retrieval.ollamaBaseUrl')
      const model = await getSetting('retrieval.ollamaModel')
      const nativeDims = await getSetting('retrieval.ollamaDims')
      const { createOllamaEmbedding } = await import('@retenia/ingest/embeddings')
      return {
        model: { kind: 'ollama', baseUrl, model, nativeDims },
        jobPayload: { ollama: { baseUrl, model, nativeDims } },
        // Built by the provider itself: it is the only thing that knows how a reduction is
        // spelled into the id.
        modelId: createOllamaEmbedding({ baseUrl, model, nativeDims }).modelId,
      }
    }

    const { findModel } = await import('@retenia/ingest/models')
    const spec = findModel(configured)
    if (spec === undefined || spec.kind !== 'embedding') {
      // A setting written by a newer build, or a model dropped from the catalog. Retrieval
      // degrades to full text rather than throwing on every search.
      log.warn(`[embeddings] "${configured}" is not an embedding model in this build`)
      return undefined
    }
    return {
      model: { kind: 'local', modelId: spec.id, device },
      jobPayload: { modelId: spec.id, device },
      modelId: spec.spaceId,
    }
  }

  const setState = async (
    sourceId: string,
    status: EmbeddingStatus,
    extra: { modelId?: string | null; error?: string | null } = {},
  ): Promise<void> => {
    await repos.sources.setEmbeddingState(sourceId, { status, ...extra })
  }

  const enqueue = async (source: Source): Promise<void> => {
    const active = await activeModel()
    if (active === undefined) {
      await setState(source.id, 'failed', {
        modelId: null,
        error: 'No embedding model is configured',
      })
      return
    }

    const chunks = await repos.chunks.listBySource(source.id)
    if (chunks.length === 0) {
      // Nothing to embed is not a failure — it is a source whose chunk job has not run yet.
      await setState(source.id, 'pending', { modelId: null })
      return
    }

    // Marked incomplete *before* anything below can fail, not after everything below already
    // succeeded. `deleteEmbeddingsForSource`, the blob write and the scheduler call are none
    // of them transactional with each other, and better-sqlite3 offers no cross-await
    // transaction here (the blob write is a separate file, the enqueue a separate connection
    // use) — so the only way a failure between them cannot strand the source at `'ready'`
    // with vectors already gone is if it was never at `'ready'` for the length of the attempt.
    // `sourceIdsNeedingEmbedding` picks up anything that is not `'ready'`, so a source stuck
    // here at `'running'` — the blob write failed, the process died mid-embed, whatever — is
    // exactly what the next reindex sweep retries, rather than a permanently invisible gap.
    await setState(source.id, 'running', { modelId: null })

    // The old space goes before the new one arrives. A partition holding two models' vectors
    // would answer a KNN query with distances that are not comparable, and the `model_id`
    // filter would only hide that until the day one query forgot it.
    deleteEmbeddingsForSource(sqlite, source.id)

    const payload: EmbedTextsBlob = {
      sourceId: source.id,
      chunks: chunks.map((chunk) => ({ chunkId: chunk.id, text: embeddableText(chunk) })),
    }
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(payload)),
      'application/json',
    )

    await scheduler.enqueue(
      EMBED_JOB_KIND,
      { sourceId: source.id, textsBlobSha256: sha256, ...active.jobPayload },
      { subjectId: source.id },
    )
  }

  /** The reranker, when the user has turned one on — a thin adapter over the warm host. */
  const activeReranker = async (): Promise<Reranker | undefined> => {
    if (!(await getSetting('retrieval.rerankerEnabled'))) return undefined
    const modelId = await getSetting('retrieval.rerankerModel')
    const device = await getSetting('retrieval.device')
    const { findModel } = await import('@retenia/ingest/models')
    const spec = findModel(modelId)
    if (spec === undefined || spec.kind !== 'reranker') {
      log.warn(`[embeddings] "${modelId}" is not a reranker in this build`)
      return undefined
    }
    return {
      id: spec.id,
      rerank: (query, documents, rerankOptions) =>
        host.rerank(spec.id, device, query, documents, rerankOptions?.topN),
    }
  }

  return {
    activeModelId: async () => (await activeModel())?.modelId,

    embedSource: async (sourceId) => {
      const source = await repos.sources.findById(sourceId)
      if (source === undefined) throw new Error(`No source ${sourceId}`)
      await enqueue(source)
    },

    reindexStaleSources: async () => {
      const active = await activeModel()
      if (active === undefined) return []
      const stale = await repos.sources.sourceIdsNeedingEmbedding(active.modelId)
      const queued: string[] = []
      for (const sourceId of stale) {
        const source = await repos.sources.findById(sourceId)
        if (source === undefined) continue
        await enqueue(source)
        queued.push(sourceId)
      }
      return queued
    },

    search: async (query, searchOptions = {}) => {
      const mode = searchOptions.mode ?? 'hybrid'
      const reranker = await activeReranker()
      const search = createHybridSearch({
        sqlite,
        loadChunks: (ids) => repos.chunks.findMany(ids),
        ...(reranker === undefined ? {} : { reranker }),
      })

      const base = {
        ...(searchOptions.k === undefined ? {} : { k: searchOptions.k }),
        ...(searchOptions.sourceIds === undefined ? {} : { sourceIds: searchOptions.sourceIds }),
        ...(searchOptions.pathId === undefined ? {} : { pathId: searchOptions.pathId }),
        ...(searchOptions.prefix === undefined ? {} : { prefix: searchOptions.prefix }),
        ...(searchOptions.snippetTokens === undefined
          ? {}
          : { snippetTokens: searchOptions.snippetTokens }),
      }

      if (mode === 'fts') return search.search(query, { ...base, mode: 'fts' })

      const active = await activeModel()
      if (active !== undefined) {
        try {
          const { vector, modelId } = await host.embedQuery(active.model, query)
          return await search.search(query, { ...base, mode, embedding: vector, modelId })
        } catch (error) {
          log.warn('[embeddings] the query could not be embedded:', error)
        }
      }

      // No model, or the host could not answer. A `vector`-only search has nothing left to
      // offer; a hybrid one still has BM25, which is a much better answer than an error —
      // the user typed a query and the library can still be searched.
      if (mode === 'vector') return []
      return search.search(query, { ...base, mode: 'fts' })
    },

    embedMany: async (texts) => {
      const active = await activeModel()
      if (active === undefined) return undefined
      if (texts.length === 0) return { modelId: active.modelId, vectors: [] }
      try {
        const vectors: Float32Array[] = []
        // One at a time: `EmbeddingHost` exposes `embedQuery`, and a dedupe pass is a handful
        // of short fronts per lesson rather than a corpus — the batching that matters is in
        // the ingestion job, which has its own path through the host.
        for (const text of texts) {
          vectors.push((await host.embedQuery(active.model, text)).vector)
        }
        return { modelId: active.modelId, vectors }
      } catch (error) {
        log.warn('[embeddings] a batch could not be embedded:', error)
        return undefined
      }
    },

    status: async () => {
      const active = await activeModel()
      return {
        modelId: active?.modelId ?? null,
        pendingSources:
          active === undefined
            ? 0
            : (await repos.sources.sourceIdsNeedingEmbedding(active.modelId)).length,
        rerankerEnabled: (await activeReranker()) !== undefined,
      }
    },

    onJobSettled: async (job) => {
      if (job.kind !== EMBED_JOB_KIND || job.subjectId === null) return
      const sourceId = job.subjectId

      if (job.status !== 'succeeded' || job.result === null) {
        if (job.status === 'failed' || job.status === 'cancelled') {
          await setState(sourceId, 'failed', {
            modelId: null,
            error: job.error ?? 'Embedding failed',
          })
        }
        return
      }

      const result = job.result as unknown as IngestEmbedResult
      try {
        const bytes = await blobStore.get(result.vectorsBlobSha256, 'json')
        const blob = JSON.parse(new TextDecoder().decode(bytes)) as EmbedVectorsBlob
        const storeFloat = await getSetting('retrieval.preciseVectors')
        const flat = new Float32Array(Uint8Array.from(Buffer.from(blob.vectors, 'base64')).buffer)

        if (flat.length !== blob.chunkIds.length * blob.dims) {
          throw new Error(
            `the vectors blob holds ${flat.length} values for ${blob.chunkIds.length} chunks at ${blob.dims} dims`,
          )
        }

        // One transaction for the whole source: a half-written space is worse than none, and
        // this is also what makes the insert fast (one fsync rather than one per chunk).
        await repos.transaction(() => {
          // Dropped again here, not only at enqueue time: a retry of this job would otherwise
          // insert a second vector per chunk, and vec0 has no unique constraint to stop it.
          deleteEmbeddingsForSource(sqlite, sourceId)
          blob.chunkIds.forEach((chunkId, index) => {
            insertEmbedding(
              sqlite,
              {
                id: ids.next(),
                sourceId,
                chunkId,
                modelId: blob.modelId,
                embedding: flat.subarray(index * blob.dims, (index + 1) * blob.dims),
              },
              { storeFloat },
            )
          })
        })

        await setState(sourceId, 'ready', { modelId: blob.modelId })
        log.info(
          `[embeddings] ${blob.chunkIds.length} chunks of ${sourceId} embedded on ${result.device} in ${result.embedMs}ms`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // The vectors could not be applied, so the source is *not* in the active space —
        // saying otherwise would leave a half-indexed source looking complete forever.
        deleteEmbeddingsForSource(sqlite, sourceId)
        await setState(sourceId, 'failed', { modelId: null, error: message })
        log.error(`[embeddings] could not apply the vectors for ${sourceId}:`, message)
      }
    },
  }
}
