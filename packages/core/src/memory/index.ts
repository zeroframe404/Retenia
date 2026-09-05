// --- sub-phase 4.6: optimizer, simulator, leeches, siblings, load balancer, easy days ---
export type { EasyDayCalendar, EasyDayInput } from './easy-days'
export { easyDayLevelAt, resolveEasyDayCalendar } from './easy-days'
export type { CardReviewedEvent, MemorySnapshot } from './events'
export { memorySnapshot } from './events'
export type {
  ExamOverrideOptions,
  ExamOverrideSource,
  ExamRetentionInput,
  ExamSchedulingOverride,
} from './exam-override'
export {
  createExamOverrides,
  daysUntilExam,
  examDesiredRetention,
  examOverrideFor,
  NO_EXAM_OVERRIDES,
} from './exam-override'
export type {
  Forecast,
  ForecastDay,
  ForecastDeps,
  ForecastQuery,
  ForecastRepositories,
} from './forecast'
export { createForecast, FORECAST_MAX_CARDS, FORECAST_MAX_DAYS } from './forecast'
export type { ForgettingCurveConstants, FuzzWindow, NextStateOptions } from './formulas'
export {
  assertParameters,
  clampParameters,
  DEFAULT_DECAY_PARAMETER,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  decayConstants,
  FUZZ_RANGES,
  forgettingCurve,
  fuzzRange,
  INITIAL_STABILITY_MIN,
  initialDifficulty,
  initialStability,
  intervalForRetention,
  nextDifficulty,
  nextForgetStability,
  nextMemoryState,
  nextRecallStability,
  PARAMETER_CLAMP_RANGES,
  PARAMETER_COUNT,
  STABILITY_MAX,
  STABILITY_MIN,
  scheduledInterval,
  shortTermStability,
} from './formulas'
export type { FsrsSchedulerConfig } from './fsrs-scheduler'
export { createFsrsScheduler, FsrsScheduler } from './fsrs-scheduler'
export type {
  ImportanceCatalog,
  ImportanceLevelSettings,
  ImportanceLevelValues,
  ImportancePolicy,
  NewItemPolicy,
  PostponePolicy,
} from './importance'
export {
  createImportanceCatalog,
  DEFAULT_IMPORTANCE_CATALOG,
  DEFAULT_IMPORTANCE_LEVEL,
  DEFAULT_IMPORTANCE_LEVELS,
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
  IMPORTANCE_POLICIES,
  MAINTENANCE_RETENTION_MAX,
  MAINTENANCE_RETENTION_MIN,
  POSTPONE_FACTOR,
  PRIORITY_BIAS_THRESHOLD,
  URGENT_EXAM_WINDOW_DAYS,
  URGENT_MODE_RETENTION,
  URGENT_MODE_STEPS,
} from './importance'
export type {
  ImportanceMix,
  ImportanceMixDeps,
  ImportanceMixEntry,
  ImportanceMixQuery,
} from './importance-mix'
export { createImportanceMix, queuedTotal } from './importance-mix'
export type { LeechDecision, LeechStage } from './leech'
export { evaluateLeech, leechWarningThreshold } from './leech'
export type { DueHistogram, DueHistogramOptions } from './load-balance'
export {
  buildDueHistogram,
  createLoadBalancer,
  dueAfterDays,
  LOAD_BALANCE_HORIZON_DAYS,
} from './load-balance'
export type { FsrsCardFields, FsrsReviewLogFields } from './mappers'
export { fromFsrsCard, fromFsrsReviewLog, toFsrsCard, toFsrsReviewLog } from './mappers'
export type {
  ApplyOptimization,
  OptimizationOutcome,
  Optimizer,
  OptimizerDeps,
  OptimizerRepositories,
  OptimizerStatus,
  OptimizerStatusQuery,
  OptimizerTrainingInputSource,
  PrepareOptimization,
} from './optimizer'
export {
  createApplyOptimization,
  createOptimizer,
  createOptimizerStatus,
  createPrepareOptimization,
  OPTIMIZER_HISTORY_EPOCH,
  OPTIMIZER_MAX_REVIEWS,
} from './optimizer'
export type { OptimizerCsvRow } from './optimizer-csv'
export {
  formatOptimizerCsv,
  OPTIMIZER_CSV_HEADER,
  parseOptimizerCsv,
  toOptimizerCsv,
  toOptimizerCsvRows,
} from './optimizer-csv'
export type {
  HealthCheck,
  HealthCheckReason,
  OptimizerOffer,
  OptimizerOfferReason,
} from './optimizer-policy'
export {
  healthCheck,
  nextOptimizationThreshold,
  OPTIMIZER_CADENCE_BASE,
  OPTIMIZER_MAX_AGE_MS,
  OPTIMIZER_MIN_REVIEWS,
  optimizationOffer,
} from './optimizer-policy'
export type {
  OverloadInput,
  OverloadSummary,
  PostponeCandidate,
  PostponeProposal,
  PostponeSelection,
} from './overload'
export { postponeDays, selectPostponements } from './overload'
export type { ActivityPace } from './pace'
export { foldPace, medianOf, PACE_SAMPLE_SIZE } from './pace'
export type { FsrsParameters, SchedulerProfileParameters } from './parameters'
export {
  assertSchedulingOptions,
  DEFAULT_FSRS_PARAMETERS,
  DEFAULT_FSRS_W,
  DEFAULT_LEARNING_STEPS,
  DEFAULT_RELEARNING_STEPS,
  DEFAULT_SCHEDULING_OPTIONS,
  isStepUnit,
  parametersFromProfile,
  schedulerConfigFromProfile,
  schedulingOptionsFromParameters,
  stepUnitToMinutes,
} from './parameters'
export { fuzzSeed, hashString, mulberry32 } from './prng'
export type {
  GradeMeta,
  GradeResult,
  PersonalPace,
  RatingOverride,
  RatingRule,
  RatingSignals,
  ReviewSpec,
} from './rating'
export {
  clampForContext,
  feedsScheduler,
  RATING_RULES,
  RATING_THRESHOLDS,
  toRating,
} from './rating'
export type {
  RescheduleCandidate,
  RescheduleChange,
  RescheduleImpact,
  RescheduleNow,
  RescheduleNowDeps,
  RescheduleNowInput,
  RescheduleNowResult,
  RescheduleReadRepositories,
  RescheduleSelection,
  RescheduleUnitOfWork,
  RescheduleWindow,
  RescheduleWriteRepositories,
  SimulateReschedule,
  SimulateRescheduleDeps,
} from './reschedule'
export { createRescheduleNow, createSimulateReschedule, projectReschedule } from './reschedule'
export type {
  ReviewActivity,
  ReviewActivityDeps,
  ReviewActivityInput,
  ReviewActivityResult,
} from './review-activity'
export { createReviewActivity } from './review-activity'
export type {
  ReviewCard,
  ReviewCardDeps,
  ReviewCardInput,
  ReviewCardResult,
  ReviewRepositories,
  ReviewUnitOfWork,
} from './review-card'
export { createReviewCard } from './review-card'
export type {
  ImportancePolicyDeps,
  ImportanceResolution,
  ImportanceSource,
  SchedulingPolicy,
  SchedulingPolicyInput,
} from './scheduling-policy'
export {
  createDefaultSchedulingPolicy,
  createImportanceResolver,
  createImportanceSchedulingPolicy,
  isUrgentModeActive,
  resolveImportance,
} from './scheduling-policy'
export type {
  ResolvedSessionSettings,
  SessionCandidate,
  SessionCardEntry,
  SessionCounts,
  SessionEntry,
  SessionEntryKind,
  SessionInput,
  SessionOrder,
  SessionPlan,
  SessionReinforcementEntry,
  SessionSettings,
  SiblingBurial,
} from './session'
export {
  composeSession,
  DEFAULT_NEW_EVERY_N_REVIEWS,
  DEFAULT_STREAK_GOAL_CARDS,
  disperseSiblings,
  FALLBACK_MEDIAN_SECONDS,
  NEW_EVERY_N_REVIEWS_MAX,
  NEW_EVERY_N_REVIEWS_MIN,
  NEW_GATING_BACKLOG_DAYS,
  relativeOverdueness,
  resolveSessionSettings,
} from './session'
export type {
  ExamQueueEntry,
  ExamQueueProvider,
  ReinforcementNode,
  ReinforcementProvider,
  SessionEffort,
  StreakState,
  StreakStatus,
  StreakStatusProvider,
  XpAwarder,
} from './session-ports'
export {
  NO_EXAM_QUEUE,
  NO_REINFORCEMENT,
  NO_STREAK,
  NO_XP,
} from './session-ports'
export type {
  SessionAnswerInput,
  SessionAnswerResult,
  SessionOutcome,
  SessionPlanSnapshot,
  SessionPlanSnapshotEntry,
  SessionProgress,
  SessionRunner,
  SessionRunnerDeps,
  SessionRunnerRepositories,
  SessionRunnerState,
  SessionSummary,
  SessionUndoResult,
  UndoReview,
} from './session-runner'
export { createSessionRunner, EMPTY_PROGRESS, snapshotPlan } from './session-runner'
export type {
  ComposeSessionDeps,
  ComposeSessionQuery,
  SessionReadRepositories,
} from './session-service'
export {
  createComposeSession,
  emptyLevelCounts,
  MAX_SESSION_CANDIDATES,
  readSessionSettings,
} from './session-service'
export type {
  StartSession,
  StartSessionDeps,
  StartSessionInput,
  StartSessionRepositories,
  StartSessionResult,
  StartSessionUnitOfWork,
} from './session-start'
export { applyPostponements, createStartSession, createUndoReview } from './session-start'
export type { SiblingDispersal } from './siblings'
export {
  disperseSiblingDueDates,
  MAX_SIBLING_SPREAD_DAYS,
  siblingBurialUntil,
} from './siblings'
export type {
  FirstRatingProbabilities,
  ReviewRatingProbabilities,
  SimulationResult,
  SimulatorConfig,
  WorkloadSummary,
} from './simulator'
export {
  DEFAULT_SIMULATOR_CONFIG,
  RATING_PROBABILITY_MIN_SAMPLE,
  ratingProbabilitiesFrom,
  relativeWorkload,
  SIMULATOR_MAX_DECK_SIZE,
  SIMULATOR_MAX_SPAN_DAYS,
  simulate,
  workloadSummary,
} from './simulator'
export type { RetrievabilityOptions, StrengthBand, StrengthLabel } from './strength'
export { retrievabilityNow, STRENGTH_BANDS, strengthBand, strengthLabel } from './strength'
export type { DayBoundary } from './study-day'
export {
  DAY_MS,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_TIME_ZONE,
  HOUR_MS,
  isSameStudyDay,
  isValidTimeZone,
  resolveDayBoundary,
  studyDay,
  studyDayNumber,
  studyDayStart,
  studyDaysBetween,
  studyWeekday,
  timeZoneOffsetAtMs,
  timeZoneOffsetMs,
} from './study-day'
export type {
  EasyDates,
  EasyDayLevel,
  EasyDays,
  Grade,
  LoadBalancer,
  MemoryState,
  ReviewHistoryEntry,
  ReviewLogDraft,
  Scheduler,
  SchedulerId,
  SchedulingOptions,
  SchedulingPreview,
  SchedulingResult,
  StepUnit,
  StudyDateKey,
  TimeUnit,
  Weekday,
} from './types'
export { CARD_STATE, EASY_DAY_LEVELS, GRADES, RATING, SCHEDULER_ALGORITHM_VERSION } from './types'
export type {
  EndUrgentMode,
  ExpireUrgentMode,
  StartUrgentMode,
  StartUrgentModeInput,
  UrgentModeCounts,
  UrgentModeDeps,
  UrgentModeHours,
  UrgentModeRepositories,
  UrgentModeResult,
  UrgentModeUnitOfWork,
} from './urgent-mode'
export {
  createEndUrgentMode,
  createExpireUrgentMode,
  createStartUrgentMode,
  DEFAULT_URGENT_MODE_HOURS,
  URGENT_MODE_HOURS,
  urgentModeExpiry,
} from './urgent-mode'
