import { dirname, join } from 'node:path'
import type { AiClient, BatchRunner } from '@retenia/ai'
import { mergePricingOverlay, SHIPPED_PRICING } from '@retenia/ai'
import type { SecretStore } from '@retenia/core'
import { createJobRegistry, createJobScheduler, uuidv7 } from '@retenia/core'
import { forwardableEnv } from '@retenia/ingest/sidecars/env'
import type { AiBatchEvent, JobProgressEvent, JobSummary } from '@retenia/ipc-contract'
import { app } from 'electron'
import { createJobDefinitions } from '../../jobs/definitions'
import { type BatchesFacade, createBatchesFacade, createMainBatchRunner } from '../ai/batch'
import { createMainAiClient } from '../ai/client'
import { createFsBlobStore } from '../blobs/store'
import { type AppDatabase, openAppDatabase } from '../db/open'
import { createEmbeddingHost, type EmbeddingHost } from '../embeddings/host'
import { createEmbeddingService, type EmbeddingService } from '../library/embedding-service'
import { createLibraryService, type LibraryService } from '../library/service'
import { log } from '../logging/log'
import {
  getBlobsRoot,
  getBundledSidecarsRoot,
  getDevMediaSamplePath,
  getEmbeddingHostPath,
  getJobWorkerPath,
  getModelsRoot,
  getSidecarsRoot,
  getWorkRoot,
} from '../paths'
import { createSecretStore } from '../secrets/store'
import { createJobsFacade, type JobsFacade } from './facade'
import { createJobPool } from './pool'
import { nodeProcessLiveness } from './process-liveness'
import { createJobRunner, type JobRunner } from './runner'

/**
 * Assembles the whole background-jobs stack: database → scheduler → worker pool → runner →
 * the facade the IPC handlers call.
 *
 * Kept out of `index.ts` because it is the one part of startup with a real failure mode. A
 * corrupt, locked or unreadable database must not stop the window from opening — the user
 * still needs to reach their settings and export diagnostics — so this degrades instead:
 * everything else starts, and the job channels report the failure rather than pretending an
 * empty queue.
 */

export interface JobsSubsystem {
  readonly facade: JobsFacade
  /** The source library (sub-phase 6.1) — import, retry, read back a parse. Degrades the
   *  same way `facade` does when the database did not open. */
  readonly library: LibraryService
  /** Retrieval (sub-phase 6.3): embedding, reindexing and hybrid search. `null` when the
   *  database did not open, which the search channels report rather than answering with an
   *  empty result set. */
  readonly embeddings: EmbeddingService | null
  /** The shared connection jobs, settings, blobs, secrets and backups all read and write
   *  through — `null` when it failed to open, in which case every one of those subsystems
   *  degrades the same way `unavailableFacade` does below. */
  readonly database: AppDatabase | null
  /** API keys, encrypted with `safeStorage` (sub-phase 3.5). Built here rather than in
   *  `main/index.ts` so the AI client below and the `secrets.*` handlers share one instance.
   *  `null` when the database did not open — the store keeps its ciphertext in `settings`. */
  readonly secrets: SecretStore | null
  /** The AI gateway (sub-phase 7.1): role routing, cost log and budget. `null` when the
   *  database did not open, because every one of those three needs it. A getter, not a
   *  plain value: `refreshAiPricing` rebuilds the client in place (7.5's price editor), and
   *  every reader here must see the rebuilt one rather than a snapshot taken at boot. */
  readonly ai: AiClient | null
  /** Re-reads `ai.pricing.overlay` and rebuilds `ai` against it — `packages/ai`'s
   *  `AiClientOptions.pricing` is a plain value, not a resolver, so a changed overlay can
   *  only take effect by constructing a fresh client. No-op when the database did not open. */
  refreshAiPricing(): Promise<void>
  /** The Batch API (sub-phase 7.3): submission, durable polling, reconciliation into
   *  `ai_results`. `null` when the database did not open — a batch that cannot be recorded
   *  cannot be resumed, and submitting one that nothing will ever collect is worse than
   *  refusing. */
  readonly batches: BatchRunner | null
  /** What the `ai.*` IPC channels call. `null` for the same reason `batches` is. */
  readonly batchesFacade: BatchesFacade | null
  /** Recovers orphans and starts claiming. No-op when the database did not open. */
  start(): Promise<void>
  stop(): Promise<void>
}

export interface BootstrapJobsOptions {
  deviceId: string
  emit: (event: JobProgressEvent) => void
  /** Pushes `ai.batchProgress`; the tray's batch rows are driven by it. */
  emitBatch: (event: AiBatchEvent) => void
  /** Pushes `ai.budgetAlert`; the settings screen's budget banner is driven by it. */
  emitBudgetAlert?: (alert: {
    period: string
    threshold: 80 | 100
    spentUsd: number
    capUsd: number
  }) => void
  /** Whether `jobs.enqueueDemo` will queue anything. False in a packaged build. */
  demoEnabled: boolean
}

/** The facade used when the database never opened: every channel says why, rather than
 *  quietly reporting that there is no work. */
function unavailableFacade(reason: string): JobsFacade {
  const fail = (): never => {
    throw new Error(`The job queue is unavailable: ${reason}`)
  }
  return {
    list: async (): Promise<JobSummary[]> => fail(),
    find: fail,
    cancel: fail,
    retry: fail,
    enqueueDemo: fail,
  }
}

/** Same idea, for the library: importing anything needs the database it records sources in. */
function unavailableLibraryService(reason: string): LibraryService {
  const fail = (): never => {
    throw new Error(`The source library is unavailable: ${reason}`)
  }
  return {
    addFromFile: fail,
    addFromBytes: fail,
    addCourseFromFolder: fail,
    createCardFromClip: fail,
    addFromText: fail,
    addFromUrl: fail,
    retry: fail,
    list: fail,
    get: fail,
    getDoc: fail,
    getChunks: fail,
    getUnits: fail,
    estimateContextualization: fail,
    contextualize: fail,
    rechunkStaleSources: fail,
    createCardFromChunk: fail,
    remove: fail,
    onJobSettled: fail,
    listAnnotations: fail,
    createAnnotation: fail,
    updateAnnotation: fail,
    deleteAnnotation: fail,
    createCardFromAnnotation: fail,
    recordProgress: fail,
    listRecentlyOpened: fail,
  }
}

export function bootstrapJobs({
  deviceId,
  emit,
  emitBatch,
  emitBudgetAlert,
  demoEnabled,
}: BootstrapJobsOptions): JobsSubsystem {
  let database: AppDatabase
  try {
    database = openAppDatabase(deviceId)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.error('[jobs] the database did not open; background jobs are disabled:', reason)
    return {
      facade: unavailableFacade(reason),
      library: unavailableLibraryService(reason),
      embeddings: null,
      secrets: null,
      ai: null,
      refreshAiPricing: async () => {},
      batches: null,
      batchesFacade: null,
      database: null,
      start: async () => {},
      stop: async () => {},
    }
  }

  /**
   * Where a job may read from. Everything the app owns lives under the blob store; the dev
   * media sample sits in the packaged resources and is what the demo `hashFile` hashes.
   *
   * Passed to the workers in their handshake, so the confinement travels with the definition
   * rather than depending on every enqueuer to have checked.
   */
  // `getWorkRoot()` is where the optimizer stages its training CSV (sub-phase 4.6).
  // `getModelsRoot()` is where the two model-aware jobs of sub-phase 6.3 write ONNX
  // weights; it is a readable root *and* is named explicitly in the handshake, because it is
  // the one directory outside the blob store a job may write to.
  // `getSidecarsRoot()` is sub-phase 6.4's: the third directory outside the blob store a job
  // writes to, and the only one whose contents are then *executed*. It is bounded by the fact
  // that only `installSidecar` writes there, every archive is checked against the SHA-256 in
  // `packages/ingest/src/sidecars/manifest.json` before it is unpacked, and only the binaries
  // that manifest names are ever spawned.
  const modelsRoot = getModelsRoot()
  const binRoot = getSidecarsRoot()
  const readableRoots = [
    getBlobsRoot(),
    getWorkRoot(),
    modelsRoot,
    binRoot,
    dirname(getDevMediaSamplePath()),
  ]

  // The worker is forked with an empty environment so a provider key can never reach a
  // parser, which also means it cannot read the handful of variables a spawned ffmpeg needs.
  // Main reads them here and passes them through the handshake.
  const hostEnv = forwardableEnv(process.env)
  const sidecars = {
    binRoot,
    bundledRoot: getBundledSidecarsRoot(),
    // A checkout's `.sidecars/`, so `node tooling/download-sidecars.ts --install` is enough to
    // work on the media pipeline without the app downloading anything.
    ...(app.isPackaged ? {} : { devRoot: join(app.getAppPath(), '..', '..', '.sidecars') }),
    hostEnv,
  }

  const registry = createJobRegistry(createJobDefinitions(readableRoots, modelsRoot, sidecars))

  // Minted per launch, not persisted: its whole job is to be different from the id any
  // previous run stamped into a lease, so recovery can recognise stranded work without
  // having to trust a pid the OS may since have reused.
  const runId = uuidv7()

  // `ownWorkerPids` is read lazily through the runner because the pool does not exist yet —
  // and must not, since the runner is what wires it. Recovery calls this only while it runs,
  // by which time every reference below is bound.
  let runner: JobRunner
  const scheduler = createJobScheduler({
    jobs: database.repos.jobs,
    clock: { now: () => new Date() },
    liveness: nodeProcessLiveness,
    registry,
    runId,
    ownWorkerPids: () => runner.livePids(),
  })

  // The same root the worker's own `BlobStore` (`apps/desktop/src/jobs/ingest-parse.ts`,
  // `readableRoots[0]`) writes into. Both are pure `node:fs`, so a second instance here
  // needs no coordination with the worker's.
  const blobStore = createFsBlobStore(getBlobsRoot())

  // Both are needed before `library` below. Built here, once, so the `secrets.*` IPC
  // handlers and the AI client that reads keys through them share one instance.
  const secrets = createSecretStore(database.repos.settings)
  // Reassigned by `refreshAiPricing` (7.5's price editor), never by anything else — every
  // reference below closes over this binding rather than destructuring its value, so a
  // rebuild is visible to `contextualizationPricing` and to the returned facade's `ai`
  // getter without either being told about it explicitly.
  let ai = createMainAiClient({ repos: database.repos, secrets, onBudgetAlert: emitBudgetAlert })
  const refreshAiPricing = async (): Promise<void> => {
    try {
      const overlay = await database.repos.settings.get('ai.pricing.overlay')
      ai = createMainAiClient({
        repos: database.repos,
        secrets,
        onBudgetAlert: emitBudgetAlert,
        pricing: mergePricingOverlay(SHIPPED_PRICING, overlay),
      })
    } catch (error) {
      log.error('[ai] could not rebuild the client with the new pricing overlay:', error)
    }
  }
  // The Batch API's own runner (sub-phase 7.3). It shares the client's repositories and key
  // store rather than opening its own: one cost log, one answer store, one budget.
  const batches = createMainBatchRunner({
    repos: database.repos,
    secrets,
    ai,
    emit: emitBatch,
  })

  // The warm model host (sub-phase 6.3). Lazy in both directions: nothing is spawned until
  // the first query, and it unloads again after an idle timeout — a search box the user
  // opened once must not leave 300 MB of weights resident, and a bulk embed in the pool must
  // not have to share memory with a warm copy of the same model.
  const host: EmbeddingHost = createEmbeddingHost({
    entryPath: getEmbeddingHostPath(),
    modelsRoot,
  })
  // Constructed before `library`, which needs its `embedSource` to chain into once a source's
  // chunk job succeeds (`library/service.ts`'s `onChunkSettled`) — the reindex sweep below is
  // no longer the only caller.
  const embeddings = createEmbeddingService({
    repos: database.repos,
    sqlite: database.opened.sqlite,
    blobStore,
    scheduler,
    host,
    ids: database.ids,
    getSetting: (key) => database.repos.settings.get(key),
  })
  const library = createLibraryService({
    repos: database.repos,
    blobStore,
    scheduler,
    embedSource: embeddings.embedSource,
    // The line that retires `ContextualizationUnavailableError`, three sub-phases after 6.2
    // left the contextual-retrieval pass waiting for a provider.
    textGenerator: ai.textGenerator({ role: 'cheap', purpose: 'contextualize' }),
    // …and the line that stops the quote and the charge drifting apart: the estimator has
    // been defaulting to Haiku 4.5 *via Batch* while the `cheap` role actually charges
    // Gemini 3.7 Flash at full price.
    contextualizationPricing: () => ai.ratesFor('cheap'),
  })

  runner = createJobRunner({
    scheduler,
    emit,
    onSettled: async (job) => {
      await library.onJobSettled(job)
      await embeddings.onJobSettled(job)
    },
    createPool: (handlers) =>
      createJobPool({
        ...handlers,
        entryPath: getJobWorkerPath(),
        readableRoots,
        modelsRoot,
        binRoot,
        hostEnv,
      }),
  })

  return {
    facade: createJobsFacade({ scheduler, runner, demoEnabled }),
    library,
    embeddings,
    secrets,
    get ai() {
      return ai
    },
    refreshAiPricing,
    batches,
    batchesFacade: createBatchesFacade(batches),
    database,
    start: async () => {
      await runner.start()

      // Sub-phase 7.3's acceptance criterion, in one call: whatever the previous run left in
      // flight is picked up where it left off. Queued rather than awaited — a provider that
      // is slow to answer must not hold up the rest of startup, and a failure here costs the
      // resumption of one batch, never the app.
      batches
        .resume()
        .then((resumed) => {
          if (resumed.length > 0) {
            log.info(`[ai] resumed polling ${resumed.length} batch(es) left by the last run`)
          }
        })
        .catch((error: unknown) => {
          log.error('[ai] could not resume the batches left in flight:', error)
        })
      // The reindex sweep of sub-phase 6.2: a build whose chunking rules or tokenizer changed
      // leaves every source's chunks cut at the wrong boundaries, and nothing else would ever
      // notice. Queued, not awaited — it is minutes of CPU on a large library, and startup
      // does not wait for it. A failure here costs retrieval quality, never the app.
      library
        .rechunkStaleSources()
        .then((queued) => {
          if (queued.length > 0) {
            log.info(`[jobs] queued ${queued.length} source(s) for re-chunking`)
          }
        })
        .catch((error: unknown) => {
          log.error('[jobs] the re-chunk sweep failed:', error)
        })

      // The reindex sweep of sub-phase 6.3, the vector counterpart of the one above: every
      // source that is not in the active embedding space — never embedded, last run failed,
      // or embedded under a model the user has since switched away from. Queued rather than
      // awaited for the same reason, and a failure here costs retrieval, never the app.
      embeddings
        .reindexStaleSources()
        .then((queued) => {
          if (queued.length > 0) {
            log.info(`[jobs] queued ${queued.length} source(s) for embedding`)
          }
        })
        .catch((error: unknown) => {
          log.error('[jobs] the embedding sweep failed:', error)
        })
    },
    stop: async () => {
      batches.stop()
      await runner.stop()
      await host.stop()
      database.close()
    },
  }
}
