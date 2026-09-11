import type {
  AiClient,
  AiRegistry,
  AiResultCache,
  BatchRunner,
  Timers,
  TokenCounter,
} from '@retenia/ai'
import type {
  CardRepository,
  ChunkRepository,
  ChunkSearchHit,
  Clock,
  EmbeddingProvider,
  KnowledgeItemRepository,
  PathRepository,
} from '@retenia/core'
import type { PathgenLogger } from '../logger'
import type { PathgenPrompts } from '../prompts'
import type { QaPipeline } from '../qa/pipeline'
import type { ActivityAuthor } from './activity-author'
import type { ExpandProgress, LessonProgress } from './expand-lessons'

/**
 * Everything stage 7 reaches, as ports — the arrangement `run/deps.ts` uses for stages 3–5,
 * narrowed with `Pick` so a reader can see exactly what expansion may do to the database and
 * so the tests' fakes are as small as the list.
 *
 * Expansion writes to three aggregates and reads from two, which is why `transaction` is
 * wider here than the generation run's: a lesson's flashcards are `knowledge_items` **and**
 * `cards`, and an item with no card is a row nothing will ever show the learner.
 */

export interface ExpandRepos {
  readonly paths: Pick<
    PathRepository,
    | 'findById'
    | 'findVersion'
    | 'loadTree'
    | 'findLesson'
    | 'updateLesson'
    | 'listActivities'
    | 'createActivities'
    | 'softDeleteActivity'
  >
  readonly chunks: Pick<ChunkRepository, 'findMany'>
  readonly knowledgeItems: Pick<KnowledgeItemRepository, 'listByLesson' | 'create'>
  readonly cards: Pick<CardRepository, 'create'>
  transaction<T>(
    work: (repos: Pick<ExpandRepos, 'paths' | 'knowledgeItems' | 'cards'>) => Promise<T>,
  ): Promise<T>
}

/**
 * Top-k retrieval for one lesson (`docs/spec/04-path-generation.md` §3 stage 7's "mapped +
 * top-k by retrieval").
 *
 * A function rather than `ChunkRepository.search` because `ChunkSearchOptions` demands the
 * query *vector* for its hybrid mode, and minting one is the embedding service's business —
 * it already resolves the active model, keeps the host warm and degrades to full text when it
 * cannot embed. Absent, a lesson is written from its mapped fragments alone.
 */
export type RetrieveChunks = (
  query: string,
  options: { readonly k: number; readonly pathId: string },
) => Promise<readonly ChunkSearchHit[]>

export interface ExpandConcurrency {
  /** Lessons expanded at once in the synchronous head and in any sync fallback. */
  readonly lessons: number
  /** P4 family calls in flight for one lesson. */
  readonly families: number
}

export const DEFAULT_EXPAND_CONCURRENCY: ExpandConcurrency = Object.freeze({
  lessons: 2,
  families: 4,
})

export interface ExpandDeps {
  readonly ai: Pick<AiClient, 'structured'>
  /**
   * Only to resolve the profile and model the P3 prefix is cached against: a provider's
   * minimum cacheable prefix is per-model, so `withCache` cannot decide without it.
   */
  readonly registry: () => Promise<AiRegistry>
  /** Absent means every call is synchronous, whatever the wizard said. */
  readonly runner?: Pick<BatchRunner, 'runJob' | 'poll' | 'list' | 'cancel'>
  /** `ai_results` — where a batch's answers land and where a resumed run reads them. */
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly author: ActivityAuthor
  /**
   * Stage 8 (sub-phase 8.4). Absent, a lesson is `ready` the moment its cards land, exactly
   * as before the gates existed — which is what every stage-7 test relies on, and what a
   * caller that only wants the writing gets. Main always wires it.
   */
  readonly qa?: QaPipeline
  readonly repos: ExpandRepos
  readonly prompts: Pick<PathgenPrompts, 'lesson' | 'activities' | 'flashcards'>
  /** Absent means flashcards are deduped on the exact front only, and the run says so. */
  readonly embeddings?: Pick<EmbeddingProvider, 'embed'>
  readonly retrieve?: RetrieveChunks
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly countTokens?: TokenCounter
  readonly logger: PathgenLogger
  readonly concurrency?: Partial<ExpandConcurrency>
  readonly onProgress?: (progress: ExpandProgress) => void
  readonly onLesson?: (lesson: LessonProgress) => void
  /** Fires as soon as a batch is submitted, so its id is persisted before anything waits. */
  readonly onBatch?: (batchId: string) => void | Promise<void>
}
