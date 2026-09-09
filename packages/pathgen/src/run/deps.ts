import type {
  AiClient,
  AiRegistry,
  AiResultCache,
  BatchRunner,
  Timers,
  TokenCounter,
} from '@retenia/ai'
import type {
  ChunkRepository,
  Clock,
  EmbeddingProvider,
  ExtractionRepository,
  GenerationRunRepository,
  PathRepository,
  SourceRepository,
} from '@retenia/core'
import type { PathgenLogger } from '../logger'
import type { ProgressReporter } from '../progress/reporter'
import type { PathgenPrompts } from '../prompts'
import type { SequencingOptions, SequencingResult } from '../sequencing'
import type { SequencingConfig } from '../sequencing/types'
import type { ValidatedSynthesis } from '../validate/types'

/**
 * Everything a generation run reaches, as ports.
 *
 * Narrowed with `Pick` to the calls the run makes, so the in-memory fakes of the tests are
 * as small as the list below and so a reader can see what the run may do to the database:
 * read sources and chunks, create and update its own path and run rows, add a version, and
 * upsert extractions. Nothing here deletes.
 */

export interface GenerationRepos {
  readonly sources: Pick<SourceRepository, 'findMany'>
  readonly chunks: Pick<ChunkRepository, 'listBySource'>
  readonly paths: Pick<
    PathRepository,
    'findById' | 'create' | 'update' | 'createVersion' | 'findVersion'
  >
  readonly generationRuns: Pick<
    GenerationRunRepository,
    'findById' | 'create' | 'update' | 'listActive' | 'findLatestByPath'
  >
  readonly extractions: Pick<ExtractionRepository, 'findByCustomIds' | 'put'>
  /**
   * `UnitOfWork.transaction`, for the one write that must be atomic: the draft, its version
   * and the run's completion. The work it is given only touches the repositories it receives.
   */
  transaction<T>(
    work: (repos: Pick<GenerationRepos, 'paths' | 'generationRuns'>) => Promise<T>,
  ): Promise<T>
}

export type Sequencer = (
  validated: ValidatedSynthesis,
  config: SequencingConfig,
  options: SequencingOptions,
) => SequencingResult

export interface GenerationConcurrency {
  /** P1 calls in flight when somebody is waiting. */
  readonly extract: number
  /** P2 module calls in flight, after the first. */
  readonly modules: number
}

export const DEFAULT_GENERATION_CONCURRENCY: GenerationConcurrency = Object.freeze({
  extract: 6,
  modules: 3,
})

export interface GenerationRunDeps {
  readonly ai: AiClient
  /** Absent means every call is synchronous, whatever the wizard's "economy mode" says. */
  readonly runner?: BatchRunner
  /** `ai_results`, so a batch's answers can be read back and a resumed run replays. */
  readonly resultCache?: AiResultCache
  readonly registry: () => Promise<AiRegistry>
  readonly repos: GenerationRepos
  readonly prompts: PathgenPrompts
  /** Absent means consolidation matches names only, and the manifest says so. */
  readonly embeddings?: EmbeddingProvider
  /** Defaults to `sequencePath`. A seam for a test, never for a second algorithm. */
  readonly sequencer?: Sequencer
  readonly progress?: ProgressReporter
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly countTokens?: TokenCounter
  readonly logger: PathgenLogger
  readonly concurrency?: Partial<GenerationConcurrency>
}
