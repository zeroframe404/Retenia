import type {
  AiBatchRecord,
  AiBatchStore,
  AiClient,
  BatchProvider,
  BatchRunner,
  ProviderKind,
} from '@retenia/ai'
import {
  createBatchRunner,
  createSequentialBatchProvider,
  DEFAULT_PROFILES,
  DEFAULT_ROLES,
  SHIPPED_PRICING,
} from '@retenia/ai'
import { createBatchAdapters, createSdkInvoker } from '@retenia/ai/providers'
import type {
  AiBatch,
  AiBatchRepository,
  AiCallRepository,
  AiResultRepository,
  SecretStore,
  SettingsRepository,
} from '@retenia/core'
import type { AiBatchEvent, AiBatchSummary } from '@retenia/ipc-contract'
import { redactPaths } from '../jobs/redact'
import { log } from '../logging/log'
import { allowedProfiles } from './client'

/**
 * The Batch API, wired to this app's database, keys and settings (sub-phase 7.3).
 *
 * The counterpart of `createMainAiClient`, and it exists for the same reason: `packages/ai`
 * knows nothing about SQLite, `safeStorage` or Electron, so somebody has to turn its four
 * ports into repositories. What makes this file worth reading is **where the poll loop runs**.
 *
 * The obvious home for it is the job queue of sub-phase 3.4, and the sub-phase brief names
 * exactly that. It cannot live there, and the reason is a security property rather than an
 * oversight: job definitions execute in a `utilityProcess` that is forked with an **empty
 * environment** and never touches SQLite (`apps/desktop/src/worker/index.ts`), precisely so a
 * provider key can never reach a PDF parser. A poll needs the key and the database, so it
 * would need both of those guarantees relaxed for every job in the pool.
 *
 * So the loop runs in main, and what it borrows from the queue is the part that actually
 * matters: **durable backoff**. `ai_batches.next_poll_at` and `ai_batches.attempts` are that
 * table's `run_after` and `attempts`, `resume()` at startup is `recoverOrphans()`, and the
 * work item is a job on the provider's side rather than in our pool. The acceptance criterion
 * — kill the app mid-batch, restart, polling continues — is a property of those columns, not
 * of which process owns the timer.
 */

export interface MainBatchRepositories {
  aiBatches: Pick<AiBatchRepository, 'create' | 'update' | 'findById' | 'listActive'>
  aiCalls: Pick<AiCallRepository, 'record' | 'sumCost'>
  aiResults: Pick<AiResultRepository, 'findByCustomId' | 'put'>
  settings: Pick<SettingsRepository, 'get'>
}

export interface MainBatchRunnerOptions {
  repos: MainBatchRepositories
  secrets: Pick<SecretStore, 'getSecret'>
  /** The synchronous path, so `runJob`'s head goes through the one loop that logs a call. */
  ai: AiClient
  /** Pushes a tray update. Called on every state change of every batch. */
  emit: (event: AiBatchEvent) => void
  /**
   * The provider seam, defaulting to the real REST adapters.
   *
   * Overridden only by `batch.test.ts`, so the wiring below — the store, the tray projection,
   * the two settings reads, the path redaction — can be driven end to end without a network.
   * Without it a unit test of this file would submit to `api.anthropic.com`.
   */
  adapters?: Partial<Record<ProviderKind, BatchProvider>>
  fallback?: BatchProvider
}

/** `AiBatch` (the row) → `AiBatchRecord` (what `packages/ai` deals in). */
function toRecord(row: AiBatch): AiBatchRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    role: row.role,
    purpose: row.purpose,
    stage: row.stage,
    status: row.status,
    providerBatchId: row.providerBatchId,
    requestCount: row.requestCount,
    succeededCount: row.succeededCount,
    failedCount: row.failedCount,
    costEstimateUsd: row.costEstimateUsd,
    costUsd: row.costUsd,
    attempts: row.attempts,
    submittedAt: row.submittedAt,
    nextPollAt: row.nextPollAt,
    completedAt: row.completedAt,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    error: row.error,
    createdAt: row.createdAt,
  }
}

/** What crosses the bridge: the row, with no provider job id and no main-process paths. */
export function toBatchEvent(batch: AiBatchRecord): AiBatchEvent {
  return {
    id: batch.id,
    provider: batch.provider,
    model: batch.model,
    purpose: batch.purpose,
    status: batch.status,
    requestCount: batch.requestCount,
    succeededCount: batch.succeededCount,
    failedCount: batch.failedCount,
    costEstimateUsd: batch.costEstimateUsd,
    costUsd: batch.costUsd,
    // The provider's own job id stays in main. The renderer addresses a batch by *our* id,
    // and a provider id is an account-scoped handle with nothing to gain from crossing.
    submittedAt: batch.submittedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    error: batch.error === null ? null : redactPaths(batch.error),
  }
}

function createStore(repos: MainBatchRepositories): AiBatchStore {
  return {
    create: async (input) =>
      toRecord(
        await repos.aiBatches.create({
          provider: input.provider,
          model: input.model,
          role: input.role,
          purpose: input.purpose,
          stage: input.stage,
          status: input.status,
          providerBatchId: null,
          requestCount: input.requestCount,
          succeededCount: 0,
          failedCount: 0,
          costEstimateUsd: input.costEstimateUsd,
          costUsd: 0,
          attempts: 0,
          submittedAt: null,
          nextPollAt: input.nextPollAt,
          completedAt: null,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
          error: null,
          meta: null,
        }),
      ),
    update: async (id, patch) =>
      toRecord(
        await repos.aiBatches.update(id, {
          // Spread as-is: the repository's `defined()` already drops `undefined`, so a patch
          // of four columns leaves the other seventeen alone.
          ...patch,
          ...(patch.error === undefined || patch.error === null
            ? {}
            : { error: redactPaths(patch.error) }),
        }),
      ),
    findById: async (id) => {
      const row = await repos.aiBatches.findById(id)
      return row === undefined ? undefined : toRecord(row)
    },
    listActive: async () => (await repos.aiBatches.listActive()).map(toRecord),
  }
}

export function createMainBatchRunner({
  repos,
  secrets,
  ai,
  emit,
  adapters,
  fallback,
}: MainBatchRunnerOptions): BatchRunner {
  return createBatchRunner({
    // Anthropic Message Batches and Gemini Batch. A profile of any other kind — 7.4's local
    // models, an aggregator — misses this map and takes the sequential fallback, which is
    // the same feature without the 50 %.
    adapters: adapters ?? createBatchAdapters(),
    fallback: fallback ?? createSequentialBatchProvider(createSdkInvoker()),

    // The same resolver `createMainAiClient` uses, for the same reason: the allowlist is read
    // per call, so a changed setting takes effect without a relaunch.
    registry: async () => ({
      profiles: allowedProfiles(
        DEFAULT_PROFILES,
        await repos.settings.get('ai.providers.allowlist'),
      ),
      roles: DEFAULT_ROLES,
    }),
    pricing: SHIPPED_PRICING,
    getSecret: (name) => secrets.getSecret(name),

    recordCall: async (call) => {
      await repos.aiCalls.record({
        ...call,
        error: call.error === null ? null : redactPaths(call.error),
      })
    },

    store: createStore(repos),

    // `runJob`'s synchronous head goes through the ordinary client, so the first two lessons
    // are logged, budgeted, retried and cached by exactly the code every other call uses.
    sync: (binding, request) => ai.textGenerator(binding)(request),

    resultCache: {
      get: async (customId) => {
        const row = await repos.aiResults.findByCustomId(customId)
        return row === undefined
          ? undefined
          : {
              customId: row.customId,
              output: row.output,
              model: row.model,
              provider: row.provider,
              costUsd: row.costUsd,
            }
      },
      put: async (result) => {
        await repos.aiResults.put({
          customId: result.customId,
          stage: result.stage,
          provider: result.provider,
          model: result.model,
          promptVersion: result.promptVersion ?? null,
          schemaVersion: result.schemaVersion ?? null,
          output: result.output,
          costUsd: result.costUsd,
          hits: 0,
          lastHitAt: null,
          meta: null,
        })
      },
    },

    spentSinceUsd: (from) => repos.aiCalls.sumCost({ from }),
    monthlyBudgetUsd: () => repos.settings.get('ai.budget.monthlyUsd'),
    hardBlockEnabled: () => repos.settings.get('ai.budget.hardBlock'),

    clock: { now: () => new Date() },
    timers: {
      setTimeout: (fn, ms) => {
        // `unref` is deliberate: a five-minute poll timer must never be the reason the app
        // refuses to quit. A batch that is still running when the user closes the window is
        // picked up again by `resume()` on the next launch, which is what the row is for.
        setTimeout(fn, ms).unref()
      },
      sleep: async (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms).unref()
        }),
    },
    random: Math.random,

    onChange: (batch) => {
      emit(toBatchEvent(batch))
    },

    onBudgetEvent: (event) => {
      const spent = event.spentUsd.toFixed(2)
      const cap = event.capUsd.toFixed(2)
      log.warn(
        event.kind === 'blocked'
          ? `[ai] a batch was refused: the monthly budget is spent (USD ${spent} of ${cap})`
          : `[ai] the monthly AI budget is ${event.threshold ?? 0} % spent ` +
              `(USD ${spent} of ${cap}) for ${event.period}`,
      )
    },

    logger: {
      warn: (message) => {
        log.warn(message)
      },
      error: (message, error) => {
        log.error(message, error)
      },
    },
  })
}

/**
 * What the `ai.*` IPC handlers call.
 *
 * The same shape `JobsFacade` has, and for the same reason: the handlers stay a one-line
 * mapping from a channel to a method, and the runner never learns that IPC exists.
 */
export interface BatchesFacade {
  list(): Promise<AiBatchSummary[]>
  /** `null` when the id names no batch — a tray row the user clicked twice. */
  cancel(id: string): Promise<AiBatchSummary | null>
}

export function createBatchesFacade(runner: BatchRunner): BatchesFacade {
  return {
    list: async () => (await runner.list()).map(toBatchEvent),
    cancel: async (id) => {
      const cancelled = await runner.cancel(id)
      return cancelled === undefined ? null : toBatchEvent(cancelled)
    },
  }
}
