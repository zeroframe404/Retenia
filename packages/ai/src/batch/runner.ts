import type { AbortSignalLike, AiCall, Clock, NewEntity, SecretName } from '@retenia/core'
import { toAbortSignal } from '../abort'
import type { AiBudgetEvent } from '../budget'
import { crossedThresholds, monthKey, startOfMonth } from '../budget'
import type { AiCallMeta } from '../cost-log'
import { sanitizeMeta } from '../cost-log'
import { AiError, asAiError, redactKey } from '../errors'
import type { AiResultCache } from '../idempotency'
import type { InvokeTarget } from '../invoker'
import type { Random, Timers } from '../ports'
import type { BillableUsage, PricingTable } from '../pricing'
import { computeCostUsd, modelKey, ZERO_USAGE } from '../pricing'
import type { ProviderKind } from '../profiles'
import type { AiRegistry, RoleTarget } from '../roles'
import { resolveTargets } from '../roles'
import type { AiBinding } from '../run'
import type { TextGenerationRequest, TextGenerationResult } from '../text-generator'
import type { TokenCounter } from '../tokens'
import { pollDelayMs } from './backoff'
import type { BatchEstimate } from './estimate'
import { estimateBatch } from './estimate'
import { chooseDispatch, type Dispatch, SYNCHRONOUS_HEAD, splitSynchronousHead } from './plan'
import type { BatchItemOutcome, BatchPoll, BatchProvider, BatchRequest } from './provider'
import type { AiBatchPatch, AiBatchRecord, AiBatchStore } from './types'
import { isTerminalBatchStatus } from './types'

/**
 * The Batch API, end to end: quote, submit, poll with backoff, reconcile, retry the failures,
 * cancel (sub-phase 7.3; `docs/spec/06-ai-providers.md` §2, `04-path-generation.md` §3 stage 7).
 *
 * Four invariants hold everything else together, and each exists because the obvious
 * implementation gets it wrong in a way that costs money or loses work:
 *
 * - **The row is written before the provider is called.** A crash between the two would
 *   otherwise leave a job running upstream that this app has no record of and will never
 *   collect — paid for, and invisible. `submitting` is what that window looks like from the
 *   outside, and `resume()` retires anything it finds in it.
 * - **A result is reconciled at most once.** Twice would mean two `ai_calls` rows for one
 *   charge, and the month's total is the one number the budget depends on. The guard is
 *   `ai_results` itself: `custom_id` is unique per unit of work, so an id already in the
 *   answer store has already been paid for and logged, whatever this process remembers.
 * - **Polling state is durable, not in-memory.** `nextPollAt` and `attempts` live on the row,
 *   so killing the app mid-batch and restarting resumes exactly where it left off rather than
 *   abandoning an hour of work that has already been bought.
 * - **The requests are not.** See `types.ts` for why, and for what that costs.
 */

/** The sub-phase's "retry only failed ids, max 2". */
export const MAX_BATCH_RETRIES = 2

/**
 * How many consecutive polls may fail before the batch is given up on.
 *
 * The ceiling is 24 h (§2) and the backoff caps at 5 minutes, so this is roughly two hours of
 * a provider being unreachable. Long enough to sit out an outage; short enough that a batch
 * whose id the provider has forgotten does not poll forever.
 */
export const MAX_POLL_FAILURES = 24

/**
 * How long a single call to a provider's batch endpoint may take.
 *
 * Two minutes, which is generous for a status check and enough for a large results file on a
 * slow connection. It exists because *none* of these calls has a caller waiting on it: a poll
 * is fired by a timer, so a request that never settles never schedules the next one, and the
 * batch stops making progress with nothing recorded anywhere. A deadline turns that into an
 * ordinary poll failure that the backoff and `MAX_POLL_FAILURES` already know what to do with.
 */
export const REQUEST_TIMEOUT_MS = 120_000

/**
 * The largest batch this layer will submit at once.
 *
 * The spec allows 100,000 requests. The ceiling here is far lower because the *results* of a
 * batch come back to the main process in one response: a run that cannot be read is worse than
 * one that was never submitted, so the two limits are set together (`MAX_RESPONSE_BYTES` in
 * `providers/batch/http.ts`). Five thousand is an order of magnitude above the biggest unit of
 * work this app has — a 300-page book is ~40 lessons and ~150 item-bank entries.
 */
export const MAX_BATCH_REQUESTS = 5_000

export interface BatchRunnerDeps {
  /**
   * Batch adapters by provider kind. A kind with no entry takes `fallback` — which is what
   * makes "OpenRouter/local → transparent sequential fallback" a lookup miss rather than a
   * branch every caller has to know about.
   */
  adapters: Partial<Record<ProviderKind, BatchProvider>>
  fallback: BatchProvider
  registry: () => Promise<AiRegistry>
  pricing: PricingTable
  getSecret: (name: SecretName) => Promise<string | undefined>
  recordCall: (call: NewEntity<AiCall>) => Promise<void>
  store: AiBatchStore
  /**
   * One synchronous completion — `AiClient.textGenerator(binding)`.
   *
   * Injected rather than reached for, because `runOnce` is the only thing that may write an
   * `ai_calls` row for a dispatched call, and a second copy of that loop here would be a
   * second place for the budget gate and the retry policy to drift.
   */
  sync: (binding: AiBinding, request: TextGenerationRequest) => Promise<TextGenerationResult>
  resultCache?: AiResultCache
  spentSinceUsd: (from: Date) => Promise<number>
  monthlyBudgetUsd: () => Promise<number>
  hardBlockEnabled: () => Promise<boolean>
  clock: Clock
  timers: Timers
  random: Random
  onBudgetEvent?: (event: AiBudgetEvent) => void
  /** Fires whenever a batch row moves, so the tray can be pushed rather than polled. */
  onChange?: (batch: AiBatchRecord) => void
  countTokens?: TokenCounter
  /** What one request is assumed to produce, for the quote. */
  outputTokensPerRequest?: number
  logger: { warn(message: string): void; error(message: string, error?: unknown): void }
}

export interface SubmitBatchOptions {
  /** Reuse a quote already shown to the user, rather than recomputing a slightly different one. */
  readonly estimate?: BatchEstimate
  /** The user confirmed this one spend over the monthly cap. */
  readonly allowOverBudget?: boolean
  readonly signal?: AbortSignalLike
}

export interface RunJobOptions {
  /** The work tolerates up to a day of latency. */
  readonly batchable?: boolean
  readonly userWaiting?: boolean
  /** How many to run synchronously before batching the rest. Defaults to §3 stage 7's two. */
  readonly head?: number
  readonly allowOverBudget?: boolean
  readonly signal?: AbortSignalLike
}

export interface RunJobResult {
  readonly customId: string
  readonly result: TextGenerationResult
}

export interface RunJobOutcome {
  readonly dispatch: Dispatch
  /** Everything answered before this call returned: all of it when `sync`, the head when `batch`. */
  readonly results: readonly RunJobResult[]
  /** The queued remainder. Absent when the policy chose `sync`. */
  readonly batch: AiBatchRecord | undefined
}

export interface BatchRunner {
  estimate(binding: AiBinding, requests: readonly BatchRequest[]): Promise<BatchEstimate>
  submitBatch(
    binding: AiBinding,
    requests: readonly BatchRequest[],
    options?: SubmitBatchOptions,
  ): Promise<AiBatchRecord>
  /** One poll tick. Public so the loop is a scheduler over a testable step, not a black box. */
  poll(id: string): Promise<AiBatchRecord | undefined>
  cancel(id: string): Promise<AiBatchRecord | undefined>
  list(): Promise<readonly AiBatchRecord[]>
  /** §3 stage 7's "first two synchronous, the rest batched", as one call. */
  runJob(
    binding: AiBinding,
    requests: readonly BatchRequest[],
    options?: RunJobOptions,
  ): Promise<RunJobOutcome>
  /** Pick up whatever the last run left in flight. Call once at startup. */
  resume(): Promise<readonly AiBatchRecord[]>
  stop(): void
}

/** What a batch keeps in memory: the requests, so failures can be retried in this process. */
interface InFlight {
  readonly requests: Map<string, TextGenerationRequest>
  /** `custom_id`s already turned into an `ai_calls` row by this process. */
  readonly reconciled: Set<string>
  retries: number
}

export function createBatchRunner(deps: BatchRunnerDeps): BatchRunner {
  const inFlight = new Map<string, InFlight>()
  /**
   * Consecutive polls that threw, per batch. Reset by any poll that answers.
   *
   * Kept apart from `inFlight` on purpose: a batch resumed after a restart has no `InFlight`
   * entry — the requests are gone — but it still has to be able to give up on a provider that
   * has forgotten its id, or it would poll every five minutes for ever. Process-local rather
   * than a column, because a fresh process genuinely should give the provider another chance.
   */
  const pollFailures = new Map<string, number>()
  /**
   * In-flight polls, keyed by batch id.
   *
   * The reconciliation guard is a read-then-write — "is this `custom_id` already in
   * `ai_results`?", then record and store — so two overlapping polls of the same batch would
   * both see `undefined` and both write an `ai_calls` row for one charge. `poll` is public
   * (the loop is a scheduler over a testable step) and `resume()` can race a timer that is
   * already pending, so the overlap is reachable rather than theoretical. Sharing the promise
   * makes a second caller wait for the first rather than duplicate it.
   */
  const polling = new Map<string, Promise<AiBatchRecord | undefined>>()
  /** Aborted by `stop()`, so a request in flight at shutdown does not hold the process. */
  const lifetime = new AbortController()
  let stopped = false

  /**
   * A signal for one provider call: this runner's lifetime, plus a deadline.
   *
   * `AbortSignal.any` rather than a hand-rolled listener pair, so nothing is left subscribed
   * to `lifetime` once the call settles — a poll every five minutes for a day would otherwise
   * accumulate 288 listeners on one long-lived signal.
   */
  const callOptions = (): { signal: AbortSignal } => ({
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  })

  const emit = (batch: AiBatchRecord): AiBatchRecord => {
    deps.onChange?.(batch)
    return batch
  }

  const patch = async (id: string, changes: AiBatchPatch): Promise<AiBatchRecord> =>
    emit(await deps.store.update(id, changes))

  /**
   * One target for the whole batch, never a fallback chain.
   *
   * A synchronous call may move to the next model in the role after a 429; a batch may not.
   * The job is a single object on one provider's account, its results are keyed to it, and
   * "resubmit forty requests somewhere else" is a decision with a price attached — so it
   * belongs to the caller, who can see the quote, and not to a silent retry in here.
   */
  const resolve = async (
    role: AiBinding['role'],
  ): Promise<{
    target: RoleTarget
    invoke: InvokeTarget
    provider: BatchProvider
    batch: boolean
  }> => {
    const [target] = resolveTargets(role, await deps.registry())
    if (target === undefined) {
      throw new AiError('not_configured', `no provider is configured for the "${role}" role`)
    }
    const apiKey = target.profile.keyRef === null ? '' : await deps.getSecret(target.profile.keyRef)
    if (apiKey === undefined) {
      throw new AiError(
        'not_configured',
        `no API key is stored for the "${target.profile.id}" provider`,
        { profileId: target.profile.id, model: target.modelId },
      )
    }
    const adapter = deps.adapters[target.profile.kind]
    return {
      target,
      invoke: { profile: target.profile, modelId: target.modelId, apiKey },
      provider: adapter ?? deps.fallback,
      batch: adapter !== undefined,
    }
  }

  /** The same target, reconstructed from a stored row — what `poll` after a restart needs. */
  const resolveStored = async (
    batch: AiBatchRecord,
  ): Promise<{ invoke: InvokeTarget; provider: BatchProvider; batch: boolean }> => {
    const { profiles } = await deps.registry()
    const profile = profiles.find((candidate) => candidate.id === batch.provider)
    if (profile === undefined) {
      throw new AiError(
        'not_configured',
        `the "${batch.provider}" provider this batch was submitted to is no longer configured`,
      )
    }
    const apiKey = profile.keyRef === null ? '' : await deps.getSecret(profile.keyRef)
    if (apiKey === undefined) {
      throw new AiError('not_configured', `no API key is stored for the "${profile.id}" provider`, {
        profileId: profile.id,
        model: batch.model,
      })
    }
    const adapter = deps.adapters[profile.kind]
    return {
      invoke: { profile, modelId: batch.model, apiKey },
      provider: adapter ?? deps.fallback,
      batch: adapter !== undefined,
    }
  }

  /**
   * The monthly cap, checked once against the *quote* rather than per request.
   *
   * A batch is the largest single spend this app makes, and it is committed in one call: by
   * the time the first result arrives the money is gone. So the gate reads the same two
   * settings `runOnce` does and refuses before submission, which is the only moment refusing
   * is still worth anything.
   */
  const gateBudget = async (
    purpose: string,
    estimateUsd: number,
    allowOverBudget: boolean,
  ): Promise<void> => {
    const now = deps.clock.now()
    const capUsd = await deps.monthlyBudgetUsd()
    if (capUsd <= 0) return // 0 means NO CAP; see `run.ts`.
    const spent = await deps.spentSinceUsd(startOfMonth(now))
    if (spent + estimateUsd < capUsd) return

    deps.onBudgetEvent?.({
      kind: 'blocked',
      period: monthKey(now),
      spentUsd: spent,
      capUsd,
      purpose,
    })
    if ((await deps.hardBlockEnabled()) && !allowOverBudget) {
      throw new AiError(
        'budget_exceeded',
        `submitting this batch would cost about USD ${estimateUsd.toFixed(2)} and the ` +
          `monthly AI budget of USD ${capUsd.toFixed(2)} is at USD ${spent.toFixed(2)}`,
      )
    }
  }

  const scheduleNext = (id: string, attempt: number, retryAfterMs?: number): Date => {
    const delay = pollDelayMs(attempt, deps.random, retryAfterMs)
    const at = new Date(deps.clock.now().getTime() + delay)
    deps.timers.setTimeout(() => {
      if (stopped) return
      // The tick is fire-and-forget by construction: nothing awaits a poll, and a rejection
      // from a detached timer would be an unhandled rejection rather than a failed batch.
      void poll(id).catch((error: unknown) => {
        deps.logger.error(`[ai] the poll of batch ${id} threw`, error)
      })
    }, delay)
    return at
  }

  /**
   * Turn finished items into `ai_results` answers and `ai_calls` rows.
   *
   * Writes whatever it is given; **which** items to give it is the caller's decision, and in
   * `poll` it is two different decisions. Successes are reconciled the moment they arrive, so
   * a long batch fills the answer store progressively. Failures wait until the batch is
   * genuinely finished with them — a failed id that is about to be resubmitted is not a
   * failure yet, and logging it as one would put an error row in the cost log for a request
   * that goes on to succeed, and would count it in the tray as lost work while it is still
   * being done.
   *
   * Returns what it wrote, so the caller can move the counters and the spend in one update.
   * Never throws: a batch whose answers arrived must not be lost because one write failed,
   * and the item that failed to store simply is not counted as reconciled — the next poll
   * (or the caller's next run, through the cache) will see it again.
   */
  const reconcile = async (
    batch: AiBatchRecord,
    state: InFlight | undefined,
    invoke: InvokeTarget,
    realBatch: boolean,
    items: readonly BatchItemOutcome[],
  ): Promise<{ succeeded: number; failed: number; costUsd: number }> => {
    let succeeded = 0
    let failed = 0
    let costUsd = 0

    for (const item of items) {
      const ok = item.outcome.kind === 'ok'
      if (state?.reconciled.has(item.customId) === true) continue

      // The durable guard. `custom_id` is unique per unit of work by construction, so an id
      // already in the answer store was already paid for and already logged — by this run
      // before a crash, or by an earlier one. Writing it again would double a charge in the
      // one table the monthly budget is summed from.
      if (ok && deps.resultCache !== undefined) {
        try {
          if ((await deps.resultCache.get(item.customId)) !== undefined) {
            state?.reconciled.add(item.customId)
            succeeded += 1
            continue
          }
        } catch (error) {
          deps.logger.error('[ai] could not read the ai_results cache while reconciling', error)
        }
      }

      const request = state?.requests.get(item.customId)
      const cost = await recordItem(batch, invoke, realBatch, item, request)
      costUsd += cost

      if (ok) {
        await storeAnswer(batch, invoke, item, cost)
        succeeded += 1
      } else {
        failed += 1
      }
      state?.reconciled.add(item.customId)
    }

    return { succeeded, failed, costUsd }
  }

  /** One `ai_calls` row for one batched request. Returns what it cost. */
  const recordItem = async (
    batch: AiBatchRecord,
    invoke: InvokeTarget,
    realBatch: boolean,
    item: BatchItemOutcome,
    request: TextGenerationRequest | undefined,
  ): Promise<number> => {
    const { outcome } = item
    const usage: BillableUsage = outcome.usage ?? ZERO_USAGE
    const key = modelKey(invoke.profile, invoke.modelId)
    const cacheTtl = request?.cache?.ttl

    let costUsd = 0
    let rates: AiCallMeta['rates']
    try {
      const breakdown = computeCostUsd(deps.pricing, {
        modelKey: key,
        usage,
        at: deps.clock.now(),
        // The -50 % applies only where the provider actually has a Batch API. A sequential
        // fallback is billed at full price, and the estimate said so before submission.
        batch: realBatch,
        ...(cacheTtl === undefined ? {} : { cacheTtl }),
      })
      costUsd = breakdown.usd
      rates = {
        input: breakdown.rates.input,
        output: breakdown.rates.output,
        cacheRead: breakdown.rates.cacheRead,
      }
    } catch (error) {
      deps.logger.error(`[ai] no price for ${key}; recording the batched call with no cost`, error)
    }

    const meta: AiCallMeta = {
      attempt: 1,
      target: 0,
      batch: realBatch,
      pricingRevision: deps.pricing.revision,
      ...(rates === undefined ? {} : { rates }),
      ...(usage.cacheWriteTokens > 0 ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      ...(cacheTtl === undefined ? {} : { cacheTtl }),
      ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      ...(outcome.kind === 'ok'
        ? { finishReason: outcome.finishReason }
        : {
            code: outcome.error.code,
            ...(outcome.error.statusCode === undefined
              ? {}
              : { statusCode: outcome.error.statusCode }),
            ...(outcome.usage === undefined ? { costUnknown: true } : {}),
          }),
    }

    const row: NewEntity<AiCall> = {
      provider: invoke.profile.id,
      model: invoke.modelId,
      role: batch.role,
      purpose: batch.purpose,
      status: outcome.kind === 'ok' ? 'ok' : 'error',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      reasoningTokens: usage.reasoningTokens,
      costUsd,
      // Absent by construction: a batched request has no round trip of its own to time. The
      // column is nullable for exactly this, and a synthetic figure would pollute the latency
      // statistics of the calls that do have one.
      latencyMs: null,
      batchId: batch.id,
      customId: item.customId,
      promptVersion: batch.promptVersion,
      schemaVersion: batch.schemaVersion,
      temperature: request?.temperature ?? null,
      jobId: null,
      error: outcome.kind === 'ok' ? null : redactKey(outcome.error.message, invoke.apiKey),
      meta: sanitizeMeta(meta),
    }

    try {
      await deps.recordCall(row)
    } catch (error) {
      deps.logger.error('[ai] could not write the batched ai_calls row', error)
    }
    return costUsd
  }

  const storeAnswer = async (
    batch: AiBatchRecord,
    invoke: InvokeTarget,
    item: BatchItemOutcome,
    costUsd: number,
  ): Promise<void> => {
    if (deps.resultCache === undefined || item.outcome.kind !== 'ok') return
    try {
      await deps.resultCache.put({
        customId: item.customId,
        output: item.outcome.text,
        model: item.outcome.modelId,
        provider: invoke.profile.id,
        costUsd,
        stage: batch.stage,
        promptVersion: batch.promptVersion ?? undefined,
        schemaVersion: batch.schemaVersion ?? undefined,
      })
    } catch (error) {
      deps.logger.error('[ai] could not store a batched answer in ai_results', error)
    }
  }

  /** The budget alerts, moved by what a reconciliation actually recorded. */
  const reportSpend = async (purpose: string, costUsd: number): Promise<void> => {
    if (costUsd <= 0 || deps.onBudgetEvent === undefined) return
    try {
      const now = deps.clock.now()
      const capUsd = await deps.monthlyBudgetUsd()
      if (capUsd <= 0) return
      const after = await deps.spentSinceUsd(startOfMonth(now))
      for (const threshold of crossedThresholds(after - costUsd, after, capUsd)) {
        deps.onBudgetEvent({
          kind: 'threshold',
          period: monthKey(now),
          threshold,
          spentUsd: after,
          capUsd,
          purpose,
        })
      }
    } catch (error) {
      deps.logger.error('[ai] could not evaluate the budget after a batch reconciliation', error)
    }
  }

  function poll(id: string): Promise<AiBatchRecord | undefined> {
    const running = polling.get(id)
    if (running !== undefined) return running
    const started = pollOnce(id).finally(() => {
      polling.delete(id)
    })
    polling.set(id, started)
    return started
  }

  async function pollOnce(id: string): Promise<AiBatchRecord | undefined> {
    const batch = await deps.store.findById(id)
    if (batch === undefined || isTerminalBatchStatus(batch.status)) return batch

    if (batch.providerBatchId === null) {
      // `submitting` with nothing to poll: the process died between the row and the call, and
      // we cannot tell whether the provider accepted it. Saying so beats inventing an id.
      return await patch(id, {
        status: 'failed',
        error: 'the app stopped while this batch was being submitted; it was never confirmed',
        completedAt: deps.clock.now(),
      })
    }

    const state = inFlight.get(id)
    let resolved: Awaited<ReturnType<typeof resolveStored>>
    try {
      resolved = await resolveStored(batch)
    } catch (error) {
      // No target, so no key to redact against — but the message still lands in
      // `ai_batches.error` and crosses IPC, so it is capped like every other stored error.
      return await patch(id, {
        status: 'failed',
        error: redactKey(asAiError(error, 'not_configured').message, undefined),
        completedAt: deps.clock.now(),
      })
    }

    const attempt = batch.attempts + 1
    let outcome: BatchPoll
    try {
      outcome = await resolved.provider.poll(resolved.invoke, batch.providerBatchId, callOptions())
    } catch (error) {
      const failure = asAiError(error, 'network')
      const failures = (pollFailures.get(id) ?? 0) + 1
      pollFailures.set(id, failures)
      if (failures >= MAX_POLL_FAILURES) {
        pollFailures.delete(id)
        return await patch(id, {
          status: 'failed',
          attempts: attempt,
          error: redactKey(failure.message, resolved.invoke.apiKey),
          completedAt: deps.clock.now(),
        })
      }
      deps.logger.warn(
        `[ai] poll ${attempt} of batch ${id} failed: ` +
          redactKey(failure.message, resolved.invoke.apiKey),
      )
      return await patch(id, { attempts: attempt, nextPollAt: scheduleNext(id, attempt) })
    }
    pollFailures.delete(id)

    const terminal = outcome.status !== 'in_progress'
    const failures = outcome.results.filter((item) => item.outcome.kind !== 'ok')
    const written = await reconcile(
      batch,
      state,
      resolved.invoke,
      resolved.batch,
      outcome.results.filter((item) => item.outcome.kind === 'ok'),
    )
    await reportSpend(batch.purpose, written.costUsd)

    const succeededCount = batch.succeededCount + written.succeeded
    let costUsd = batch.costUsd + written.costUsd

    if (!terminal) {
      return await patch(id, {
        status: 'in_progress',
        attempts: attempt,
        succeededCount,
        costUsd,
        nextPollAt: scheduleNext(id, attempt, outcome.retryAfterMs),
      })
    }

    // Everything the provider finished is in. If some of it failed and we still hold the
    // requests, resubmit exactly those — the sub-phase's "retry only failed ids, max 2".
    if (
      outcome.status === 'completed' &&
      failures.length > 0 &&
      state !== undefined &&
      state.retries < MAX_BATCH_RETRIES
    ) {
      const retryable = failures
        .map(({ customId }) => {
          const request = state.requests.get(customId)
          return request === undefined ? undefined : { customId, request }
        })
        .filter((entry): entry is BatchRequest => entry !== undefined)

      if (retryable.length > 0) {
        state.retries += 1
        try {
          const submission = await resolved.provider.submit(
            resolved.invoke,
            retryable,
            callOptions(),
          )
          deps.logger.warn(
            `[ai] batch ${id}: retrying ${retryable.length} failed request(s), ` +
              `attempt ${state.retries} of ${MAX_BATCH_RETRIES}`,
          )
          // The failures are not counted yet: they are back in flight, and counting them
          // would make the tray say "3 failed" about work that is still being done.
          return await patch(id, {
            status: 'in_progress',
            providerBatchId: submission.providerBatchId,
            attempts: 0,
            succeededCount,
            costUsd,
            nextPollAt: scheduleNext(id, 1),
          })
        } catch (error) {
          deps.logger.error(`[ai] batch ${id}: the retry submission failed`, error)
        }
      }
    }

    // Nothing more will be asked of these ids, so now they are failures rather than work in
    // progress, and the cost log gets one error row apiece — never one per attempt.
    const lost = await reconcile(batch, state, resolved.invoke, resolved.batch, failures)
    costUsd += lost.costUsd
    const failedCount = batch.failedCount + lost.failed

    inFlight.delete(id)
    pollFailures.delete(id)
    const status =
      outcome.status === 'cancelled'
        ? 'cancelled'
        : outcome.status === 'failed'
          ? 'failed'
          : 'completed'
    return await patch(id, {
      status,
      attempts: attempt,
      succeededCount,
      failedCount,
      costUsd,
      completedAt: deps.clock.now(),
      nextPollAt: null,
      ...(outcome.error === undefined
        ? failedCount > 0 && status === 'completed'
          ? { error: `${failedCount} of ${batch.requestCount} request(s) failed` }
          : {}
        : { error: redactKey(outcome.error.message, resolved.invoke.apiKey) }),
    })
  }

  async function estimate(
    binding: AiBinding,
    requests: readonly BatchRequest[],
  ): Promise<BatchEstimate> {
    const resolved = await resolve(binding.role)
    return estimateBatch(deps.pricing, requests, {
      modelKey: modelKey(resolved.target.profile, resolved.target.modelId),
      at: deps.clock.now(),
      batch: resolved.batch,
      ...(deps.countTokens === undefined ? {} : { countTokens: deps.countTokens }),
      ...(deps.outputTokensPerRequest === undefined
        ? {}
        : { outputTokensPerRequest: deps.outputTokensPerRequest }),
    })
  }

  async function submitBatch(
    binding: AiBinding,
    requests: readonly BatchRequest[],
    options: SubmitBatchOptions = {},
  ): Promise<AiBatchRecord> {
    if (requests.length > MAX_BATCH_REQUESTS) {
      throw new AiError(
        'bad_request',
        `a batch of ${requests.length} requests is over this layer's ceiling of ` +
          `${MAX_BATCH_REQUESTS}; split the work, because the results come back in one ` +
          'response and a run that cannot be read is worse than one never submitted',
      )
    }

    const resolved = await resolve(binding.role)

    // §7's idempotency rule, applied before a single token is spent: anything already in the
    // answer store is not asked again. On a resumed generation run this is most of the batch.
    const pending: BatchRequest[] = []
    let alreadyAnswered = 0
    for (const request of requests) {
      if (binding.force !== true && deps.resultCache !== undefined) {
        try {
          if ((await deps.resultCache.get(request.customId)) !== undefined) {
            alreadyAnswered += 1
            continue
          }
        } catch (error) {
          deps.logger.error('[ai] could not read the ai_results cache before a batch', error)
        }
      }
      pending.push(request)
    }

    const quote =
      options.estimate ??
      estimateBatch(deps.pricing, pending, {
        modelKey: modelKey(resolved.target.profile, resolved.target.modelId),
        at: deps.clock.now(),
        batch: resolved.batch,
        ...(deps.countTokens === undefined ? {} : { countTokens: deps.countTokens }),
        ...(deps.outputTokensPerRequest === undefined
          ? {}
          : { outputTokensPerRequest: deps.outputTokensPerRequest }),
      })

    await gateBudget(binding.purpose, quote.usd, options.allowOverBudget === true)

    const now = deps.clock.now()
    const created = await deps.store.create({
      provider: resolved.target.profile.id,
      model: resolved.target.modelId,
      role: binding.role,
      purpose: binding.purpose,
      stage: binding.stage ?? binding.purpose,
      status: 'submitting',
      requestCount: requests.length,
      costEstimateUsd: quote.usd,
      promptVersion: binding.promptVersion ?? null,
      schemaVersion: binding.schemaVersion ?? null,
      nextPollAt: null,
    })
    emit(created)

    if (pending.length === 0) {
      // The whole batch was already answered. Completed without a provider call, which is
      // exactly what the cache is for and what a resumed run should look like.
      return await patch(created.id, {
        status: 'completed',
        succeededCount: alreadyAnswered,
        completedAt: now,
      })
    }

    inFlight.set(created.id, {
      requests: new Map(pending.map(({ customId, request }) => [customId, request])),
      reconciled: new Set(),
      retries: 0,
    })

    try {
      const submission = await resolved.provider.submit(resolved.invoke, pending, {
        signal: toAbortSignal(options.signal),
      })
      return await patch(created.id, {
        status: 'submitted',
        providerBatchId: submission.providerBatchId,
        submittedAt: now,
        succeededCount: alreadyAnswered,
        nextPollAt: scheduleNext(created.id, 1),
      })
    } catch (error) {
      inFlight.delete(created.id)
      const failure = asAiError(error, 'network')
      return await patch(created.id, {
        status: 'failed',
        error: redactKey(failure.message, resolved.invoke.apiKey),
        completedAt: deps.clock.now(),
      })
    }
  }

  async function cancel(id: string): Promise<AiBatchRecord | undefined> {
    const batch = await deps.store.findById(id)
    if (batch === undefined || isTerminalBatchStatus(batch.status)) return batch

    if (batch.providerBatchId !== null) {
      // Resolved outside the `try` so the key is in scope for the log line below: a message
      // that echoes a header must not reach the log file unredacted.
      let resolved: Awaited<ReturnType<typeof resolveStored>> | undefined
      try {
        resolved = await resolveStored(batch)
        await resolved.provider.cancel(resolved.invoke, batch.providerBatchId, callOptions())
      } catch (error) {
        // The row moves regardless. A provider that will not take the cancellation still
        // finishes the job and still charges for it, and leaving the row `in_progress`
        // because the request failed would leave the tray lying about what the app is doing.
        deps.logger.warn(
          `[ai] the provider would not cancel batch ${id}: ` +
            redactKey(asAiError(error, 'network').message, resolved?.invoke.apiKey),
        )
      }
    }

    inFlight.delete(id)
    pollFailures.delete(id)
    return await patch(id, {
      status: 'cancelled',
      completedAt: deps.clock.now(),
      nextPollAt: null,
    })
  }

  async function runJob(
    binding: AiBinding,
    requests: readonly BatchRequest[],
    options: RunJobOptions = {},
  ): Promise<RunJobOutcome> {
    let batchSupported = false
    try {
      batchSupported = (await resolve(binding.role)).batch
    } catch {
      // Unroutable or unconfigured: let the synchronous path raise the real error, which is
      // the one with the profile and model in it.
    }

    const dispatch = chooseDispatch({
      batchable: options.batchable === true,
      count: requests.length,
      userWaiting: options.userWaiting === true,
      batchSupported,
    })

    const { head, rest } =
      dispatch === 'batch'
        ? splitSynchronousHead(requests, options.head ?? SYNCHRONOUS_HEAD)
        : { head: requests, rest: [] as readonly BatchRequest[] }

    const results: RunJobResult[] = []
    for (const { customId, request } of head) {
      // The key travels with every request, batched or not, so the head lands in the same
      // answer store the batch reconciles into and a resumed run finds all of it.
      results.push({
        customId,
        result: await deps.sync(binding, withKey(request, customId, options.signal)),
      })
    }

    if (dispatch === 'sync' || rest.length === 0) {
      return { dispatch, results, batch: undefined }
    }

    return {
      dispatch,
      results,
      batch: await submitBatch(binding, rest, {
        ...(options.allowOverBudget === undefined
          ? {}
          : { allowOverBudget: options.allowOverBudget }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    }
  }

  async function resume(): Promise<readonly AiBatchRecord[]> {
    const active = await deps.store.listActive()
    const resumed: AiBatchRecord[] = []

    for (const batch of active) {
      if (batch.providerBatchId === null) {
        resumed.push(
          await patch(batch.id, {
            status: 'failed',
            error: 'the app stopped while this batch was being submitted; it was never confirmed',
            completedAt: deps.clock.now(),
          }),
        )
        continue
      }
      // Straight away when it is already due, otherwise on its own schedule — a batch
      // submitted two minutes before the app was closed keeps its place in the backoff.
      const due =
        batch.nextPollAt === null || batch.nextPollAt.getTime() <= deps.clock.now().getTime()
      if (due) {
        void poll(batch.id).catch((error: unknown) => {
          deps.logger.error(`[ai] resuming batch ${batch.id} failed`, error)
        })
      } else {
        scheduleNext(batch.id, batch.attempts + 1)
      }
      resumed.push(batch)
    }
    return resumed
  }

  return {
    estimate,
    submitBatch,
    poll,
    cancel,
    list: () => deps.store.listActive(),
    runJob,
    resume,
    stop: () => {
      stopped = true
      // Aborts whatever is on the wire, so a hung poll cannot outlive the intent to shut down.
      lifetime.abort()
      inFlight.clear()
      pollFailures.clear()
      polling.clear()
    },
  }
}

/** The request, with its `custom_id` as the idempotency key and the caller's signal attached. */
function withKey(
  request: TextGenerationRequest,
  customId: string,
  signal: AbortSignalLike | undefined,
): TextGenerationRequest {
  return {
    ...request,
    idempotencyKey: request.idempotencyKey ?? customId,
    ...(signal === undefined ? {} : { signal }),
  }
}
