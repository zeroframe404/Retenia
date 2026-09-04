import { describe } from 'vitest'
import type { RepositoryContractHarness } from '../harness'
import { auditContract } from './audit.contract'
import { blobsContract } from './blobs.contract'
import { cardsContract } from './cards.contract'
import { chunksContract } from './chunks.contract'
import { importanceLevelsContract } from './importance-levels.contract'
import { jobsContract } from './jobs.contract'
import { outboxContract } from './outbox.contract'
import { reviewLogsContract } from './review-logs.contract'
import { reviewSessionsContract } from './review-sessions.contract'
import { schedulerProfilesContract } from './scheduler-profiles.contract'
import { settingsContract } from './settings.contract'
import { unitOfWorkContract } from './unit-of-work.contract'

/**
 * Every shared repository contract, run against one adapter.
 *
 * These suites are the actual definition of what a Retenia repository adapter is. They know
 * nothing about SQLite: the `expo-sqlite`, `sqlite-wasm` or PowerSync adapter a mobile or
 * synced build would need proves itself by passing exactly these tests, which is what makes
 * "repositories behind ports from day 1" (`docs/spec/07-architecture.md` §11) worth the
 * indirection.
 */
export function runRepositoryContracts(harness: RepositoryContractHarness): void {
  describe(`repository contracts (${harness.name})`, () => {
    auditContract(harness)
    unitOfWorkContract(harness)
    outboxContract(harness)
    cardsContract(harness)
    importanceLevelsContract(harness)
    reviewLogsContract(harness)
    reviewSessionsContract(harness)
    schedulerProfilesContract(harness)
    chunksContract(harness)
    settingsContract(harness)
    jobsContract(harness)
    blobsContract(harness)
  })
}

export { auditContract } from './audit.contract'
export { blobsContract } from './blobs.contract'
export { cardsContract } from './cards.contract'
export { chunksContract } from './chunks.contract'
export { importanceLevelsContract } from './importance-levels.contract'
export { jobsContract } from './jobs.contract'
export { outboxContract } from './outbox.contract'
export { reviewLogsContract } from './review-logs.contract'
export { reviewSessionsContract } from './review-sessions.contract'
export { schedulerProfilesContract } from './scheduler-profiles.contract'
export { settingsContract } from './settings.contract'
export { unitOfWorkContract } from './unit-of-work.contract'
