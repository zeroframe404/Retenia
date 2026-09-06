import { randomUUID } from 'node:crypto'
import type { RerankDocument, RerankResult } from '@retenia/core'
import { MessageChannelMain, type MessagePortMain, utilityProcess } from 'electron'
import { log } from '../logging/log'
import {
  decodeVector,
  type EmbeddingHostDevice,
  type EmbeddingHostHandshake,
  type EmbeddingHostModel,
  type EmbeddingHostRequest,
  type EmbeddingHostResponse,
  embeddingHostResponseSchema,
} from './protocol'

/**
 * Main's handle on the model host (`src/worker/embedding-host.ts`): the warm model that
 * answers search queries.
 *
 * It is lazy in both directions. The process is not started until the first query, and it is
 * stopped again after `idleMs` with nothing to do — a search box the user opened once should
 * not leave 300 MB of weights resident for the rest of the session, and a bulk embed running
 * in the job pool must not have to share memory with a warm copy of the same model. The next
 * query pays the reload; `docs/perf/rag.md` records what that costs.
 */

export interface EmbeddingHostOptions {
  entryPath: string
  modelsRoot: string
  /** Stop the host after this long with no request. Defaults to five minutes. */
  idleMs?: number
  /** Fail a request that takes longer than this. Defaults to one minute — enough for a cold
   *  model load on a slow disk, short enough that a wedged host does not hang the UI. */
  requestTimeoutMs?: number
}

export interface EmbeddingHost {
  /** The query vector, in the space `model` names. Starts the host if it is not running. */
  embedQuery(
    model: EmbeddingHostModel,
    text: string,
  ): Promise<{ vector: Float32Array; modelId: string }>
  /** Cross-encoder scores for the fused candidates. */
  rerank(
    modelId: string,
    device: EmbeddingHostDevice,
    query: string,
    documents: readonly RerankDocument[],
    topN?: number,
  ): Promise<readonly RerankResult[]>
  /** True while the child process is up. For diagnostics and tests. */
  isRunning(): boolean
  /** Stops the process and clears the idle timer. Called on quit. */
  stop(): Promise<void>
}

export const DEFAULT_IDLE_MS = 5 * 60_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

interface Pending {
  resolve: (response: EmbeddingHostResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createEmbeddingHost(options: EmbeddingHostOptions): EmbeddingHost {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  let child: Electron.UtilityProcess | undefined
  let port: MessagePortMain | undefined
  let ready: Promise<MessagePortMain> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, Pending>()

  const failAll = (reason: string): void => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    pending.clear()
  }

  const teardown = (reason: string): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = undefined
    port?.close()
    port = undefined
    child = undefined
    ready = undefined
    failAll(reason)
  }

  const armIdleTimer = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      // Only when nothing is in flight: a long rerank must not be killed by its own timer.
      if (pending.size > 0) {
        armIdleTimer()
        return
      }
      log.info('[embedding-host] idle; unloading the model')
      const current = child
      port?.postMessage({ type: 'shutdown' } satisfies EmbeddingHostRequest)
      teardown('the embedding host went idle')
      // The `shutdown` message asks nicely; this is the backstop if the child ignores it.
      setTimeout(() => current?.kill(), 2_000).unref?.()
    }, idleMs)
    idleTimer.unref?.()
  }

  const handle = (raw: unknown): void => {
    const parsed = embeddingHostResponseSchema.safeParse(raw)
    if (!parsed.success) {
      log.warn('[embedding-host] ignored a malformed response:', parsed.error.message)
      return
    }
    const response = parsed.data
    if (response.type === 'loaded') {
      log.info(
        `[embedding-host] ${response.modelId} loaded on ${response.device} in ${response.ms}ms`,
      )
      return
    }
    if (response.type === 'ready' || response.type === 'unloaded') return

    const entry = pending.get(response.id)
    if (entry === undefined) return
    pending.delete(response.id)
    clearTimeout(entry.timer)
    if (response.type === 'error') entry.reject(new Error(response.message))
    else entry.resolve(response)
  }

  const start = (): Promise<MessagePortMain> => {
    if (ready !== undefined) return ready
    ready = new Promise<MessagePortMain>((resolve, reject) => {
      const spawned = utilityProcess.fork(options.entryPath, [], {
        serviceName: 'retenia-embedding-host',
        stdio: 'inherit',
      })
      child = spawned
      const channel = new MessageChannelMain()
      const mine = channel.port1

      let settled = false
      mine.on('message', (message) => {
        const raw: unknown = message.data
        if (!settled && (raw as { type?: unknown })?.type === 'ready') {
          settled = true
          resolve(mine)
          return
        }
        handle(raw)
      })
      mine.start()
      port = mine

      spawned.on('exit', (code) => {
        const reason = `the embedding host exited (code ${code})`
        if (!settled) {
          settled = true
          reject(new Error(reason))
        }
        teardown(reason)
      })

      spawned.postMessage(
        { type: 'handshake', modelsRoot: options.modelsRoot } satisfies EmbeddingHostHandshake,
        [channel.port2],
      )
    })
    // A failed start must not leave a rejected promise cached as "the host": the next query
    // should try again rather than inherit the failure.
    ready.catch(() => {
      ready = undefined
    })
    return ready
  }

  const request = async (message: EmbeddingHostRequest & { id: string }) => {
    const open = await start()
    armIdleTimer()
    return new Promise<EmbeddingHostResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.id)
        reject(new Error(`the embedding host did not answer within ${requestTimeoutMs}ms`))
      }, requestTimeoutMs)
      timer.unref?.()
      pending.set(message.id, { resolve, reject, timer })
      open.postMessage(message)
    })
  }

  return {
    embedQuery: async (model, text) => {
      const response = await request({ type: 'embedQuery', id: randomUUID(), model, text })
      if (response.type !== 'embedding') {
        throw new Error(`the embedding host answered a query with "${response.type}"`)
      }
      return { vector: decodeVector(response.vector, response.dims), modelId: response.modelId }
    },

    rerank: async (modelId, device, query, documents, topN) => {
      const response = await request({
        type: 'rerank',
        id: randomUUID(),
        modelId,
        device,
        query,
        documents: documents.map((document) => ({
          id: document.id,
          text: document.text,
          score: document.score,
        })),
        ...(topN === undefined ? {} : { topN }),
      })
      if (response.type !== 'reranked') {
        throw new Error(`the embedding host answered a rerank with "${response.type}"`)
      }
      return response.results
    },

    isRunning: () => child !== undefined,

    stop: async () => {
      if (child === undefined) return
      const current = child
      port?.postMessage({ type: 'shutdown' } satisfies EmbeddingHostRequest)
      teardown('the embedding host was stopped')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          current.kill()
          resolve()
        }, 2_000)
        timer.unref?.()
        current.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}
