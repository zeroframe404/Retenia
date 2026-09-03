import type {
  Clock,
  IdGenerator,
  Repositories,
  Reranker,
  TransactionOptions,
  UnitOfWork,
} from '@retenia/core'
import { createUuidV7Generator, systemClock } from '@retenia/core'
import type { VectorIndex } from '../hybrid-search'
import type { OpenedDatabase } from '../open-database'
import { createAiCallRepository } from './ai-calls'
import { createAttemptRepository } from './attempts'
import { createBlobRepository } from './blobs'
import { createCardRepository } from './cards'
import { createChunkRepository } from './chunks'
import { auditValues, type RepositoryContext } from './context'
import { createExamRepository, createItemBankRepository } from './exams'
import { createGamificationRepository } from './gamification'
import { createImportanceLevelRepository } from './importance-levels'
import { createJobRepository } from './jobs'
import { createKnowledgeItemRepository } from './knowledge-items'
import { createOutboxRepository } from './outbox'
import { createOutboxWriter, disabledOutboxWriter } from './outbox-writer'
import { createPathRepository } from './paths'
import { createReviewLogRepository } from './review-logs'
import { createSettingsRepository } from './settings'
import { createSourceRepository } from './sources'
import { createTransactionRunner, type TransactionState } from './transaction'

export interface RepositoryOptions {
  /** Stamped into every row's `device_id`. Comes from `app.deviceId` in settings, minted
   *  on first run (sub-phase 3.5). */
  deviceId: string
  clock?: Clock
  ids?: IdGenerator
  /**
   * Whether every mutation also appends an `outbox` row. **Off in v1** — there is nothing
   * to sync to yet, so the table stays empty (`docs/spec/07-architecture.md` §6). Read once
   * at startup and fixed for the process: a flag that flipped between two writes of one
   * transaction would be impossible to reason about.
   */
  outboxEnabled?: boolean
  /**
   * Where chunk vectors live. Defaults to sqlite-vec over the same connection; a corpus past
   * ~200k chunks (`docs/spec/05-ingestion-rag.md` §3) swaps in a LanceDB implementation here
   * without any other change.
   */
  vectorIndex?: VectorIndex
  /**
   * The optional last stage of hybrid retrieval (a local cross-encoder, or Cohere/Voyage).
   * Absent means the RRF order is final, which is what v1 ships.
   */
  reranker?: Reranker
}

/**
 * Builds the whole repository set over one open database.
 *
 * The returned object *is* the `Repositories` bag and also carries `transaction`. Because
 * `withTransaction` issues `BEGIN`/`COMMIT` on the underlying connection rather than
 * swapping handles, the same repository instances are transactional inside the callback —
 * there is no second, "transactional" set to get wrong.
 */
export function createRepositories(opened: OpenedDatabase, options: RepositoryOptions): UnitOfWork {
  const clock = options.clock ?? systemClock
  const ids = options.ids ?? createUuidV7Generator(clock)
  const state: TransactionState = { depth: 0 }
  const run = createTransactionRunner(opened, state)

  let ctx: RepositoryContext
  const outbox =
    options.outboxEnabled === true
      ? createOutboxWriter(
          () => ctx,
          () => auditValues(ctx),
        )
      : disabledOutboxWriter

  ctx = {
    db: opened.db,
    clock,
    ids,
    deviceId: options.deviceId,
    outbox,
    run,
    ...(options.vectorIndex === undefined ? {} : { vectorIndex: options.vectorIndex }),
    ...(options.reranker === undefined ? {} : { reranker: options.reranker }),
  }

  const repositories: Repositories = {
    aiCalls: createAiCallRepository(ctx),
    attempts: createAttemptRepository(ctx),
    blobs: createBlobRepository(ctx),
    cards: createCardRepository(ctx),
    chunks: createChunkRepository(ctx),
    exams: createExamRepository(ctx),
    gamification: createGamificationRepository(ctx),
    importanceLevels: createImportanceLevelRepository(ctx),
    itemBank: createItemBankRepository(ctx),
    jobs: createJobRepository(ctx),
    knowledgeItems: createKnowledgeItemRepository(ctx),
    outbox: createOutboxRepository(ctx),
    paths: createPathRepository(ctx),
    reviewLogs: createReviewLogRepository(ctx),
    settings: createSettingsRepository(ctx),
    sources: createSourceRepository(ctx),
  }

  return {
    ...repositories,
    transaction: <T>(
      work: (repos: Repositories) => Promise<T> | T,
      transactionOptions?: TransactionOptions,
    ): Promise<T> => run(() => work(repositories), transactionOptions),
  }
}

/**
 * Runs `work` in one transaction over an existing repository set — the standalone form of
 * `UnitOfWork.transaction`, for callers holding only the bag.
 */
export function withTransaction<T>(
  unitOfWork: UnitOfWork,
  work: (repos: Repositories) => Promise<T> | T,
  options?: TransactionOptions,
): Promise<T> {
  return unitOfWork.transaction(work, options)
}

export type { RepositoryContext } from './context'
export { ConstraintViolationError } from './errors'
export { SYNCABLE_TABLES } from './outbox-writer'
