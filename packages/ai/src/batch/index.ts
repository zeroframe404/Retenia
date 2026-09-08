/**
 * The Batch API (sub-phase 7.3): submission, durable polling, reconciliation into
 * `ai_results`, the sync-or-batch policy and the pre-submission quote.
 *
 * Pure — the provider adapters that actually speak HTTP live behind `@retenia/ai/providers`.
 */

export { POLL_BASE_MS, POLL_JITTER, POLL_MAX_MS, pollDelayMs } from './backoff'
export type { BatchEstimate, BatchEstimateOptions } from './estimate'
export { DEFAULT_OUTPUT_TOKENS_PER_REQUEST, estimateBatch } from './estimate'
export type { Dispatch, DispatchPolicyInput, Split } from './plan'
export {
  BATCH_MIN_REQUESTS,
  chooseDispatch,
  SYNCHRONOUS_HEAD,
  splitSynchronousHead,
} from './plan'
export type {
  BatchCallOptions,
  BatchItemOutcome,
  BatchPoll,
  BatchProvider,
  BatchRequest,
  BatchSubmission,
  ProviderBatchStatus,
} from './provider'
export type {
  BatchRunner,
  BatchRunnerDeps,
  RunJobOptions,
  RunJobOutcome,
  RunJobResult,
  SubmitBatchOptions,
} from './runner'
export {
  createBatchRunner,
  MAX_BATCH_REQUESTS,
  MAX_BATCH_RETRIES,
  MAX_POLL_FAILURES,
  REQUEST_TIMEOUT_MS,
} from './runner'
export { createSequentialBatchProvider } from './sequential'
export type { AiBatchPatch, AiBatchRecord, AiBatchStatus, AiBatchStore, NewAiBatch } from './types'
export { AI_BATCH_STATUSES, isTerminalBatchStatus, TERMINAL_BATCH_STATUSES } from './types'
