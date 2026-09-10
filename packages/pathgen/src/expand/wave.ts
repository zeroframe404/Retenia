import type {
  AiBatchRecord,
  AiBinding,
  AiClient,
  AiResultCache,
  BatchRequest,
  BatchRunner,
  RunJobOutcome,
  StructuredObjectRequest,
  Timers,
} from '@retenia/ai'
import {
  DEFAULT_SANITIZE_LIMITS,
  isAiError,
  isTerminalBatchStatus,
  validateStructuredCompletion,
} from '@retenia/ai'
import type { AbortSignalLike, Clock } from '@retenia/core'
import type { BudgetGuard } from '../budget'
import { waitForBatch } from '../extract/await-batch'
import { runPool } from '../extract/pool'
import type { PathgenLogger } from '../logger'
import { addUsage, type StageUsage, usageOf, ZERO_USAGE } from '../usage'

/**
 * One wave of same-shaped calls, dispatched the way `extract/extract-chunks.ts` dispatches a
 * stage — and for the same reasons, so there is one implementation of the order rather than
 * two that drift:
 *
 * 1. answers already in `ai_results` are replayed without a call;
 * 2. a batch a previous attempt left in flight is awaited, then read back;
 * 3. the rest is dispatched — synchronously through `AiClient.structured` when somebody is
 *    waiting, otherwise through `BatchRunner.runJob` at half price;
 * 4. anything the batch could not answer, or answered unreadably, falls back to a synchronous
 *    call rather than failing the wave.
 *
 * What is deliberately *not* here is what a wave means. P3, P4 and P5 differ only in their
 * requests and in what `onAnswer` does with the value; the ordering between waves belongs to
 * the caller, because only it knows that P4 and P5 read what P3 wrote.
 */

export interface WaveRequest<T> {
  readonly customId: string
  readonly structured: StructuredObjectRequest<T>
  readonly batch: BatchRequest
}

export interface WaveDeps {
  readonly ai: Pick<AiClient, 'structured'>
  readonly runner?: Pick<BatchRunner, 'runJob' | 'poll' | 'list' | 'cancel'>
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly logger: PathgenLogger
  readonly concurrency: number
  /** Fires as soon as a batch is submitted, so its id is persisted before anything waits. */
  readonly onBatch?: (batchId: string) => void | Promise<void>
  readonly onPoll?: (batch: AiBatchRecord) => void
}

export interface WaveInput<T> {
  readonly requests: readonly WaveRequest<T>[]
  readonly binding: AiBinding
  /** Somebody is watching: dispatch synchronously with a worker pool. */
  readonly userWaiting: boolean
  readonly allowOverBudget: boolean
  readonly budget?: BudgetGuard
  readonly perCallEstimateUsd?: number
  /** Batches a previous attempt of this run submitted, from `generation_runs.progress`. */
  readonly batchIds?: readonly string[]
  readonly signal?: AbortSignalLike
}

export interface WaveAnswer<T> {
  readonly index: number
  readonly value: T
  readonly model: string
  /** `cache` was replayed from `ai_results`; `call` was paid for now. */
  readonly how: 'cache' | 'call'
}

export type WaveStatus = 'completed' | 'cancelled' | 'blocked_budget'

export interface WaveResult {
  readonly status: WaveStatus
  readonly cacheHits: number
  readonly calls: number
  readonly failed: readonly { readonly customId: string; readonly error: string }[]
  readonly usage: StageUsage
  readonly batchIds: readonly string[]
  readonly modelsUsed: readonly string[]
}

/** One batch per this many requests; the runner's own ceiling is 5,000. */
export const MAX_BATCH_SLICE = 2_000
export const MAX_FAILURE_MESSAGE_CHARS = 200

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_FAILURE_MESSAGE_CHARS
    ? `${text.slice(0, MAX_FAILURE_MESSAGE_CHARS)}…`
    : text
}

type Interruption = 'cancelled' | 'budget' | undefined

function interruptionOf(error: unknown, signal: AbortSignalLike | undefined): Interruption {
  if (signal?.aborted === true) return 'cancelled'
  if (isAiError(error)) {
    if (error.code === 'aborted') return 'cancelled'
    if (error.code === 'budget_exceeded') return 'budget'
  }
  return undefined
}

export async function runWave<T>(
  deps: WaveDeps,
  input: WaveInput<T>,
  onAnswer: (answer: WaveAnswer<T>) => Promise<void>,
): Promise<WaveResult> {
  const settled = new Set<number>()
  const failed: { customId: string; error: string }[] = []
  const batchIds: string[] = []
  const modelsUsed = new Set<string>()
  let usage: StageUsage = ZERO_USAGE
  let cacheHits = 0
  let calls = 0
  let cancelled = false
  let paused = false

  const at = (index: number): WaveRequest<T> => input.requests[index] as WaveRequest<T>
  const aborted = (): boolean => input.signal?.aborted === true
  const stopped = (): boolean => cancelled || paused
  const perCallUsd = input.perCallEstimateUsd ?? 0
  const budget = input.allowOverBudget ? undefined : input.budget

  const settle = async (index: number, value: T, model: string, how: WaveAnswer<T>['how']) => {
    settled.add(index)
    if (model !== '') modelsUsed.add(model)
    if (how === 'cache') cacheHits += 1
    await onAnswer({ index, value, model, how })
  }

  /** A completion that arrived as text: from `ai_results` or from the runner's own results. */
  const settleText = async (
    index: number,
    text: string,
    model: string,
    how: WaveAnswer<T>['how'],
  ): Promise<boolean> => {
    const request = at(index)
    const outcome = validateStructuredCompletion(
      text,
      request.structured.schema,
      request.structured.sanitizeLimits ?? DEFAULT_SANITIZE_LIMITS,
    )
    if (!outcome.ok) {
      deps.logger.warn(
        `[pathgen] the stored answer for ${request.customId} does not validate: ` +
          outcome.issues.join('; '),
      )
      return false
    }
    await settle(index, outcome.value, model, how)
    return true
  }

  const pending = (): number[] =>
    input.requests.flatMap((_, index) =>
      settled.has(index) || failed.some((entry) => entry.customId === at(index).customId)
        ? []
        : [index],
    )

  const replayCache = async (cache: NonNullable<WaveDeps['resultCache']>): Promise<void> => {
    for (const index of pending()) {
      if (aborted()) return
      const cached = await cache.get(at(index).customId)
      if (cached === undefined) continue
      await settleText(index, cached.output, cached.model, 'cache')
    }
  }

  const dispatchSync = async (indices: readonly number[]): Promise<void> => {
    await runPool(
      indices,
      deps.concurrency,
      async (index) => {
        if (aborted()) {
          cancelled = true
          return
        }
        // One call at a time against the cap: the pre-flight quote already judged the whole
        // job, and a resumed run with a raised cap must be able to make progress.
        if (budget?.wouldExceed(perCallUsd) === true) {
          paused = true
          return
        }
        const request = at(index)
        try {
          const result = await deps.ai.structured(input.binding)(request.structured)
          calls += 1
          const spent = usageOf(result.usage)
          usage = addUsage(usage, spent)
          budget?.add(spent.usd)
          await settle(index, result.value, result.model, 'call')
        } catch (error) {
          const interruption = interruptionOf(error, input.signal)
          if (interruption === 'cancelled') cancelled = true
          else if (interruption === 'budget') paused = true
          else failed.push({ customId: request.customId, error: messageOf(error) })
        }
      },
      stopped,
    )
  }

  const dispatchBatch = async (
    runner: NonNullable<WaveDeps['runner']>,
    cache: NonNullable<WaveDeps['resultCache']>,
    indices: readonly number[],
  ): Promise<void> => {
    for (let start = 0; start < indices.length && !stopped(); start += MAX_BATCH_SLICE) {
      const slice = indices.slice(start, start + MAX_BATCH_SLICE)
      if (budget?.wouldExceed(slice.length * perCallUsd) === true) {
        paused = true
        return
      }

      let outcome: RunJobOutcome
      try {
        outcome = await runner.runJob(
          input.binding,
          slice.map((index) => at(index).batch),
          {
            batchable: true,
            userWaiting: false,
            head: 0,
            allowOverBudget: input.allowOverBudget,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        )
      } catch (error) {
        const interruption = interruptionOf(error, input.signal)
        if (interruption === 'cancelled') {
          cancelled = true
          return
        }
        if (interruption === 'budget') {
          paused = true
          return
        }
        deps.logger.error('[pathgen] the batch could not be submitted; dispatching now', error)
        await dispatchSync(slice)
        continue
      }

      const byId = new Map(slice.map((index) => [at(index).customId, index]))
      const fallback: number[] = []

      // The runner answered some of it synchronously — all of it when the policy chose `sync`.
      for (const answered of outcome.results) {
        const index = byId.get(answered.customId)
        if (index === undefined) continue
        calls += 1
        usage = addUsage(usage, usageOf(answered.result.usage))
        const ok = await settleText(index, answered.result.text, answered.result.model, 'call')
        if (!ok) fallback.push(index)
      }

      if (outcome.batch !== undefined) {
        const id = outcome.batch.id
        batchIds.push(id)
        await deps.onBatch?.(id)
        const final = await waitForBatch(
          id,
          {
            runner,
            clock: deps.clock,
            timers: deps.timers,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            ...(deps.onPoll === undefined ? {} : { onPoll: deps.onPoll }),
          },
          outcome.batch,
        )
        if (aborted()) {
          if (final !== undefined && !isTerminalBatchStatus(final.status)) {
            try {
              await runner.cancel(id)
            } catch (error) {
              deps.logger.warn(`[pathgen] batch ${id} could not be cancelled: ${messageOf(error)}`)
            }
          }
          cancelled = true
          return
        }

        // Read back what the batch reconciled into `ai_results`; the rest goes synchronous.
        for (const index of slice) {
          if (settled.has(index) || fallback.includes(index)) continue
          const cached = await cache.get(at(index).customId)
          if (cached === undefined) {
            fallback.push(index)
            continue
          }
          calls += 1
          usage = addUsage(usage, { ...ZERO_USAGE, usd: cached.costUsd })
          if (!(await settleText(index, cached.output, cached.model, 'call'))) fallback.push(index)
        }
      }

      if (fallback.length > 0 && !stopped()) {
        fallback.sort((left, right) => left - right)
        await dispatchSync(fallback)
      }
    }
  }

  if (deps.resultCache !== undefined) await replayCache(deps.resultCache)

  if (deps.runner !== undefined && deps.resultCache !== undefined && input.batchIds !== undefined) {
    for (const id of input.batchIds) {
      if (aborted()) break
      batchIds.push(id)
      await waitForBatch(id, {
        runner: deps.runner,
        clock: deps.clock,
        timers: deps.timers,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(deps.onPoll === undefined ? {} : { onPoll: deps.onPoll }),
      })
    }
    await replayCache(deps.resultCache)
  }

  const remaining = pending()
  if (remaining.length > 0 && !aborted()) {
    const batchable =
      !input.userWaiting && deps.runner !== undefined && deps.resultCache !== undefined
    if (batchable) {
      await dispatchBatch(
        deps.runner as NonNullable<WaveDeps['runner']>,
        deps.resultCache as NonNullable<WaveDeps['resultCache']>,
        remaining,
      )
    } else {
      if (!input.userWaiting && deps.runner !== undefined) {
        deps.logger.warn('[pathgen] no result cache is wired, so the batch path is unavailable')
      }
      await dispatchSync(remaining)
    }
  }
  if (aborted()) cancelled = true

  return {
    status: cancelled ? 'cancelled' : paused ? 'blocked_budget' : 'completed',
    cacheHits,
    calls,
    failed,
    usage,
    batchIds,
    modelsUsed: [...modelsUsed].sort(),
  }
}
