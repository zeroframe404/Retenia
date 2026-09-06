import type { EmbeddingProvider, Reranker } from '@retenia/core'
import type { LocalEmbeddingProvider, LocalReranker } from '@retenia/ingest'
import {
  type EmbeddingHostDevice,
  type EmbeddingHostModel,
  type EmbeddingHostRequest,
  type EmbeddingHostResponse,
  embeddingHostHandshakeSchema,
  embeddingHostRequestSchema,
  encodeVector,
} from '../main/embeddings/protocol'

/**
 * The **model host**: a long-lived `utilityProcess` that keeps an embedding model — and,
 * when the user turns it on, a reranker — loaded and warm for interactive search
 * (sub-phase 6.3).
 *
 * Why this exists beside the job worker, which also embeds. The two have opposite cost
 * profiles and one process cannot serve both:
 *
 *  - **Bulk embedding** runs as an `ingestEmbedSource` job in the pool. Loading 300 MB of
 *    weights takes seconds, and a job amortizes that over a whole book. The queue is also
 *    what gives it a progress bar, a cancel button, retries and resumption after a crash.
 *  - **A search query** is one short text and has a 150 ms budget end to end
 *    (`docs/perf/rag.md`). Paying a model load per keystroke-triggered search is not an
 *    option, and neither is loading onnxruntime into main: main is the database's single
 *    writer and the UI's event loop, and a native session with its own thread pool has no
 *    business there.
 *
 * So this process holds exactly one model at a time, unloads on an idle timeout — a bulk
 * embed and a warm query model must not both be resident — and reloads on the next query.
 * It never touches SQLite, for the same reason the job worker does not.
 */

let modelsRoot = ''

interface Loaded {
  key: string
  provider: EmbeddingProvider & Partial<Pick<LocalEmbeddingProvider, 'device' | 'dispose'>>
}

interface LoadedReranker {
  key: string
  reranker: Reranker & Partial<Pick<LocalReranker, 'device' | 'dispose'>>
}

let embedder: Loaded | undefined
let reranker: LoadedReranker | undefined

/** Identifies "the thing that is loaded" so a request can tell hit from miss. */
function modelKey(model: EmbeddingHostModel): string {
  return model.kind === 'local'
    ? `local:${model.modelId}:${model.device}`
    : `ollama:${model.baseUrl}:${model.model}:${model.nativeDims}`
}

function send(port: Electron.MessagePortMain, message: EmbeddingHostResponse): void {
  port.postMessage(message)
}

async function unload(port?: Electron.MessagePortMain): Promise<void> {
  await embedder?.provider.dispose?.()
  await reranker?.reranker.dispose?.()
  embedder = undefined
  reranker = undefined
  if (port !== undefined) send(port, { type: 'unloaded' })
}

async function loadEmbedder(
  port: Electron.MessagePortMain,
  model: EmbeddingHostModel,
): Promise<Loaded> {
  const key = modelKey(model)
  if (embedder?.key === key) return embedder

  // A different model than the one resident: drop it first rather than hold two.
  await unload()
  const startedAt = Date.now()
  const { createOllamaEmbedding, createTransformersEmbedding, requireModel } = await import(
    '@retenia/ingest'
  )

  if (model.kind === 'ollama') {
    const provider = createOllamaEmbedding({
      baseUrl: model.baseUrl,
      model: model.model,
      nativeDims: model.nativeDims,
    })
    embedder = { key, provider }
    send(port, { type: 'loaded', modelId: provider.modelId, device: 'remote', ms: 0 })
    return embedder
  }

  const spec = requireModel(model.modelId, 'embedding')
  const provider = await createTransformersEmbedding({
    spec,
    modelsRoot,
    device: model.device,
  })
  embedder = { key, provider }
  send(port, {
    type: 'loaded',
    modelId: provider.modelId,
    device: provider.device,
    ms: Date.now() - startedAt,
  })
  return embedder
}

async function loadReranker(
  port: Electron.MessagePortMain,
  modelId: string,
  device: EmbeddingHostDevice,
): Promise<LoadedReranker> {
  const key = `rerank:${modelId}:${device}`
  if (reranker?.key === key) return reranker

  await reranker?.reranker.dispose?.()
  const startedAt = Date.now()
  const { createTransformersReranker, requireModel } = await import('@retenia/ingest')
  const local = await createTransformersReranker({
    spec: requireModel(modelId, 'reranker'),
    modelsRoot,
    device,
  })
  reranker = { key, reranker: local }
  send(port, {
    type: 'loaded',
    modelId,
    device: local.device,
    ms: Date.now() - startedAt,
  })
  return reranker
}

async function handle(
  port: Electron.MessagePortMain,
  request: EmbeddingHostRequest,
): Promise<void> {
  switch (request.type) {
    case 'embedQuery': {
      try {
        const { provider } = await loadEmbedder(port, request.model)
        const startedAt = Date.now()
        const { embedQuery } = await import('@retenia/core')
        const vector = await embedQuery(provider, request.text)
        send(port, {
          type: 'embedding',
          id: request.id,
          modelId: provider.modelId,
          vector: encodeVector(vector),
          dims: provider.dims,
          ms: Date.now() - startedAt,
        })
      } catch (error) {
        send(port, {
          type: 'error',
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    case 'rerank': {
      try {
        const loaded = await loadReranker(port, request.modelId, request.device)
        const startedAt = Date.now()
        const results = await loaded.reranker.rerank(request.query, request.documents, {
          ...(request.topN === undefined ? {} : { topN: request.topN }),
        })
        send(port, {
          type: 'reranked',
          id: request.id,
          results: results.map((result) => ({ id: result.id, score: result.score })),
          ms: Date.now() - startedAt,
        })
      } catch (error) {
        send(port, {
          type: 'error',
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    case 'unload':
      await unload(port)
      return

    case 'shutdown':
      await unload()
      port.close()
      process.exit(0)
  }
}

process.parentPort.once('message', (event) => {
  const port = event.ports[0]
  if (port === undefined) {
    console.error('[embedding-host] handshake carried no port; exiting')
    process.exit(1)
  }

  const handshake = embeddingHostHandshakeSchema.safeParse(event.data)
  if (!handshake.success) {
    console.error('[embedding-host] malformed handshake; exiting:', handshake.error.message)
    process.exit(1)
  }
  modelsRoot = handshake.data.modelsRoot

  port.on('message', (message) => {
    const parsed = embeddingHostRequestSchema.safeParse(message.data)
    if (!parsed.success) {
      console.error('[embedding-host] ignored a malformed request:', parsed.error.message)
      return
    }
    // Fire and forget: `handle` reports its own outcome, and awaiting here would block the
    // handler that has to stay free to receive the next query (or a `shutdown`).
    void handle(port, parsed.data)
  })
  port.start()

  const die = (error: unknown): void => {
    console.error('[embedding-host]', error)
    process.exit(1)
  }
  process.on('uncaughtException', die)
  process.on('unhandledRejection', die)

  send(port, { type: 'ready' })
})
