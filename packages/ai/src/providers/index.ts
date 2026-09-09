/**
 * The only module graph in this package that loads the AI SDK.
 *
 * `packages/ingest` and `packages/activity-ai` import `@retenia/ai` for its types and must
 * not pull a provider SDK into their bundles; `src/pure-entry.test.ts` proves nothing
 * reachable from the package's `.` entry point reaches this directory.
 */
export type {
  AnthropicBatchOptions,
  FetchLike,
  GoogleBatchOptions,
} from './batch'
export {
  createAnthropicBatchProvider,
  createBatchAdapters,
  createGoogleBatchProvider,
  parseInlined,
  parseResults,
  toGenerateContentRequest,
  toMessageParams,
} from './batch'
export type { BindModel } from './bind'
export { bindLanguageModel } from './bind'
export { fromSdkError } from './from-sdk-error'
export type {
  DiscoveredLocalModel,
  FetchLike as LocalFetchLike,
  LocalDiscovery,
} from './local-discovery'
export { discoverLocalProvider } from './local-discovery'
export { createSdkInvoker } from './sdk-invoker'
export { toBillableUsage } from './usage'
