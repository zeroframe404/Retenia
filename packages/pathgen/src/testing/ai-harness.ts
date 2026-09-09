import type { AiClient, AiRegistry, BatchRunner } from '@retenia/ai'
import {
  createAiClient,
  createBatchRunner,
  createSequentialBatchProvider,
  DEFAULT_PROFILES,
  DEFAULT_ROLES,
  SHIPPED_PRICING,
} from '@retenia/ai'
import {
  createManualTimers,
  createMemoryBatchStore,
  createMemoryResultCache,
  createRecordingRecorder,
  type ManualTimers,
  type RecordingRecorder,
} from '@retenia/ai/testing'
import type { Clock } from '@retenia/core'
import { silentLogger } from '../logger'
import {
  createReplayBatchProvider,
  createReplayInvoker,
  type ReplayBatchProvider,
  type ReplayInvoker,
  type ReplayResolver,
} from './replay'

/**
 * A real `AiClient` and a real `BatchRunner` over the replay fakes — the same wiring the
 * main process does, minus the SDK and the database. What a test asserts on afterwards is
 * the replay's counters, the recorded `ai_calls` rows and the result cache's entries.
 */

export interface AiHarnessOptions {
  readonly resolve: ReplayResolver
  readonly clock?: Clock
  readonly registry?: AiRegistry
  /** Whether the runner has a real batch adapter for the profiles; `false` means sequential. */
  readonly batch?: boolean
  readonly pollsBeforeDone?: number
  readonly monthlyBudgetUsd?: number
  readonly spentUsd?: number
}

export interface AiHarness {
  readonly ai: AiClient
  readonly runner: BatchRunner
  readonly resultCache: ReturnType<typeof createMemoryResultCache>
  readonly batchStore: ReturnType<typeof createMemoryBatchStore>
  readonly replay: ReplayInvoker
  readonly replayBatch: ReplayBatchProvider
  readonly recorder: RecordingRecorder
  readonly timers: ManualTimers
  readonly clock: Clock
  readonly registry: () => Promise<AiRegistry>
}

export const HARNESS_NOW = new Date('2026-09-09T12:00:00Z')

export function createAiHarness(options: AiHarnessOptions): AiHarness {
  const clock = options.clock ?? { now: () => HARNESS_NOW }
  const registryValue = options.registry ?? { profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }
  const registry = async (): Promise<AiRegistry> => registryValue
  const resultCache = createMemoryResultCache()
  const batchStore = createMemoryBatchStore()
  const replay = createReplayInvoker(options.resolve)
  const replayBatch = createReplayBatchProvider(options.resolve, {
    ...(options.pollsBeforeDone === undefined ? {} : { pollsBeforeDone: options.pollsBeforeDone }),
  })
  const recorder = createRecordingRecorder()
  const timers = createManualTimers()
  const spentSinceUsd = async (): Promise<number> => options.spentUsd ?? 0
  const monthlyBudgetUsd = async (): Promise<number> => options.monthlyBudgetUsd ?? 0
  const getSecret = async (): Promise<string> => 'test-key'

  const ai = createAiClient({
    invoker: replay.invoker,
    concurrency: Number.POSITIVE_INFINITY,
    registry,
    pricing: SHIPPED_PRICING,
    getSecret,
    recordCall: recorder.record,
    spentSinceUsd,
    monthlyBudgetUsd,
    resultCache,
    clock,
    timers,
    random: () => 0.5,
    logger: silentLogger,
  })

  const runner = createBatchRunner({
    adapters:
      options.batch === false
        ? {}
        : { anthropic: replayBatch.provider, google: replayBatch.provider },
    fallback: createSequentialBatchProvider(replay.invoker),
    registry,
    pricing: SHIPPED_PRICING,
    getSecret,
    recordCall: recorder.record,
    store: batchStore,
    sync: (binding, request) => ai.textGenerator(binding)(request),
    resultCache,
    spentSinceUsd,
    monthlyBudgetUsd,
    hardBlockEnabled: async () => true,
    clock,
    // Recorded, never fired: the stage drives every poll itself.
    timers: { setTimeout: () => {}, sleep: timers.sleep },
    random: () => 0.5,
    logger: silentLogger,
  })

  return {
    ai,
    runner,
    resultCache,
    batchStore,
    replay,
    replayBatch,
    recorder,
    timers,
    clock,
    registry,
  }
}
