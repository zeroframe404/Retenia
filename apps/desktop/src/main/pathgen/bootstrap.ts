import { createActivityAuthor, createItemAuthor } from '@retenia/activity-ai'
import type { AiClient, AiRegistry, BatchRunner } from '@retenia/ai'
import { realTimers } from '@retenia/ai'
import { bundledPromptReader } from '@retenia/ai/prompts-bundled'
import type { Clock, EmbeddingProvider } from '@retenia/core'
import { detectLanguage } from '@retenia/ingest'
import type { PathgenLessonStatusEvent, PathgenProgressEvent } from '@retenia/ipc-contract'
import {
  buildItemBank,
  createExpansionRun,
  createGenerationRun,
  createQaPipeline,
  examCellsDue,
  type GenerationConfigInput,
  type PathgenLogger,
  quoteConfig as quoteGenerationConfig,
  reconcileItemBank,
} from '@retenia/pathgen'
import { loadPathgenPrompts } from '@retenia/pathgen/node'
import { buildAiResultCache } from '../ai/client'
import type { AppDatabase } from '../db/open'
import type { EmbeddingService } from '../library/embedding-service'
import { log } from '../logging/log'
import { createDiagnosticService, type DiagnosticMemory } from './diagnostic-service'
import { createPathgenFacade, type PathgenFacade } from './facade'
import { createItemBankService } from './item-bank-service'

/** §10's deferred verification runs daily: at startup, then every 24 hours while open. */
const VERIFY_EVERY_MS = 24 * 60 * 60 * 1000

/**
 * Wires `createGenerationRun` (sub-phase 8.1's orchestrator) and the wizard's quote against
 * the already-open database and the already-built AI client from `bootstrapJobs` — no second
 * database connection, no second client (`docs/spec/07-architecture.md` §5: main is the single
 * writer).
 */

export interface BootstrapPathgenOptions {
  readonly database: AppDatabase
  readonly ai: AiClient
  readonly registry: () => Promise<AiRegistry>
  /** Pushes `pathgen.progress`. */
  readonly emit: (event: PathgenProgressEvent) => void
  /** Pushes `pathgen.lessonStatus` — one row of the expansion panel changed. */
  readonly emitLesson?: (event: PathgenLessonStatusEvent) => void
  /**
   * The Batch API runner, so stage 7's tail costs half price and P1 stops running every
   * chunk synchronously (`docs/spec/06-ai-providers.md` §2). `null` when the AI layer could
   * not be built; every call then goes through `AiClient.structured`, which is correct and
   * simply more expensive.
   */
  readonly batches?: BatchRunner | null
  /** Retrieval and the flashcard dedupe. Absent means mapped chunks only and exact fronts. */
  readonly embeddings?: EmbeddingService | null
  /** The memory service, for the diagnostic's seeding and its deferred verification (8.5). */
  readonly memory?: DiagnosticMemory | null
  readonly clock?: Clock
}

const pathgenLogger: PathgenLogger = {
  warn: (message) => log.warn(message),
  error: (message, error) => log.error(message, error),
}

export function bootstrapPathgen({
  database,
  ai,
  registry,
  emit,
  emitLesson,
  batches,
  embeddings,
  memory = null,
  clock = { now: () => new Date() },
}: BootstrapPathgenOptions): PathgenFacade {
  // The bundled reader, not the disk one: `@retenia/ai` is inlined into `out/main/index.js`
  // (it ships TypeScript with no build step), so its `PROMPTS_ROOT` would resolve to
  // `apps/desktop/prompts` and the main process would die on startup before opening a window.
  const prompts = loadPathgenPrompts(bundledPromptReader)
  const repos = database.repos
  const resultCache = buildAiResultCache(repos)

  /**
   * The embedding service as `@retenia/core`'s port.
   *
   * `modelId` and `dims` are getters because neither is knowable synchronously — which model
   * is active is a setting, and the width is whatever that model returns — while the port
   * declares them as plain fields. They start unknown and are corrected by the first call
   * that succeeds, which is in time for the manifest, written at the stage boundary after it.
   *
   * `embed` returns `[]` rather than throwing when nothing is configured: consolidation
   * treats a provider that cannot deliver a vector per text as no provider at all and says so
   * with `embeddings_unavailable`, which is the honest outcome of "the user has not chosen an
   * embedding model" — not a failed generation.
   */
  let embeddingModelId = 'unknown'
  let embeddingDims = 0
  const embeddingPort: EmbeddingProvider | undefined =
    embeddings === null || embeddings === undefined
      ? undefined
      : {
          get modelId() {
            return embeddingModelId
          },
          get dims() {
            return embeddingDims
          },
          embed: async (texts) => {
            const answer = await embeddings.embedMany(texts)
            // `undefined` means no model resolved or the host threw. Returning `[]` here read
            // as "no duplicates found" to every caller, which is the opposite of the truth;
            // throwing is what the ports' callers already handle.
            if (answer === undefined) {
              throw new Error('no embedding model is available')
            }
            embeddingModelId = answer.modelId
            embeddingDims = answer.vectors[0]?.length ?? embeddingDims
            return answer.vectors
          },
        }

  const runs = createGenerationRun({
    ai,
    registry,
    repos,
    prompts,
    resultCache,
    ...(batches === null || batches === undefined ? {} : { runner: batches }),
    ...(embeddingPort === undefined ? {} : { embeddings: embeddingPort }),
    progress: {
      report: (event) => {
        emit({
          runId: event.runId,
          stage: event.stage,
          done: event.done,
          total: event.total,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        })
      },
    },
    clock,
    timers: realTimers,
    logger: pathgenLogger,
  })

  /**
   * Stage 8 (sub-phase 8.4): the QA gates, over the same client, cache and runner. The
   * language detector is `@retenia/ingest`'s own — the one that labelled the sources — so a
   * lesson and the document it was written from are judged by the same ear.
   */
  const qa = createQaPipeline({
    ai,
    registry,
    ...(batches === null || batches === undefined ? {} : { runner: batches }),
    resultCache,
    prompts,
    repos: { paths: repos.paths, chunks: repos.chunks, knowledgeItems: repos.knowledgeItems },
    ...(embeddingPort === undefined ? {} : { embeddings: embeddingPort }),
    detectLanguage,
    clock,
    timers: realTimers,
    logger: pathgenLogger,
  })

  /**
   * Stage 9 (sub-phase 8.5): the item bank over the same client, cache, runner and embedding
   * port, and the diagnostic over the memory service. The vectors map is shared by every
   * reconcile of the process, so a stem is embedded once however many lessons land.
   */
  const bankVectors = new Map<string, Float32Array | null>()
  const itemAuthor = createItemAuthor({ prompt: prompts.items })
  const itemBank = createItemBankService({
    repos: { itemBank: repos.itemBank },
    build: (input) =>
      buildItemBank(
        {
          ai,
          ...(batches === null || batches === undefined ? {} : { runner: batches }),
          resultCache,
          author: itemAuthor,
          repos: {
            paths: repos.paths,
            itemBank: repos.itemBank,
            chunks: repos.chunks,
            exams: repos.exams,
            transaction: (work) => repos.transaction((tx) => work(tx)),
          },
          prompts,
          ...(embeddingPort === undefined ? {} : { embeddings: embeddingPort }),
          clock,
          timers: realTimers,
          logger: pathgenLogger,
        },
        input,
      ),
    reconcile: (input) =>
      reconcileItemBank(
        {
          repos: { paths: repos.paths, itemBank: repos.itemBank },
          ...(embeddingPort === undefined ? {} : { embeddings: embeddingPort }),
          vectors: bankVectors,
        },
        input,
      ),
    examDue: (pathVersionId) =>
      examCellsDue({ paths: repos.paths, itemBank: repos.itemBank }, pathVersionId),
  })
  const diagnostics = createDiagnosticService({ repos, memory, clock })

  /**
   * Stage 7 (sub-phase 8.3): the same client, cache and runner, plus the three things only
   * expansion needs — the activity author, retrieval and the embedding port — and, since
   * 8.4, the gates that decide when a lesson is `ready`.
   */
  const expansion = createExpansionRun({
    ai,
    registry,
    ...(batches === null || batches === undefined ? {} : { runner: batches }),
    resultCache,
    author: createActivityAuthor({ prompt: prompts.activities }),
    qa,
    repos: {
      paths: repos.paths,
      chunks: repos.chunks,
      knowledgeItems: repos.knowledgeItems,
      cards: repos.cards,
      transaction: (work) => repos.transaction((tx) => work(tx)),
    },
    runs: { paths: repos.paths, generationRuns: repos.generationRuns },
    prompts,
    ...(embeddingPort === undefined ? {} : { embeddings: embeddingPort }),
    ...(embeddings === null || embeddings === undefined
      ? {}
      : {
          retrieve: (query, options) => embeddings.search(query, { ...options, mode: 'hybrid' }),
        }),
    clock,
    timers: realTimers,
    logger: pathgenLogger,
    onProgress: (progress) => {
      emit({
        runId: progress.runId,
        stage: progress.stage,
        done: progress.done,
        total: progress.total,
        ...(progress.lessonSpecId === undefined && progress.batchId === undefined
          ? {}
          : {
              detail: {
                ...(progress.lessonSpecId === undefined
                  ? {}
                  : { lessonSpecId: progress.lessonSpecId }),
                ...(progress.batchId === undefined ? {} : { batchId: progress.batchId }),
              },
            }),
      })
    },
    onLesson: (lesson) => {
      emitLesson?.(lesson)
      // A finished lesson is where stage 9 meets stage 7 (8.5): the lesson wins over any bank
      // item that repeats one of its exercises, and a lesson of a module marked known gets
      // its freshly written cards seeded. Both are fire-and-forget and log their own failures.
      if (lesson.status === 'ready') {
        void itemBank.reconcileLesson({
          pathVersionId: lesson.pathVersionId,
          lessonId: lesson.lessonId,
          lessonSpecId: lesson.specId,
        })
        void diagnostics
          .onLessonExpanded(lesson.pathVersionId, lesson.lessonId)
          .catch((error: unknown) =>
            log.warn(
              `[pathgen] seeding lesson ${lesson.specId} from the diagnostic failed:`,
              error,
            ),
          )
      }
      // The exam's items wait for every lesson (their weights carry the measured coverage):
      // the last one to settle, whether it passed or failed, is what starts them.
      if (lesson.status === 'ready' || lesson.status === 'failed') {
        void itemBank.onLessonSettled(lesson.pathVersionId)
      }
    },
  })

  /**
   * The diagnostic's two sweeps: cards written while the app was closed for a module marked
   * known, and §10's deferred verification — daily, as a timer that never holds the process
   * open. Main runs them rather than the job worker because both write the database, and the
   * worker's `utilityProcess` never does.
   */
  void diagnostics
    .sweepPendingSeeds()
    .catch((error: unknown) => log.warn('[pathgen] the pending-seed sweep failed:', error))
  const verify = () =>
    diagnostics
      .verifyKnownModules()
      .then(({ reopened }) => {
        if (reopened > 0) log.info(`[pathgen] re-opened ${reopened} module(s) marked known`)
      })
      .catch((error: unknown) => log.warn('[pathgen] the deferred verification failed:', error))
  void verify()
  setInterval(() => void verify(), VERIFY_EVERY_MS).unref()

  /**
   * The startup resume sweep `generationRuns.listActive()` was written for and nothing ever
   * called.
   *
   * Sub-phase 8.3 is what needs it: a batch may take up to 24 hours, so an expansion can
   * outlive the process that started it, and the ids of the batches in flight are already on
   * the run's `progress`. Fire-and-forget — a run that cannot be picked up is a logged
   * warning, never a reason to hold up the window.
   */
  void expansion
    .active()
    .then(async (rows) => {
      for (const row of rows) {
        log.info(`[pathgen] resuming expansion ${row.id}`)
        await expansion.resume(row.id)
      }
    })
    .catch((error: unknown) => log.warn('[pathgen] an expansion could not be resumed:', error))

  return createPathgenFacade({
    runs,
    expansion,
    repos,
    clock,
    itemBank,
    diagnostics,
    quote: async (config: GenerationConfigInput) => {
      const { estimate } = await quoteGenerationConfig({ ai, repos, prompts }, config)
      return { estimate, warnings: [] }
    },
  })
}
