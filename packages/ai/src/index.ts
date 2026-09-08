/**
 * The pure entry point: no file reachable from here imports `ai` or `@ai-sdk/*`.
 *
 * `packages/ingest` and `packages/activity-ai` depend on this package for `TextGenerator`
 * and must not pull a provider SDK into their graphs; `src/pure-entry.test.ts` proves it
 * rather than trusting it. The SDK-backed half lives behind `@retenia/ai/providers`, which
 * only `apps/desktop` imports.
 */

export { isAborted, toAbortSignal } from './abort'
export type { AiBudgetEvent } from './budget'
export { budgetState, crossedThresholds, monthKey, startOfMonth, WARNING_THRESHOLD } from './budget'
export type { AiClient, AiClientOptions } from './client'
export { createAiClient } from './client'
export type { AiCallMeta } from './cost-log'
export { aiCallMetaSchema, META_STRING_MAX, sanitizeMeta } from './cost-log'
export type { AiErrorCode, AiErrorContext } from './errors'
export { AI_ERROR_CODES, AiError, isAiError, MAX_ERROR_CHARS, redactKey } from './errors'
export type { AiResultCache, CachedAiResult, IdempotencyInput, NewAiResult } from './idempotency'
export { customId, MAX_CUSTOM_ID_CHARS } from './idempotency'
export type {
  FinishReason,
  InvokeOptions,
  InvokeOutcome,
  InvokeTarget,
  ProviderInvoker,
} from './invoker'
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
  modelKey,
  PRICING_REVISION,
  pricingTableSchema,
  resolveRates,
  SHIPPED_PRICING,
  toPerMillionRates,
  ZERO_USAGE,
} from './pricing'
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
  tolerantArray,
  toStrictJsonSchema,
  USER_CONTENT_INSTRUCTIONS,
  USER_CONTENT_TAG,
  wrapUserContent,
} from './structured'
export type {
  TextGenerationRequest,
  TextGenerationResult,
  TextGenerationUsage,
  TextGenerator,
} from './text-generator'
