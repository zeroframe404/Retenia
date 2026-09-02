/**
 * `@retenia/core/testing` — the shared repository contract suites and the harness they run
 * against.
 *
 * Test-only: this entry point is never reachable from `@retenia/core`'s main export, so
 * `vitest` (a devDependency) never enters a production bundle.
 */

export {
  auditContract,
  blobsContract,
  cardsContract,
  chunksContract,
  jobsContract,
  outboxContract,
  reviewLogsContract,
  runRepositoryContracts,
  settingsContract,
  unitOfWorkContract,
} from './contracts/index'
export type { FakeEmbeddingProviderOptions } from './fake-embedding-provider'
export { createFakeEmbeddingProvider, fakeEmbeddingTokens } from './fake-embedding-provider'
export type {
  ContractCapabilities,
  ContractContext,
  ContractSeeds,
  ControllableClock,
  HarnessOptions,
  RepositoryContractHarness,
} from './harness'
