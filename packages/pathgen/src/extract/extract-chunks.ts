import type {
  AiBatchRecord,
  AiClient,
  AiResultCache,
  BatchRunner,
  RunJobOutcome,
  Timers,
} from '@retenia/ai'
import { isAiError, isTerminalBatchStatus } from '@retenia/ai'
import type { AbortSignalLike, Clock, Extraction, ExtractionRepository } from '@retenia/core'
import type { BudgetGuard } from '../budget'
import type { ChunkExtraction } from '../consolidate'
import type { PathgenLogger } from '../logger'
import { type PathgenPrompt, systemFor } from '../prompts'
import type { ExtractChunkOutput } from '../schemas/extraction'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { addUsage, type StageUsage, usageOf, ZERO_USAGE } from '../usage'
import { waitForBatch } from './await-batch'
import {
  postValidate,
  readExtractionRow,
  toExtractedChunk,
  toExtractionRow,
  validateExtraction,
} from './collect'
import { runPool } from './pool'
import { buildExtractRequest, type ExtractRequest, extractBinding } from './request'
import type { ExtractableChunk, ExtractSource } from './task'

/**
 * Stage 3 of `docs/spec/04-path-generation.md` §3: one P1 call per chunk, "map, cheap,
 * batch", idempotent per chunk and resumable at any point.
 *
 * The order of business is what makes a re-run free and a resumed run cheap:
 *
 * 1. rows already in `extractions` are reused as they are;
 * 2. a batch the previous attempt left in flight (`batchIds`) is awaited;
 * 3. answers already in `ai_results` are replayed without a call;
 * 4. only then is anything dispatched — through `AiClient.structured` with a worker pool
 *    when somebody is waiting, or through the batch runner at half price when not.
 *
 * A chunk that fails is a warning, never a failure of the run: what could be read is
 * consolidated and the rest is reported (`chunk_failed`). The run itself only stops when the
 * budget guard says so (`blocked_budget`, resumable) or the caller cancels.
 */

export const DEFAULT_EXTRACT_CONCURRENCY = 6
/** Past this share of failed chunks the caller should fail the run rather than build on it. */
export const MAX_FAILED_CHUNK_RATIO = 0.5
/** One batch per this many requests: the results come back in one response, and a response
 *  that cannot be read is worse than one never submitted (the runner's own ceiling is 5,000). */
export const MAX_BATCH_SLICE = 2_000
export const MAX_FAILURE_MESSAGE_CHARS = 200

export interface ExtractProgress {
  readonly done: number
  readonly total: number
  /** Chunks answered from `extractions` or `ai_results` without a call. */
  readonly reused: number
  readonly batchId?: string
}

export interface ExtractStageDeps {
  readonly ai: Pick<AiClient, 'structured'>
  /** Absent means every chunk goes through `ai.structured`, whatever `userWaiting` says. */
  readonly runner?: Pick<BatchRunner, 'runJob' | 'poll' | 'list' | 'cancel'>
  /** `ai_results` — where a batch's answers land and where a resumed run reads them. */
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly extractions: Pick<ExtractionRepository, 'findByCustomIds' | 'put'>
  readonly prompt: PathgenPrompt
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly logger: PathgenLogger
  readonly concurrency?: number
  readonly onProgress?: (progress: ExtractProgress) => void
  /** Fires as soon as a batch is submitted, so its id is persisted before anything waits on it. */
  readonly onBatch?: (batchId: string) => void | Promise<void>
}

export interface ExtractStageInput {
  readonly runId: string
  /** In scope, not front matter, in plan order. */
  readonly chunks: readonly ExtractableChunk[]
  readonly sources: ReadonlyMap<string, ExtractSource>
  /** Somebody is watching a spinner: dispatch synchronously with a worker pool. */
  readonly userWaiting: boolean
  readonly allowOverBudget: boolean
  readonly budget?: BudgetGuard
  /** What one P1 call is expected to cost, for the guard. */
  readonly perCallEstimateUsd?: number
  /** Batches a previous attempt of this run submitted, from `generation_runs.progress`. */
  readonly batchIds?: readonly string[]
  readonly signal?: AbortSignalLike
}

export type ExtractStageStatus = 'completed' | 'cancelled' | 'blocked_budget'

export interface ExtractStageResult {
  readonly status: ExtractStageStatus
  /** Consolidation's input, in chunk order; failed and pending chunks are absent. */
  readonly extractions: ChunkExtraction[]
  /** Rows found before anything was dispatched. */
  readonly reused: number
  /** Answers replayed from `ai_results` without a call. */
  readonly cacheHits: number
  /** Chunks answered by a provider during this stage, synchronously or in a batch. */
  readonly extracted: number
  /** Provider calls made — the batch items count one each. */
  readonly calls: number
  readonly failed: Array<{ readonly chunkId: string; readonly error: string }>
  /** Chunks neither answered nor failed when the stage paused or was cancelled. */
  readonly pending: number
  readonly warnings: GenerationWarning[]
  readonly usage: StageUsage
  readonly batchIds: string[]
  readonly modelsUsed: string[]
}

/** Whether the caller should give up on the run rather than build on what was read. */
export function tooManyFailures(result: Pick<ExtractStageResult, 'failed' | 'extracted'>): boolean {
  const attempted = result.failed.length + result.extracted
  return result.failed.length > 0 && result.failed.length > MAX_FAILED_CHUNK_RATIO * attempted
}

type Settled = {
  readonly output: ExtractChunkOutput
  readonly row: Extraction
}

type Failure = 'cancelled' | 'budget' | 'failed'

function failureKind(error: unknown, signal: AbortSignalLike | undefined): Failure {
  if (signal?.aborted === true) return 'cancelled'
  if (isAiError(error)) {
    if (error.code === 'aborted') return 'cancelled'
    if (error.code === 'budget_exceeded') return 'budget'
  }
  return 'failed'
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_FAILURE_MESSAGE_CHARS
    ? `${text.slice(0, MAX_FAILURE_MESSAGE_CHARS)}…`
    : text
}

export async function extractChunks(
  deps: ExtractStageDeps,
  input: ExtractStageInput,
): Promise<ExtractStageResult> {
  const system = systemFor(deps.prompt.template)
  const binding = extractBinding(deps.prompt, { allowOverBudget: input.allowOverBudget })
  const budget = input.allowOverBudget ? undefined : input.budget
  const perCallUsd = input.perCallEstimateUsd ?? 0
  const total = input.chunks.length

  const settled = new Map<number, Settled>()
  const failed: ExtractStageResult['failed'] = []
  const warnings: GenerationWarning[] = []
  const batchIds: string[] = []
  const modelsUsed = new Set<string>()
  let usage: StageUsage = ZERO_USAGE
  let reused = 0
  let cacheHits = 0
  let extracted = 0
  let calls = 0
  let cancelled = false
  let paused = false
  let currentBatchId: string | undefined

  const stopped = (): boolean => cancelled || paused
  const aborted = (): boolean => input.signal?.aborted === true

  const report = (): void => {
    deps.onProgress?.({
      done: settled.size + failed.length,
      total,
      reused,
      ...(currentBatchId === undefined ? {} : { batchId: currentBatchId }),
    })
  }

  /** Best effort, and only for a batch still running: a finished one has nothing to cancel. */
  const cancelBatch = async (
    runner: NonNullable<ExtractStageDeps['runner']>,
    id: string,
    last: AiBatchRecord | undefined,
  ): Promise<void> => {
    if (last === undefined || isTerminalBatchStatus(last.status)) return
    try {
      await runner.cancel(id)
    } catch (error) {
      deps.logger.warn(`[pathgen] batch ${id} could not be cancelled: ${messageOf(error)}`)
    }
  }

  const pause = (reason: 'cap' | 'monthly', pending: number): void => {
    if (paused) return
    paused = true
    warnings.push(
      warning('budget_paused', {
        reason,
        pending,
        spent_usd: Math.round((budget?.spentUsd() ?? 0) * 100) / 100,
        cap_usd: budget?.capUsd ?? 0,
      }),
    )
  }

  const fail = (request: ExtractRequest, error: unknown): void => {
    const message = messageOf(error)
    failed.push({ chunkId: request.chunk.id, error: message })
    warnings.push(warning('chunk_failed', { chunk_id: request.chunk.id, error: message }))
    report()
  }

  const settle = async (
    index: number,
    request: ExtractRequest,
    output: ExtractChunkOutput,
    answer: { provider: string | null; model: string; usage: StageUsage },
    how: 'reused' | 'cache' | 'call',
    existing?: Extraction,
  ): Promise<void> => {
    const validated = postValidate(output, request.task.blockIds)
    const row =
      existing ??
      (await deps.extractions.put(
        toExtractionRow({
          runId: input.runId,
          chunk: request.chunk,
          customId: request.customId,
          prompt: deps.prompt,
          provider: answer.provider,
          model: answer.model,
          output: validated,
          usage: answer.usage,
        }),
      ))
    settled.set(index, { output: validated, row })
    if (answer.model !== '') modelsUsed.add(answer.model)
    if (how === 'reused') reused += 1
    else if (how === 'cache') cacheHits += 1
    else {
      extracted += 1
      calls += 1
      usage = addUsage(usage, answer.usage)
      budget?.add(answer.usage.usd)
    }
    report()
  }

  /** A completion that arrived as text: from `ai_results` or from the runner's own results. */
  const settleText = async (
    index: number,
    request: ExtractRequest,
    text: string,
    answer: { provider: string | null; model: string; usage: StageUsage },
    how: 'cache' | 'call',
  ): Promise<boolean> => {
    const outcome = validateExtraction(text)
    if (!outcome.ok) {
      deps.logger.warn(
        `[pathgen] the stored answer for ${request.customId} does not validate: ${outcome.issues.join('; ')}`,
      )
      return false
    }
    await settle(index, request, outcome.value, answer, how)
    return true
  }

  // --- 0. requests -----------------------------------------------------------------------
  const requests: ExtractRequest[] = input.chunks.map((chunk) => {
    const source = input.sources.get(chunk.sourceId)
    if (source === undefined) {
      throw new Error(
        `[pathgen] chunk ${chunk.id} belongs to source ${chunk.sourceId}, which was not given`,
      )
    }
    return buildExtractRequest(chunk, source, deps.prompt, {
      system,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  })
  for (const request of requests) {
    if (request.task.injectionSuspected) {
      warnings.push(warning('injection_suspected', { chunk_id: request.chunk.id }))
    }
  }
  const indexOf = new Map(requests.map((request, index) => [request.customId, index]))

  // --- 1. rows already stored ------------------------------------------------------------
  const rows = await deps.extractions.findByCustomIds(requests.map((request) => request.customId))
  for (const row of rows) {
    const index = indexOf.get(row.customId)
    if (index === undefined || settled.has(index)) continue
    const output = readExtractionRow(row)
    if (output === undefined) {
      deps.logger.warn(
        `[pathgen] the extraction row for ${row.customId} does not validate; re-extracting`,
      )
      continue
    }
    await settle(
      index,
      requests[index] as ExtractRequest,
      output,
      { provider: row.provider, model: row.model, usage: ZERO_USAGE },
      'reused',
      row,
    )
  }

  const pendingRequests = (): Array<[number, ExtractRequest]> =>
    requests.flatMap(
      (request, index): Array<[number, ExtractRequest]> =>
        settled.has(index) || failed.some((entry) => entry.chunkId === request.chunk.id)
          ? []
          : [[index, request]],
    )

  // --- 2. batches a previous attempt left in flight ---------------------------------------
  // Only worth awaiting when their answers can be read back afterwards.
  if (deps.runner !== undefined && deps.resultCache !== undefined && input.batchIds !== undefined) {
    for (const id of input.batchIds) {
      if (aborted()) break
      batchIds.push(id)
      currentBatchId = id
      const last = await waitForBatch(id, {
        runner: deps.runner,
        clock: deps.clock,
        timers: deps.timers,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onPoll: report,
      })
      if (aborted()) await cancelBatch(deps.runner, id, last)
    }
    currentBatchId = undefined
  }

  // --- 3. answers already in ai_results --------------------------------------------------
  if (deps.resultCache !== undefined) {
    for (const [index, request] of pendingRequests()) {
      const cached = await deps.resultCache.get(request.customId)
      if (cached === undefined) continue
      await settleText(
        index,
        request,
        cached.output,
        { provider: cached.provider, model: cached.model, usage: ZERO_USAGE },
        'cache',
      )
    }
  }

  // --- 4. dispatch -----------------------------------------------------------------------
  const dispatchSync = async (list: readonly [number, ExtractRequest][]): Promise<void> => {
    let dispatched = 0
    await runPool(
      list,
      deps.concurrency ?? DEFAULT_EXTRACT_CONCURRENCY,
      async ([index, request]) => {
        if (aborted()) {
          cancelled = true
          return
        }
        // One call at a time against the cap: the pre-flight quote already judged the whole
        // job, and a resumed run with a raised cap must be able to make progress.
        if (budget?.wouldExceed(perCallUsd) === true) {
          pause('cap', list.length - dispatched)
          return
        }
        dispatched += 1
        try {
          const result = await deps.ai.structured(binding)(request.structured)
          await settle(
            index,
            request,
            result.value,
            { provider: null, model: result.model, usage: usageOf(result.usage) },
            'call',
          )
        } catch (error) {
          const kind = failureKind(error, input.signal)
          if (kind === 'cancelled') cancelled = true
          else if (kind === 'budget') pause('monthly', list.length - dispatched + 1)
          else fail(request, error)
        }
      },
      stopped,
    )
  }

  const dispatchBatch = async (
    runner: NonNullable<ExtractStageDeps['runner']>,
    resultCache: NonNullable<ExtractStageDeps['resultCache']>,
    list: readonly [number, ExtractRequest][],
  ): Promise<void> => {
    for (let start = 0; start < list.length && !stopped(); start += MAX_BATCH_SLICE) {
      const slice = list.slice(start, start + MAX_BATCH_SLICE)
      if (budget?.wouldExceed(slice.length * perCallUsd) === true) {
        pause('cap', list.length - start)
        return
      }

      let outcome: RunJobOutcome
      try {
        outcome = await runner.runJob(
          binding,
          slice.map(([, request]) => request.batch),
          {
            batchable: true,
            userWaiting: false,
            head: 0,
            allowOverBudget: input.allowOverBudget,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        )
      } catch (error) {
        const kind = failureKind(error, input.signal)
        if (kind === 'cancelled') {
          cancelled = true
          return
        }
        if (kind === 'budget') {
          pause('monthly', list.length - start)
          return
        }
        deps.logger.error(
          '[pathgen] the batch could not be submitted; extracting synchronously',
          error,
        )
        await dispatchSync(slice)
        continue
      }

      const fallback: Array<[number, ExtractRequest]> = []
      const byId = new Map(
        slice.map(([index, request]) => [request.customId, [index, request] as const]),
      )

      // The runner answered some of it synchronously — all of it when the policy chose `sync`.
      for (const { customId, result } of outcome.results) {
        const entry = byId.get(customId)
        if (entry === undefined) continue
        const [index, request] = entry
        const ok = await settleText(
          index,
          request,
          result.text,
          { provider: null, model: result.model, usage: usageOf(result.usage) },
          'call',
        )
        if (!ok) fallback.push([index, request])
      }

      if (outcome.batch !== undefined) {
        const id = outcome.batch.id
        batchIds.push(id)
        currentBatchId = id
        await deps.onBatch?.(id)
        report()
        const final = await waitForBatch(
          id,
          {
            runner,
            clock: deps.clock,
            timers: deps.timers,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            onPoll: report,
          },
          outcome.batch,
        )
        currentBatchId = undefined
        if (aborted()) {
          await cancelBatch(runner, id, final)
          cancelled = true
          return
        }

        // Read back what the batch reconciled into ai_results; the rest goes synchronous.
        for (const [index, request] of slice) {
          if (settled.has(index) || fallback.some(([at]) => at === index)) continue
          const cached = await resultCache.get(request.customId)
          const ok =
            cached !== undefined &&
            (await settleText(
              index,
              request,
              cached.output,
              {
                provider: cached.provider,
                model: cached.model,
                usage: { ...ZERO_USAGE, usd: cached.costUsd },
              },
              'call',
            ))
          if (!ok) fallback.push([index, request])
        }
      }

      if (fallback.length > 0 && !stopped()) {
        fallback.sort((a, b) => a[0] - b[0])
        await dispatchSync(fallback)
      }
    }
  }

  const pending = pendingRequests()
  if (pending.length > 0 && !aborted()) {
    const batchable =
      !input.userWaiting && deps.runner !== undefined && deps.resultCache !== undefined
    if (batchable) {
      await dispatchBatch(
        deps.runner as NonNullable<ExtractStageDeps['runner']>,
        deps.resultCache as NonNullable<ExtractStageDeps['resultCache']>,
        pending,
      )
    } else {
      if (!input.userWaiting && deps.runner !== undefined) {
        deps.logger.warn('[pathgen] no result cache is wired, so the batch path is unavailable')
      }
      await dispatchSync(pending)
    }
  }
  if (aborted()) cancelled = true

  // --- 5. the result ---------------------------------------------------------------------
  const extractions: ChunkExtraction[] = []
  for (const [index, request] of requests.entries()) {
    const entry = settled.get(index)
    if (entry === undefined) continue
    extractions.push({ chunk: toExtractedChunk(request.chunk), output: entry.output })
  }

  return {
    status: cancelled ? 'cancelled' : paused ? 'blocked_budget' : 'completed',
    extractions,
    reused,
    cacheHits,
    extracted,
    calls,
    failed,
    pending: total - settled.size - failed.length,
    warnings,
    usage,
    batchIds,
    modelsUsed: [...modelsUsed].sort(),
  }
}
