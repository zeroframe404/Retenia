export type { ActivityStatsRepository } from './activity-stats-repository'
export type { AiCallRepository, CostQuery } from './ai-call-repository'
export type {
  AbortSignalLike,
  AiGradeEngine,
  AiGradeInput,
  AiGradeResult,
  AiGrader,
  AnswerEvidence,
  CriterionScore,
  ExplainAnswer,
  ExplainAnswerRequest,
  GradedActivityRef,
  GradingKeyPoint,
  GradingRubricCriterion,
  GradingRubricLevel,
  GradingSource,
  RichText,
} from './ai-grader'
export {
  AI_GRADE_ENGINES,
  countWords,
  INJECTION_PATTERNS,
  looksLikeInjection,
  weightedCriterionScore,
} from './ai-grader'
export type { AttemptRepository } from './attempt-repository'
export type {
  CrudRepository,
  EntityPatch,
  FindOptions,
  ListOptions,
  NewEntity,
  SaveEntity,
} from './audit'
export type { BlobRepository } from './blob-repository'
export type { BlobPutResult, BlobStore } from './blob-store'
export type {
  CardRepository,
  DueFilters,
  DueProjection,
  ImportanceCountOptions,
} from './card-repository'
export type {
  ChunkRepository,
  ChunkSearchHit,
  ChunkSearchOptions,
  SearchMode,
} from './chunk-repository'
export type { Clock } from './clock'
export { systemClock } from './clock'
export type {
  DomainEvent,
  DomainEventOf,
  DomainEventPublisher,
  DomainEventType,
} from './domain-events'
export type { EmbeddingProvider } from './embedding-provider'
export {
  AppendOnlyViolationError,
  EntityNotFoundError,
  OptimisticConcurrencyError,
} from './errors'
export type { ExamRepository } from './exam-repository'
export type { GamificationRepository, XpRange } from './gamification-repository'
export type { IdGenerator } from './id-generator'
export type {
  ImportanceLevelPatch,
  ImportanceLevelRepository,
} from './importance-level-repository'
export type { ItemBankRepository } from './item-bank-repository'
export type { EnqueueOptions, JobRepository } from './job-repository'
export type { KnowledgeItemRepository } from './knowledge-item-repository'
export type {
  OptimizerEvaluation,
  OptimizerStage,
  OptimizerTrainer,
  OptimizerTrainingInput,
  OptimizerTrainingOptions,
  OptimizerTrainingResult,
} from './optimizer'
export { OPTIMIZER_STAGES } from './optimizer'
export type { OutboxAppend, OutboxRepository } from './outbox-repository'
export type { PathRepository, PathTree } from './path-repository'
export type { ProcessLiveness } from './process-liveness'
export type {
  RerankDocument,
  Reranker,
  RerankOptions,
  RerankResult,
} from './reranker'
export { passthroughReranker } from './reranker'
export type { ReviewLogRepository } from './review-log-repository'
export type { ReviewSessionRepository } from './review-session-repository'
export type {
  SchedulerProfileRepository,
  TrainedParameters,
} from './scheduler-profile-repository'
export { GLOBAL_SCHEDULER_SCOPE } from './scheduler-profile-repository'
export type { SecretName, SecretStore } from './secret-store'
export { SECRET_NAMES } from './secret-store'
export type { SettingsMap, SettingsRepository } from './settings-repository'
export { SETTINGS, SETTINGS_DEFAULTS, type SettingsKey } from './settings-repository'
export type { SourceRepository } from './source-repository'
export type {
  CardMemoryState,
  ReviewEvent,
  StatsReadOptions,
  StatsRepository,
} from './stats-repository'
export type { Repositories, TransactionOptions, UnitOfWork } from './unit-of-work'
