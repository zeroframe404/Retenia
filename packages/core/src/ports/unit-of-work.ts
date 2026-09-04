import type { ActivityStatsRepository } from './activity-stats-repository'
import type { AiCallRepository } from './ai-call-repository'
import type { AttemptRepository } from './attempt-repository'
import type { BlobRepository } from './blob-repository'
import type { CardRepository } from './card-repository'
import type { ChunkRepository } from './chunk-repository'
import type { ExamRepository } from './exam-repository'
import type { GamificationRepository } from './gamification-repository'
import type { ImportanceLevelRepository } from './importance-level-repository'
import type { ItemBankRepository } from './item-bank-repository'
import type { JobRepository } from './job-repository'
import type { KnowledgeItemRepository } from './knowledge-item-repository'
import type { OutboxRepository } from './outbox-repository'
import type { PathRepository } from './path-repository'
import type { ReviewLogRepository } from './review-log-repository'
import type { ReviewSessionRepository } from './review-session-repository'
import type { SettingsRepository } from './settings-repository'
import type { SourceRepository } from './source-repository'
import type { StatsRepository } from './stats-repository'

/** Every repository, in one bag. A use case takes this (or the one port it needs) and
 *  never knows which adapter is underneath. */
export interface Repositories {
  /** Derived, disposable: the rolling per-type median behind §10's "personal median". */
  activityStats: ActivityStatsRepository
  aiCalls: AiCallRepository
  attempts: AttemptRepository
  blobs: BlobRepository
  cards: CardRepository
  chunks: ChunkRepository
  exams: ExamRepository
  gamification: GamificationRepository
  importanceLevels: ImportanceLevelRepository
  itemBank: ItemBankRepository
  jobs: JobRepository
  knowledgeItems: KnowledgeItemRepository
  outbox: OutboxRepository
  paths: PathRepository
  reviewLogs: ReviewLogRepository
  reviewSessions: ReviewSessionRepository
  settings: SettingsRepository
  sources: SourceRepository
  /** Read-only projections for the statistics screen (§13). */
  stats: StatsRepository
}

export interface TransactionOptions {
  /**
   * How the transaction takes its lock. `immediate` (the default) grabs the write lock up
   * front: a `deferred` transaction that reads and then writes has to *upgrade*, and a
   * failed upgrade raises `SQLITE_BUSY_SNAPSHOT`, which no busy handler can retry.
   */
  behavior?: 'deferred' | 'immediate' | 'exclusive'
}

/**
 * The transactional boundary.
 *
 * `work` receives a `Repositories` bound to the transaction — use *those*, not the
 * ambient ones, or the writes land outside it.
 *
 * **`work` must only await calls on the repositories it is given.** Awaiting real I/O
 * (network, the file system, an IPC round trip, an AI call) inside a transaction parks it
 * open across an event-loop turn, during which unrelated writes on the same connection
 * would silently enlist and the write lock would block every other reader. Do the I/O
 * first, then open the transaction with the results in hand.
 */
export interface UnitOfWork extends Repositories {
  transaction<T>(
    work: (repos: Repositories) => Promise<T> | T,
    options?: TransactionOptions,
  ): Promise<T>
}
