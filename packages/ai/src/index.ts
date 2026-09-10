/**
 * The pure entry point: no file reachable from here imports `ai` or `@ai-sdk/*`.
 *
 * `packages/ingest` and `packages/activity-ai` depend on this package for `TextGenerator`
 * and must not pull a provider SDK into their graphs; `src/pure-entry.test.ts` proves it
 * rather than trusting it. The SDK-backed half lives behind `@retenia/ai/providers`, which
 * only `apps/desktop` imports.
 */

export { isAborted, toAbortSignal } from './abort'
export type {
  AiBatchPatch,
  AiBatchRecord,
  AiBatchStatus,
  AiBatchStore,
  BatchCallOptions,
  BatchEstimate,
  BatchEstimateOptions,
  BatchItemOutcome,
  BatchPoll,
  BatchProvider,
  BatchRequest,
  BatchRunner,
  BatchRunnerDeps,
  BatchSubmission,
  Dispatch,
  DispatchPolicyInput,
  NewAiBatch,
  ProviderBatchStatus,
  RunJobOptions,
  RunJobOutcome,
  RunJobResult,
  Split,
  SubmitBatchOptions,
} from './batch'
export {
  AI_BATCH_STATUSES,
  BATCH_MIN_REQUESTS,
  chooseDispatch,
  createBatchRunner,
  createSequentialBatchProvider,
  DEFAULT_OUTPUT_TOKENS_PER_REQUEST,
  estimateBatch,
  isTerminalBatchStatus,
  MAX_BATCH_REQUESTS,
  MAX_BATCH_RETRIES,
  MAX_POLL_FAILURES,
  POLL_BASE_MS,
  POLL_JITTER,
  POLL_MAX_MS,
  pollDelayMs,
  SYNCHRONOUS_HEAD,
  splitSynchronousHead,
  TERMINAL_BATCH_STATUSES,
} from './batch'
export type { AiBudgetEvent } from './budget'
export { budgetState, crossedThresholds, monthKey, startOfMonth, WARNING_THRESHOLD } from './budget'
export type {
  CacheBreakpoint,
  CacheDecision,
  CachePlan,
  PromptCacheDirective,
  WithCacheOptions,
} from './caching'
export {
  cacheMinimumTokens,
  cacheTtlFor,
  DEFAULT_CACHE_TTL,
  PATH_GENERATION_CACHE_TTL,
  supportsExplicitCache,
  withCache,
} from './caching'
export type { AiClient, AiClientOptions } from './client'
export { createAiClient } from './client'
export { DEFAULT_AI_CONCURRENCY, withConcurrencyLimit } from './concurrency'
export type { AiCallMeta } from './cost-log'
export { aiCallMetaSchema, META_STRING_MAX, sanitizeMeta } from './cost-log'
export type { AiErrorCode, AiErrorContext } from './errors'
export {
  AI_ERROR_CODES,
  AiError,
  asAiError,
  isAiError,
  MAX_ERROR_CHARS,
  redactAiError,
  redactKey,
} from './errors'
export type { AiResultCache, CachedAiResult, IdempotencyInput, NewAiResult } from './idempotency'
export { customId, MAX_CUSTOM_ID_CHARS } from './idempotency'
export type {
  FinishReason,
  InvokeOptions,
  InvokeOutcome,
  InvokeTarget,
  ProviderInvoker,
} from './invoker'
export type { CreateLocalProfileInput, LocalContextGuard, LocalPolicyDeps } from './local'
export {
  createLocalProfile,
  DEFAULT_CLOUD_TIMEOUT_MS,
  DEFAULT_LOCAL_CONTEXT_TOKENS,
  DEFAULT_LOCAL_TIMEOUT_MS,
  guardLocalContext,
  withLocalPolicy,
  withLocalPreference,
} from './local'
export type { Random, SecretReader, Timers } from './ports'
export { realTimers } from './ports'
export type {
  BillableUsage,
  CacheTtl,
  CostBreakdown,
  CostLine,
  CostRequest,
  ModelKey,
  ModelPricing,
  PerMillionRates,
  PricingOverlay,
  PricingOverlayEntry,
  PricingPeriod,
  PricingTable,
  PricingWindow,
  Rates,
  ResolvedRates,
} from './pricing'
export {
  COST_DECIMALS,
  computeCostUsd,
  inUtcWindow,
  mergePricingOverlay,
  modelKey,
  PRICING_REVISION,
  pricingOverlayEntrySchema,
  pricingOverlaySchema,
  pricingTableSchema,
  resolveRates,
  SHIPPED_PRICING,
  toPerMillionRates,
  unknownOverlayKeys,
  ZERO_USAGE,
} from './pricing'
export type { PiiRedactionResult } from './privacy'
export { redactPii } from './privacy'
export type { ProviderCaps, ProviderKind, ProviderProfile } from './profiles'
export { DEFAULT_PROFILES, PROVIDER_KINDS } from './profiles'
export type { ProviderPort, ProviderRole } from './provider-port'
export type { Verdict } from './retry'
export {
  classify,
  MAX_ATTEMPTS_PER_TARGET,
  MIN_RETRY_MS,
  RETRY_BASE_MS,
  retryDelayMs,
} from './retry'
export type { AiRegistry, ModelRef, RoleConfig, RoleMap, RoleTarget } from './roles'
export { DEFAULT_ROLES, resolveTargets } from './roles'
export type { AiAttempt, AiBinding, AiReview, RunDeps, RunOptions } from './run'
export { DEFAULT_REPAIR_BUDGET, runOnce } from './run'
export type {
  JsonSchemaNode,
  SanitizeLimits,
  StructuredArrayRequest,
  StructuredObjectRequest,
  StructuredRequestBase,
  StructuredResult,
  WrappedUserContent,
} from './structured'
export {
  buildRepairPrompt,
  DEFAULT_MAX_CONTINUATIONS,
  DEFAULT_SANITIZE_LIMITS,
  describeIssues,
  extractJsonText,
  MAX_COMPLETION_CHARS,
  MAX_QUOTED_OUTPUT_CHARS,
  MAX_REPORTED_ISSUES,
  parseJsonCompletion,
  relaxJsonSchema,
  runStructured,
  SchemaNotRepresentableError,
  sanitizeOutput,
  sanitizeString,
  structuredRequestFor,
  systemFor,
  tolerantArray,
  toStrictJsonSchema,
  USER_CONTENT_INSTRUCTIONS,
  USER_CONTENT_TAG,
  validateStructuredCompletion,
  wrapUserContent,
} from './structured'
export type {
  TextGenerationRequest,
  TextGenerationResult,
  TextGenerationUsage,
  TextGenerator,
} from './text-generator'
export type { TokenCounter } from './tokens'
export { approximateTokens, TOKEN_ESTIMATE_TOLERANCE } from './tokens'
