import type { ContractApi } from './api-types'
import { aiChannels } from './channels/ai'
import { aiSettingsChannels } from './channels/ai-settings'
import { appChannels } from './channels/app'
import { backupsChannels } from './channels/backups'
import { jobsChannels } from './channels/jobs'
import { libraryChannels } from './channels/library'
import { memoryChannels } from './channels/memory'
import { pathgenChannels } from './channels/pathgen'
import { schedulerChannels } from './channels/scheduler'
import { secretsChannels } from './channels/secrets'
import { sessionChannels } from './channels/session'
import { settingsChannels } from './channels/settings'
import { statsChannels } from './channels/stats'
import { aiEvents } from './events/ai'
import { aiSettingsEvents } from './events/ai-settings'
import { appEvents } from './events/app'
import { jobsEvents } from './events/jobs'
import { pathgenEvents } from './events/pathgen'
import { settingsEvents } from './events/settings'

export type {
  ActionOf,
  AssertNoEventsDomain,
  ContractApi,
  DomainOf,
} from './api-types'
export type { AiBatchStatus, AiBatchSummary } from './channels/ai'
export {
  AI_BATCH_STATUSES,
  aiBatchStatusSchema,
  aiBatchSummarySchema,
} from './channels/ai'
export type {
  AiCallStatusDto,
  PricingOverlayEntryDto,
  PricingRowDto,
  ProviderCardDto,
  ProviderKindDto,
  ProviderRoleDto,
  RoleAssignmentDto,
  UsageCallRowDto,
  UsageSummaryDto,
} from './channels/ai-settings'
export {
  AI_CALL_STATUS_VALUES,
  aiCallStatusSchema,
  PROVIDER_KIND_VALUES,
  PROVIDER_ROLE_VALUES,
  pricingOverlayEntrySchema,
  pricingRowSchema,
  providerCardSchema,
  providerKindSchema,
  providerRoleSchema,
  roleAssignmentSchema,
  usageCallRowSchema,
  usageSummarySchema,
} from './channels/ai-settings'
export type { Settings, ThemePreference, UpdateChannel } from './channels/app'
export { settingsSchema, themePreferenceSchema, updateChannelSchema } from './channels/app'
export type { BackupSummary } from './channels/backups'
export { backupSummarySchema } from './channels/backups'
export type { JobStatus, JobSummary } from './channels/jobs'
export { JOB_STATUSES, jobStatusSchema, jobSummarySchema } from './channels/jobs'
export type {
  AnnotationAnchor,
  AnnotationDto,
  AnnotationKind,
  ChunkSummary,
  ContextualizationEstimateDto,
  EmbeddingStatus,
  MediaMetaDto,
  MediaPartDto,
  ReadingLocator,
  RecentSource,
  SearchHit,
  SearchMode,
  SectionDto,
  SourceDocDto,
  SourceKind,
  SourceStatus,
  SourceSummary,
  SourceUnitKind,
  SourceUnitSummary,
} from './channels/library'
export {
  ANNOTATION_KINDS,
  annotationAnchorSchema,
  annotationKindSchema,
  annotationSchema,
  chunkSummarySchema,
  contextualizationEstimateSchema,
  EMBEDDING_STATUSES,
  embeddingStatusSchema,
  mediaMetaSchema,
  mediaPartSchema,
  readingLocatorSchema,
  recentSourceSchema,
  SEARCH_MODES,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  SOURCE_UNIT_KINDS,
  searchHitSchema,
  searchModeSchema,
  sourceDocSchema,
  sourceKindSchema,
  sourceMetaSchema,
  sourceStatusSchema,
  sourceSummarySchema,
  sourceUnitKindSchema,
  sourceUnitSummarySchema,
} from './channels/library'
export type {
  Forecast,
  ImportanceLevel,
  ImportanceMix,
  RescheduleImpact,
} from './channels/memory'
export {
  FORECAST_MAX_DAYS,
  forecastDaySchema,
  forecastSchema,
  IMPORTANCE_LEVELS,
  importanceLevelSchema,
  importanceMixEntrySchema,
  importanceMixSchema,
  rescheduleChangeSchema,
  rescheduleImpactSchema,
  rescheduleSelectionSchema,
  URGENT_MODE_HOURS,
  urgentModeHoursSchema,
} from './channels/memory'
export type {
  CheckpointNodeDto,
  CoreLessonNodeDto,
  GenerationConfigInputDto,
  GenerationEstimateDto,
  GenerationResultDto,
  GenerationRunDto,
  GenerationRunStatusDto,
  GenerationScopeDto,
  GenerationStageDto,
  GenerationWarningDto,
  LessonQaSummaryDto,
  LessonRegenerateModeDto,
  LessonStatusDto,
  LessonSummaryDto,
  ModuleNodeDto,
  PathDraftDto,
  PathDto,
  PathEditOpDto,
  PathStatsDto,
  PathVersionDto,
  QaFindingDto,
  QaGateDto,
  QaModeDto,
  QaReportDto,
  QaReportLessonDto,
  QaVerdictDto,
  ReinforcementNodeDto,
  SectionNodeDto,
} from './channels/pathgen'
export {
  checkpointNodeDtoSchema,
  coreLessonNodeDtoSchema,
  finalExamNodeDtoSchema,
  GENERATION_RUN_STATUSES,
  GENERATION_STAGES,
  generationConfigInputSchema,
  generationEstimateDtoSchema,
  generationResultDtoSchema,
  generationRunDtoSchema,
  generationRunStatusSchema,
  generationScopeDtoSchema,
  generationStageSchema,
  generationWarningDtoSchema,
  LESSON_REGENERATE_MODES,
  LESSON_STATUSES,
  lessonQaSummaryDtoSchema,
  lessonRegenerateModeSchema,
  lessonStatusDtoSchema,
  lessonSummaryDtoSchema,
  moduleNodeDtoSchema,
  pathDraftDtoSchema,
  pathDtoSchema,
  pathEditOpDtoSchema,
  pathStatsDtoSchema,
  pathVersionDtoSchema,
  QA_GATES,
  QA_MAX_FINDING_CITATIONS,
  QA_MAX_FINDINGS,
  QA_MODES,
  QA_VERDICTS,
  qaFindingDtoSchema,
  qaGateSchema,
  qaModeSchema,
  qaReportDtoSchema,
  qaReportLessonDtoSchema,
  qaVerdictSchema,
  reinforcementNodeDtoSchema,
  sectionNodeDtoSchema,
} from './channels/pathgen'
export {
  evaluationSchema,
  LEECH_ACTIONS,
  leechActionSchema,
  optimizationOutcomeSchema,
  optimizerStatusSchema,
  schedulerProfileSchema,
  stepSchema,
  stepsSchema,
} from './channels/scheduler'
export type { SecretName } from './channels/secrets'
export { SECRET_NAMES, secretNameSchema } from './channels/secrets'
export type { SessionPlanDto } from './channels/session'
export {
  gradeSchema,
  overloadSummarySchema,
  REVIEW_SESSION_STATUSES,
  reinforcementNodeSchema,
  reviewSessionStatusSchema,
  SESSION_ENTRY_KINDS,
  SESSION_ORDERS,
  sessionActivitySchema,
  sessionCardPreviewSchema,
  sessionCardSchema,
  sessionCountsSchema,
  sessionEntryKindSchema,
  sessionEntrySchema,
  sessionItemSchema,
  sessionOrderSchema,
  sessionPlanSchema,
  sessionPreviewSchema,
  sessionProgressSchema,
  sessionSettingsSchema,
  sessionSummarySchema,
  streakStatusSchema,
} from './channels/session'
export type { RetentionWindow, StatsOverview, TrueRetention } from './channels/stats'
export {
  distributionSchema,
  levelRetentionSchema,
  memorizedSchema,
  RETENTION_WINDOWS,
  retentionWindowSchema,
  STATS_MAX_FORECAST_DAYS,
  STATS_MAX_SERIES_DAYS,
  statsOverviewSchema,
  trueRetentionSchema,
} from './channels/stats'
export type {
  ChannelDefinition,
  ContractShape,
  EventShape,
  InferEvent,
  InferInput,
  InferOutput,
} from './define'
export { defineContract, defineEvents } from './define'
export type { IpcError, IpcErrorCode, IpcResult } from './envelope'
export { ipcErrorCodes, ipcErrorSchema, ipcFail, ipcOk } from './envelope'
export type { AiBatchEvent } from './events/ai'
export { aiBatchSchema } from './events/ai'
export { aiSettingsEvents } from './events/ai-settings'
export type { DeepLink, UpdateStatus } from './events/app'
export { updateStatusSchema } from './events/app'
export type { JobProgressEvent } from './events/jobs'
export { jobProgressSchema } from './events/jobs'
export type { PathgenLessonStatusEvent, PathgenProgressEvent } from './events/pathgen'
export { pathgenLessonStatusSchema, pathgenProgressSchema } from './events/pathgen'

/**
 * Every main<->renderer request/response channel. Merge one object per domain; the
 * `domain.action` keys are what main registers, preload generates and the renderer calls.
 */
export const contract = {
  ...aiChannels,
  ...aiSettingsChannels,
  ...appChannels,
  ...jobsChannels,
  ...libraryChannels,
  ...memoryChannels,
  ...pathgenChannels,
  ...schedulerChannels,
  ...secretsChannels,
  ...sessionChannels,
  ...backupsChannels,
  ...settingsChannels,
  ...statsChannels,
}

/** Every push channel main can send to the renderer (`webContents.send`). */
export const events = {
  ...aiEvents,
  ...aiSettingsEvents,
  ...appEvents,
  ...jobsEvents,
  ...pathgenEvents,
  ...settingsEvents,
}

export type Contract = typeof contract
export type Events = typeof events
export type ChannelName = keyof Contract & string
export type EventName = keyof Events & string

/** The `window.api` shape both preload and the renderer are typed against. */
export type RendererApi = ContractApi<Contract, Events>

export const channelNames: readonly ChannelName[] = Object.freeze(
  Object.keys(contract) as ChannelName[],
)

export const eventNames: readonly EventName[] = Object.freeze(Object.keys(events) as EventName[])

/** Narrow an untrusted string to a declared channel. `Object.hasOwn` so a prototype key never passes. */
export function isChannelName(value: unknown): value is ChannelName {
  return typeof value === 'string' && Object.hasOwn(contract, value)
}

/** Narrow an untrusted string to a declared push event. */
export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && Object.hasOwn(events, value)
}
