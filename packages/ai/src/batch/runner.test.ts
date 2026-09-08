import type { AiCall, NewEntity } from '@retenia/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { SHIPPED_PRICING } from '../pricing'
import { DEFAULT_PROFILES } from '../profiles'
import { DEFAULT_ROLES } from '../roles'
import type { AiBinding } from '../run'
import {
  batchFailure,
  batchSuccess,
  createMemoryBatchStore,
  createMemoryResultCache,
  createScriptedBatchProvider,
  createScriptedInvoker,
  type ScriptedBatchProvider,
} from '../testing'
import type { TextGenerationRequest, TextGenerationResult } from '../text-generator'
import type { BatchPoll, BatchProvider, BatchRequest } from './provider'
import {
  type BatchRunner,
  createBatchRunner,
  MAX_BATCH_REQUESTS,
  MAX_BATCH_RETRIES,
} from './runner'
import { createSequentialBatchProvider } from './sequential'

/**
 * The batch runner, driven a poll at a time.
 *
 * `poll()` is public precisely so this suite can be a state machine test rather than a race
 * against a timer: the scheduler is one line over `Timers.setTimeout`, and the double below
 * *records* rather than fires, so nothing here depends on wall-clock time (which
 * `guards.test.ts` forbids anyway).
 */

const binding: AiBinding = {
  role: 'smart',
  purpose: 'expand_lesson',
  stage: 'P3_write_lesson',
  promptVersion: '3',
  schemaVersion: '1',
}

function requests(count: number): BatchRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    customId: `P3-lesson-${index}`,
    request: { prompt: `Write lesson ${index}`, temperature: 0.6 } satisfies TextGenerationRequest,
  }))
}

/** `setTimeout` that remembers rather than fires: the test decides when a poll happens. */
function recordingTimers() {
  const scheduled: Array<{ fn: () => void; ms: number }> = []
  return {
    scheduled,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        scheduled.push({ fn, ms })
      },
      sleep: async () => {},
    },
  }
}

interface Harness {
  runner: BatchRunner
  store: ReturnType<typeof createMemoryBatchStore>
  cache: ReturnType<typeof createMemoryResultCache>
  calls: Array<NewEntity<AiCall>>
  scheduled: Array<{ fn: () => void; ms: number }>
  syncCalls: TextGenerationRequest[]
}

interface HarnessOptions {
  provider?: BatchProvider
  adapters?: Parameters<typeof createBatchRunner>[0]['adapters']
  fallback?: BatchProvider
  store?: ReturnType<typeof createMemoryBatchStore>
  cache?: ReturnType<typeof createMemoryResultCache>
  monthlyBudgetUsd?: number
  spentUsd?: number
  secrets?: boolean
}

function harness(options: HarnessOptions = {}): Harness {
  const store = options.store ?? createMemoryBatchStore()
  const cache = options.cache ?? createMemoryResultCache()
  const calls: Array<NewEntity<AiCall>> = []
  const syncCalls: TextGenerationRequest[] = []
  const { scheduled, timers } = recordingTimers()

  const runner = createBatchRunner({
    adapters:
      options.adapters ?? (options.provider === undefined ? {} : { anthropic: options.provider }),
    fallback: options.fallback ?? createSequentialBatchProvider(createScriptedInvoker([]).invoker),
    registry: async () => ({ profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }),
    pricing: SHIPPED_PRICING,
    getSecret: async (name) =>
      options.secrets === false ? undefined : name === 'anthropic' ? 'sk-test' : undefined,
    recordCall: async (call) => {
      calls.push(call)
    },
    store,
    sync: async (_binding, request): Promise<TextGenerationResult> => {
      syncCalls.push(request)
      return { text: `sync:${request.prompt}`, model: 'claude-sonnet-5', usage: { usd: 0.01 } }
    },
    resultCache: cache,
    spentSinceUsd: async () => options.spentUsd ?? 0,
    monthlyBudgetUsd: async () => options.monthlyBudgetUsd ?? 0,
    hardBlockEnabled: async () => true,
    clock: { now: () => new Date('2026-09-08T12:00:00Z') },
    timers,
    random: () => 0.5,
    logger: { warn: () => {}, error: () => {} },
  })

  return { runner, store, cache, calls, scheduled, syncCalls }
}

/** `in_progress` a few times, then the answers — what a real batch does. */
function delayedCompletion(items: BatchRequest[], inProgressPolls = 2): ScriptedBatchProvider {
  const script: BatchPoll[] = Array.from({ length: inProgressPolls }, () => ({
    status: 'in_progress' as const,
    results: [],
    processing: items.length,
  }))
  script.push({
    status: 'completed',
    results: items.map(({ customId }) => batchSuccess(customId, `{"lesson":"${customId}"}`)),
  })
  return createScriptedBatchProvider(script)
}

describe('a batch that completes', () => {
  let items: BatchRequest[]
  let scripted: ScriptedBatchProvider
  let test: Harness

  beforeEach(() => {
    items = requests(40)
    scripted = delayedCompletion(items)
    test = harness({ provider: scripted.provider })
  })

  it('lands every answer in ai_results and writes one cost row per request', async () => {
    const submitted = await test.runner.submitBatch(binding, items)
    expect(submitted.status).toBe('submitted')
    expect(submitted.requestCount).toBe(40)
    expect(submitted.providerBatchId).not.toBeNull()

    // Two polls that say "still working", then the one that carries the results.
    await test.runner.poll(submitted.id)
    await test.runner.poll(submitted.id)
    const done = await test.runner.poll(submitted.id)

    expect(done?.status).toBe('completed')
    expect(done?.succeededCount).toBe(40)
    expect(done?.failedCount).toBe(0)

    // The acceptance criterion, both halves of it.
    expect(test.cache.entries.size).toBe(40)
    expect(test.cache.entries.get('P3-lesson-7')?.output).toBe('{"lesson":"P3-lesson-7"}')
    expect(test.calls).toHaveLength(40)
    expect(new Set(test.calls.map((call) => call.customId)).size).toBe(40)
  })

  it('stamps every cost row with the batch, the binding and the -50 %', async () => {
    const submitted = await test.runner.submitBatch(binding, items)
    await test.runner.poll(submitted.id)
    await test.runner.poll(submitted.id)
    await test.runner.poll(submitted.id)

    const [row] = test.calls
    expect(row?.batchId).toBe(submitted.id)
    expect(row?.purpose).toBe('expand_lesson')
    expect(row?.role).toBe('smart')
    expect(row?.promptVersion).toBe('3')
    expect(row?.schemaVersion).toBe('1')
    // A batched request has no round trip of its own to time; a synthetic figure would
    // pollute the latency statistics of the calls that do.
    expect(row?.latencyMs).toBeNull()
    expect(row?.meta).toMatchObject({ batch: true })

    // Half of what the same usage costs synchronously — the whole reason to wait.
    const usd = row?.costUsd ?? 0
    expect(usd).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6 / 2, 10)
  })

  it('records the batch cost on the row itself, against its own quote', async () => {
    const submitted = await test.runner.submitBatch(binding, items)
    expect(submitted.costEstimateUsd).toBeGreaterThan(0)

    await test.runner.poll(submitted.id)
    await test.runner.poll(submitted.id)
    const done = await test.runner.poll(submitted.id)

    expect(done?.costUsd).toBeCloseTo(40 * ((1000 * 2 + 500 * 10) / 1e6 / 2), 8)
  })

  it('backs off between polls and schedules the next one on the row', async () => {
    const submitted = await test.runner.submitBatch(binding, items)
    expect(submitted.nextPollAt).not.toBeNull()

    const first = await test.runner.poll(submitted.id)
    const second = await test.runner.poll(submitted.id)

    expect(first?.attempts).toBe(1)
    expect(second?.attempts).toBe(2)
    // 5 s, then 10 s: the delay grows with the attempt count on the row, so a restart
    // resumes the ladder rather than starting it again.
    expect(test.scheduled.map((entry) => entry.ms)).toEqual([5_000, 5_000, 10_000])
  })
})

describe('reconciliation idempotency', () => {
  it('writes one cost row per request even when the same results arrive twice', async () => {
    const items = requests(6)
    const results = items.map(({ customId }) => batchSuccess(customId, `answer ${customId}`))
    // A provider that reports the finished items *while still running* — Anthropic's partial
    // progress — and then reports all of them again when it ends.
    const scripted = createScriptedBatchProvider([
      { status: 'in_progress', results, processing: 0 },
      { status: 'completed', results },
    ])
    const test = harness({ provider: scripted.provider })

    const submitted = await test.runner.submitBatch(binding, items)
    await test.runner.poll(submitted.id)
    const done = await test.runner.poll(submitted.id)

    expect(test.calls).toHaveLength(6)
    expect(test.cache.entries.size).toBe(6)
    expect(done?.succeededCount).toBe(6)
  })

  it('skips an id another run already answered, rather than charging for it twice', async () => {
    // The durable half of the guard: this process has no memory of the first reconciliation,
    // exactly as it would not after a crash and a restart.
    const items = requests(4)
    const cache = createMemoryResultCache()
    await cache.put({
      customId: 'P3-lesson-0',
      output: 'from an earlier run',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      costUsd: 0.02,
      stage: 'P3_write_lesson',
      promptVersion: '3',
      schemaVersion: '1',
    })

    const scripted = createScriptedBatchProvider([
      {
        status: 'completed',
        // Only the three that were actually asked for: the provider never saw lesson-0.
        results: items.slice(1).map(({ customId }) => batchSuccess(customId, `answer ${customId}`)),
      },
    ])
    const test = harness({ provider: scripted.provider, cache })

    // `submitBatch` already declines to ask for it, so the batch that went out is three
    // requests — §7's "if a result exists, it is not repeated", before a token is spent.
    const submitted = await test.runner.submitBatch(binding, items)
    expect(scripted.submitted[0]?.requests).toHaveLength(3)
    expect(submitted.requestCount).toBe(4)

    const done = await test.runner.poll(submitted.id)

    expect(test.calls.map((call) => call.customId)).not.toContain('P3-lesson-0')
    expect(cache.entries.get('P3-lesson-0')?.output).toBe('from an earlier run')
    expect(done?.succeededCount).toBe(4)
  })

  it('completes without a provider call when everything is already answered', async () => {
    const items = requests(5)
    const cache = createMemoryResultCache()
    for (const { customId } of items) {
      await cache.put({
        customId,
        output: 'cached',
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        costUsd: 0,
        stage: 'P3_write_lesson',
        promptVersion: '3',
        schemaVersion: '1',
      })
    }
    const scripted = createScriptedBatchProvider([])
    const test = harness({ provider: scripted.provider, cache })

    const submitted = await test.runner.submitBatch(binding, items)

    expect(submitted.status).toBe('completed')
    expect(submitted.succeededCount).toBe(5)
    expect(scripted.submitted).toHaveLength(0)
    expect(test.calls).toHaveLength(0)
  })
})

describe('partial failure', () => {
  it('resubmits only the ids that failed, and at most twice', async () => {
    const items = requests(5)
    const ok = items.slice(0, 3).map(({ customId }) => batchSuccess(customId, 'fine'))
    const bad = items.slice(3).map(({ customId }) => batchFailure(customId))

    const scripted = createScriptedBatchProvider([
      { status: 'completed', results: [...ok, ...bad] },
      // First retry: the same two fail again.
      { status: 'completed', results: bad },
      // Second retry: still failing. The budget is spent and the batch settles.
      { status: 'completed', results: bad },
    ])
    const test = harness({ provider: scripted.provider })

    const submitted = await test.runner.submitBatch(binding, items)
    const afterFirst = await test.runner.poll(submitted.id)
    expect(afterFirst?.status).toBe('in_progress')
    expect(scripted.submitted).toHaveLength(2)
    // Only the failures went back out.
    expect(scripted.submitted[1]?.requests.map((entry) => entry.customId)).toEqual([
      'P3-lesson-3',
      'P3-lesson-4',
    ])

    await test.runner.poll(submitted.id)
    expect(scripted.submitted).toHaveLength(1 + MAX_BATCH_RETRIES)

    const settled = await test.runner.poll(submitted.id)
    expect(settled?.status).toBe('completed')
    expect(settled?.succeededCount).toBe(3)
    expect(settled?.failedCount).toBe(2)
    expect(settled?.error).toContain('failed')

    // Three succeeded answers, and one error row per failed id — not one per attempt.
    expect(test.cache.entries.size).toBe(3)
    const errors = test.calls.filter((call) => call.status === 'error')
    expect(errors.map((call) => call.customId).sort()).toEqual(['P3-lesson-3', 'P3-lesson-4'])
  })
})

describe('surviving a restart', () => {
  it('resumes polling a batch the previous run left in flight', async () => {
    const items = requests(8)
    const store = createMemoryBatchStore()
    const cache = createMemoryResultCache()

    // The first process: submits, polls once, and is killed.
    const first = harness({
      provider: createScriptedBatchProvider([{ status: 'in_progress', results: [], processing: 8 }])
        .provider,
      store,
      cache,
    })
    const submitted = await first.runner.submitBatch(binding, items)
    await first.runner.poll(submitted.id)
    first.runner.stop()

    // A new process over the same store, with no memory of anything.
    const scripted = createScriptedBatchProvider([
      {
        status: 'completed',
        results: items.map(({ customId }) => batchSuccess(customId, `answer ${customId}`)),
      },
    ])
    const second = harness({ provider: scripted.provider, store, cache })

    const resumed = await second.runner.resume()
    expect(resumed).toHaveLength(1)
    expect(resumed[0]?.id).toBe(submitted.id)

    const done = await second.runner.poll(submitted.id)
    expect(done?.status).toBe('completed')
    expect(cache.entries.size).toBe(8)
    expect(second.calls).toHaveLength(8)
  })

  it('retires a batch the app died in the middle of submitting', async () => {
    const store = createMemoryBatchStore()
    // The window the `submitting` status exists for: a row with no provider id, so there is
    // nothing to poll and no way to know whether the provider took the work.
    await store.create({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      role: 'smart',
      purpose: 'expand_lesson',
      stage: 'P3_write_lesson',
      status: 'submitting',
      requestCount: 12,
      costEstimateUsd: 1.1,
      promptVersion: '3',
      schemaVersion: '1',
      nextPollAt: null,
    })

    const test = harness({ store })
    const [resumed] = await test.runner.resume()

    expect(resumed?.status).toBe('failed')
    expect(resumed?.error).toContain('never confirmed')
  })
})

describe('cancelling', () => {
  it('tells the provider and moves the row, even if the provider will not', async () => {
    const items = requests(10)
    const scripted = createScriptedBatchProvider([
      { status: 'in_progress', results: [], processing: 10 },
    ])
    const test = harness({ provider: scripted.provider })

    const submitted = await test.runner.submitBatch(binding, items)
    await test.runner.poll(submitted.id)
    const cancelled = await test.runner.cancel(submitted.id)

    expect(scripted.cancelled).toEqual([submitted.providerBatchId])
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.completedAt).not.toBeNull()

    // A terminal batch is not polled again — the script would throw if it were.
    expect(await test.runner.poll(submitted.id)).toMatchObject({ status: 'cancelled' })
  })
})

describe('the sequential fallback', () => {
  it('runs a batch on a provider with no Batch API, at full price', async () => {
    const items = requests(3)
    const { invoker } = createScriptedInvoker(
      items.map(({ customId }) => ({
        kind: 'ok' as const,
        text: `answer ${customId}`,
        modelId: 'claude-sonnet-5',
        finishReason: 'stop' as const,
        usage: {
          inputTokens: 1000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 500,
          reasoningTokens: 0,
        },
      })),
    )

    // No adapter for `anthropic`, so the runner reaches for the fallback — the lookup miss
    // *is* the mechanism.
    const test = harness({ adapters: {}, fallback: createSequentialBatchProvider(invoker) })

    const submitted = await test.runner.submitBatch(binding, items)
    expect(submitted.status).toBe('submitted')

    // The detached run has to reach the end of its microtasks before the first poll sees it.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const done = await test.runner.poll(submitted.id)
    expect(done?.status).toBe('completed')
    expect(test.cache.entries.size).toBe(3)
    // Full price: `meta.batch` is false and the cost is twice the discounted figure.
    expect(test.calls[0]?.meta).toMatchObject({ batch: false })
    expect(test.calls[0]?.costUsd).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 10)
  })
})

describe('runJob', () => {
  it('answers the first two synchronously and batches the rest', async () => {
    const items = requests(40)
    const scripted = createScriptedBatchProvider([])
    const test = harness({ provider: scripted.provider })

    const outcome = await test.runner.runJob(binding, items, { batchable: true })

    expect(outcome.dispatch).toBe('batch')
    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[0]?.customId).toBe('P3-lesson-0')
    expect(outcome.batch?.requestCount).toBe(38)
    expect(scripted.submitted[0]?.requests).toHaveLength(38)

    // The head carries its own `custom_id` as the idempotency key, so it lands in the same
    // answer store the batch reconciles into and a resumed run finds all forty.
    expect(test.syncCalls.map((request) => request.idempotencyKey)).toEqual([
      'P3-lesson-0',
      'P3-lesson-1',
    ])
  })

  it('runs everything synchronously while somebody is waiting', async () => {
    const items = requests(40)
    const scripted = createScriptedBatchProvider([])
    const test = harness({ provider: scripted.provider })

    const outcome = await test.runner.runJob(binding, items, {
      batchable: true,
      userWaiting: true,
    })

    expect(outcome.dispatch).toBe('sync')
    expect(outcome.results).toHaveLength(40)
    expect(outcome.batch).toBeUndefined()
    expect(scripted.submitted).toHaveLength(0)
  })
})

describe('the budget gate', () => {
  it('refuses to submit a batch that would blow the monthly cap', async () => {
    const items = requests(40)
    const scripted = createScriptedBatchProvider([])
    const test = harness({
      provider: scripted.provider,
      monthlyBudgetUsd: 10,
      spentUsd: 9.99,
    })

    // The one moment refusing is still worth anything: after submission the money is spent
    // whatever the app does next.
    await expect(test.runner.submitBatch(binding, items)).rejects.toThrow(/monthly AI budget/)
    expect(scripted.submitted).toHaveLength(0)
    expect(test.store.rows).toHaveLength(0)
  })

  it('submits when the quote fits under the cap', async () => {
    const items = requests(5)
    const scripted = createScriptedBatchProvider([])
    const test = harness({ provider: scripted.provider, monthlyBudgetUsd: 50, spentUsd: 1 })

    const submitted = await test.runner.submitBatch(binding, items)
    expect(submitted.status).toBe('submitted')
  })
})

describe('a target that cannot be reached', () => {
  it('fails the batch rather than submitting into the void', async () => {
    const test = harness({ secrets: false })
    await expect(test.runner.submitBatch(binding, requests(5))).rejects.toThrow(/no API key/)
  })
})

describe('guards on the way in and on the way round', () => {
  it('refuses a batch larger than one response can carry back', async () => {
    // The provider allows 100,000; the results of a batch come back to the main process in
    // one response, so a run that cannot be read is worse than one never submitted.
    const scripted = createScriptedBatchProvider([])
    const test = harness({ provider: scripted.provider })

    await expect(
      test.runner.submitBatch(binding, requests(MAX_BATCH_REQUESTS + 1)),
    ).rejects.toThrow(/ceiling/)
    expect(test.store.rows).toHaveLength(0)
    expect(scripted.submitted).toHaveLength(0)
  })

  it('shares one poll between overlapping callers, so a result is never recorded twice', async () => {
    // The reconciliation guard is a read-then-write against `ai_results`. Two concurrent
    // polls would both see "not there yet" and both write an `ai_calls` row for one charge —
    // and the month's total is the one number the budget depends on. `poll` is public and
    // `resume()` can race a pending timer, so the overlap is reachable.
    const items = requests(6)
    const scripted = createScriptedBatchProvider([
      {
        status: 'completed',
        results: items.map(({ customId }) => batchSuccess(customId, `answer ${customId}`)),
      },
    ])
    const test = harness({ provider: scripted.provider })

    const submitted = await test.runner.submitBatch(binding, items)
    const [first, second] = await Promise.all([
      test.runner.poll(submitted.id),
      test.runner.poll(submitted.id),
    ])

    // One provider round trip, one set of rows, and both callers got the same answer.
    expect(scripted.polls).toBe(1)
    expect(test.calls).toHaveLength(6)
    expect(test.cache.entries.size).toBe(6)
    expect(first?.status).toBe('completed')
    expect(second).toEqual(first)
  })
})
