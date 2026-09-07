import type { AiCall, Clock, NewEntity } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { AiError, isAiError } from './errors'
import type { InvokeOutcome } from './invoker'
import { SHIPPED_PRICING, ZERO_USAGE } from './pricing'
import { DEFAULT_PROFILES } from './profiles'
import { DEFAULT_ROLES } from './roles'
import type { AiBinding, RunDeps } from './run'
import { runOnce } from './run'
import {
  createCollectingBudgetSink,
  createFakeSecretReader,
  createFakeSpendReader,
  createManualAbort,
  createManualTimers,
  createRecordingRecorder,
  createScriptedInvoker,
  type InvokeScript,
} from './testing'
import type { TextGenerationRequest } from './text-generator'

/**
 * The acceptance criteria of sub-phase 7.1, exercised with **no AI SDK at all**: the
 * invoker is the seam, so routing, retry, fallback, the cost log and the budget are all
 * plain functions over injected fakes. `providers/sdk-invoker.test.ts` covers the other
 * side of that seam.
 */

const AT = new Date(2026, 8, 7, 12, 0, 0)
const clock: Clock = { now: () => AT }

const REQUEST: TextGenerationRequest = {
  prompt: 'contextualize this chunk',
  temperature: 0,
  idempotencyKey: 'contextualize:1:src-1:chunk-7',
}

const BINDING: AiBinding = { role: 'cheap', purpose: 'contextualize' }

/** `ai_calls.meta` is a `JsonObject` on the row; the tests read it as the shape run.ts writes. */
function metaOf(row: NewEntity<AiCall> | undefined): {
  attempt?: number
  target?: number
  code?: string
  statusCode?: number
  costUnknown?: boolean
} {
  return (row?.meta ?? {}) as Record<string, never>
}

function ok(overrides: Partial<Extract<InvokeOutcome, { kind: 'ok' }>> = {}): InvokeOutcome {
  return {
    kind: 'ok',
    text: 'a context sentence',
    modelId: 'gemini-3.7-flash',
    usage: {
      ...ZERO_USAGE,
      inputTokens: 4000,
      cachedInputTokens: 8000,
      outputTokens: 900,
      reasoningTokens: 300,
    },
    finishReason: 'stop',
    ...overrides,
  }
}

function failure(
  error: AiError,
  usage?: InvokeOutcome extends { usage?: infer U } ? U : never,
): InvokeOutcome {
  return { kind: 'error', error, ...(usage === undefined ? {} : { usage }) }
}

interface Harness {
  deps: RunDeps
  rows: Array<NewEntity<AiCall>>
  calls: ReturnType<typeof createScriptedInvoker>['calls']
  timers: ReturnType<typeof createManualTimers>
  events: ReturnType<typeof createCollectingBudgetSink>['events']
  spend: ReturnType<typeof createFakeSpendReader>
}

function build(
  script: readonly InvokeScript[],
  overrides: Partial<RunDeps> & { spent?: number; cap?: number } = {},
): Harness {
  const { invoker, calls } = createScriptedInvoker(script)
  const recorder = createRecordingRecorder()
  const timers = createManualTimers()
  const sink = createCollectingBudgetSink()
  const spend = createFakeSpendReader(overrides.spent ?? 0)
  const { spent: _spent, cap, ...rest } = overrides

  const deps: RunDeps = {
    invoker,
    registry: async () => ({ profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }),
    pricing: SHIPPED_PRICING,
    getSecret: createFakeSecretReader({ anthropic: 'sk-ant-key', google: 'AIza-key' }).getSecret,
    recordCall: recorder.record,
    spentSinceUsd: spend.spentSinceUsd,
    monthlyBudgetUsd: async () => cap ?? 0,
    hardBlockEnabled: async () => true,
    clock,
    timers,
    // Pinned, so the backoff assertion is exact rather than a range.
    random: () => 0.5,
    onBudgetEvent: sink.emit,
    logger: { warn: () => {}, error: () => {} },
    ...rest,
  }
  return { deps, rows: recorder.rows, calls, timers, events: sink.events, spend }
}

describe('ACCEPTANCE: routing and cost', () => {
  it('routes role "cheap" to Gemini Flash and logs one row at the right cost', async () => {
    const h = build([ok()])
    const result = await runOnce(h.deps, BINDING, REQUEST)

    expect(h.calls[0]?.target.profile.id).toBe('google')
    expect(h.calls[0]?.target.modelId).toBe('gemini-3.7-flash')

    expect(h.rows).toHaveLength(1)
    const row = h.rows[0]
    expect(row?.provider).toBe('google')
    expect(row?.model).toBe('gemini-3.7-flash')
    expect(row?.role).toBe('cheap')
    expect(row?.purpose).toBe('contextualize')
    expect(row?.status).toBe('ok')
    expect(row?.costUsd).toBe(0.006975)
    expect(row?.customId).toBe('contextualize:1:src-1:chunk-7')
    expect(row?.temperature).toBe(0)
    expect(result.usage?.usd).toBe(0.006975)
    expect(result.text).toBe('a context sentence')
  })
})

describe('ACCEPTANCE: fallback and logging', () => {
  it('falls back on a 429 and logs both attempts', async () => {
    const h = build([
      failure(new AiError('rate_limited', 'quota', { statusCode: 429 })),
      ok({
        modelId: 'claude-haiku-4-5',
        usage: { ...ZERO_USAGE, inputTokens: 1204, outputTokens: 318 },
      }),
    ])
    const result = await runOnce(h.deps, BINDING, REQUEST)

    // Exactly two, with no test-only configuration: `classify` returns 'next-target' for a
    // 429 at every attempt, so the primary is never asked twice.
    expect(h.rows).toHaveLength(2)

    expect(h.rows[0]).toMatchObject({
      provider: 'google',
      model: 'gemini-3.7-flash',
      status: 'error',
      costUsd: 0,
    })
    expect(h.rows[0]?.meta).toMatchObject({
      attempt: 1,
      target: 0,
      code: 'rate_limited',
      statusCode: 429,
    })

    expect(h.rows[1]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      status: 'ok',
      costUsd: 0.002794,
    })
    expect(h.rows[1]?.meta).toMatchObject({ attempt: 1, target: 1 })

    // One logical unit of work: both rows carry the caller's idempotency key.
    expect(h.rows.map((r) => r.customId)).toEqual([REQUEST.idempotencyKey, REQUEST.idempotencyKey])
    expect(h.calls.map((c) => c.target.profile.id)).toEqual(['google', 'anthropic'])
    expect(result.text).toBe('a context sentence')
  })
})

describe('retry, fallback and abort', () => {
  it('retries a 500 once on the same target, then falls back', async () => {
    const h = build([
      failure(new AiError('server_error', 'overloaded', { statusCode: 503 })),
      failure(new AiError('server_error', 'overloaded', { statusCode: 503 })),
      ok({ modelId: 'claude-haiku-4-5' }),
    ])
    await runOnce(h.deps, BINDING, REQUEST)

    expect(h.rows).toHaveLength(3)
    expect(h.rows.map((r) => metaOf(r).attempt)).toEqual([1, 2, 1])
    expect(h.rows.map((r) => metaOf(r).target)).toEqual([0, 0, 1])
    // Asserted as what was requested, not as elapsed time: random() is pinned to 0.5.
    expect(h.timers.slept).toEqual([250])
  })

  it('logs the tokens a failed call already burned', async () => {
    const h = build([
      failure(new AiError('server_error', 'died mid-stream', { statusCode: 500 }), {
        ...ZERO_USAGE,
        inputTokens: 4000,
      }),
      failure(new AiError('rate_limited', 'quota', { statusCode: 429 })),
      ok({ modelId: 'claude-haiku-4-5' }),
    ])
    await runOnce(h.deps, BINDING, REQUEST)

    // This is the whole reason rows are per attempt rather than per call.
    expect(h.rows[0]?.inputTokens).toBe(4000)
    expect(h.rows[0]?.costUsd).toBe(0.003)
    expect(metaOf(h.rows[0]).costUnknown).toBeUndefined()
  })

  it('marks an attempt that reported no usage as an unknown cost, not a free one', async () => {
    const h = build([
      failure(new AiError('network', 'socket hang up')),
      failure(new AiError('network', 'socket hang up')),
      ok({ modelId: 'claude-haiku-4-5' }),
    ])
    await runOnce(h.deps, BINDING, REQUEST)
    expect(h.rows[0]?.costUsd).toBe(0)
    expect(metaOf(h.rows[0]).costUnknown).toBe(true)
  })

  it('does not retry a 401, but does try the next provider', async () => {
    const h = build([
      failure(new AiError('auth', 'invalid key', { statusCode: 401 })),
      ok({ modelId: 'claude-haiku-4-5' }),
    ])
    await runOnce(h.deps, BINDING, REQUEST)
    expect(h.rows).toHaveLength(2)
    expect(h.calls).toHaveLength(2)
  })

  it('reports every target failing, keeping the last cause', async () => {
    const h = build([
      failure(new AiError('rate_limited', 'quota', { statusCode: 429 })),
      failure(new AiError('bad_request', 'context too long', { statusCode: 413 })),
    ])
    const thrown = await runOnce(h.deps, BINDING, REQUEST).then(
      () => undefined,
      (error: unknown) => error as AiError,
    )
    expect(thrown?.code).toBe('all_targets_failed')
    expect(thrown?.message).toContain('google/gemini-3.7-flash')
    expect(thrown?.message).toContain('anthropic/claude-haiku-4-5')
    expect(isAiError(thrown?.cause) && thrown.cause.code).toBe('bad_request')
    expect(h.rows).toHaveLength(2)
  })

  it('gives up when the caller cancels, without dispatching', async () => {
    const manual = createManualAbort()
    manual.abort()
    const h = build([ok()])
    await expect(
      runOnce(h.deps, BINDING, { ...REQUEST, signal: manual.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(h.calls).toHaveLength(0)
    expect(h.rows).toHaveLength(0)
  })
})

describe('nothing is logged for an attempt that never dispatched', () => {
  it('skips a provider with no stored key and uses the next', async () => {
    const h = build([ok({ modelId: 'claude-haiku-4-5' })], {
      getSecret: createFakeSecretReader({ anthropic: 'sk-ant-key' }).getSecret,
    })
    await runOnce(h.deps, BINDING, REQUEST)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.target.profile.id).toBe('anthropic')
    expect(h.rows).toHaveLength(1)
  })

  it('records nothing at all when no key is stored anywhere', async () => {
    const h = build([], { getSecret: createFakeSecretReader({}).getSecret })
    await expect(runOnce(h.deps, BINDING, REQUEST)).rejects.toMatchObject({
      code: 'all_targets_failed',
    })
    expect(h.calls).toHaveLength(0)
    expect(h.rows).toHaveLength(0)
  })

  it('records nothing for an unroutable role', async () => {
    const h = build([])
    await expect(
      runOnce(h.deps, { role: 'vision', purpose: 'diagram' }, REQUEST),
    ).rejects.toMatchObject({ code: 'not_configured' })
    expect(h.rows).toHaveLength(0)
  })
})

describe('the monthly budget', () => {
  it('blocks before any dispatch once the cap is reached', async () => {
    const h = build([ok()], { cap: 5, spent: 5 })
    await expect(runOnce(h.deps, BINDING, REQUEST)).rejects.toMatchObject({
      code: 'budget_exceeded',
    })
    expect(h.calls).toHaveLength(0)
    expect(h.rows).toHaveLength(0)
    expect(h.events).toEqual([
      expect.objectContaining({ kind: 'blocked', period: '2026-09', capUsd: 5 }),
    ])
  })

  it('proceeds a cent below the cap', async () => {
    const h = build([ok()], { cap: 5, spent: 4.99 })
    await expect(runOnce(h.deps, BINDING, REQUEST)).resolves.toBeDefined()
  })

  it('reads the month spend once per run, not once per attempt', async () => {
    const h = build(
      [
        failure(new AiError('rate_limited', 'quota', { statusCode: 429 })),
        ok({ modelId: 'claude-haiku-4-5' }),
      ],
      { cap: 30 },
    )
    await runOnce(h.deps, BINDING, REQUEST)
    expect(h.spend.reads).toHaveLength(1)
    // The window is the local calendar month, so it lines up with a provider invoice.
    expect(h.spend.reads[0]).toEqual(new Date(2026, 8, 1))
  })

  it('treats a cap of zero as no cap', async () => {
    const h = build([ok()], { cap: 0, spent: 1000 })
    await expect(runOnce(h.deps, BINDING, REQUEST)).resolves.toBeDefined()
    expect(h.events).toEqual([])
  })

  it('lets a user who turned blocking off spend past the cap, having warned once', async () => {
    const h = build([ok()], { cap: 5, spent: 6, hardBlockEnabled: async () => false })
    await expect(runOnce(h.deps, BINDING, REQUEST)).resolves.toBeDefined()
    expect(h.events.filter((e) => e.kind === 'blocked')).toHaveLength(1)
  })

  it('honours a per-call override even with blocking on', async () => {
    const h = build([ok()], { cap: 5, spent: 6 })
    await expect(
      runOnce(h.deps, { ...BINDING, allowOverBudget: true }, REQUEST),
    ).resolves.toBeDefined()
    expect(h.calls).toHaveLength(1)
  })

  it('fires each threshold once, on the crossing', async () => {
    // cap 10, already at 7.5: a call costing ~0.007 does not reach 8.
    const near = build([ok()], { cap: 10, spent: 7.999 })
    await runOnce(near.deps, BINDING, REQUEST)
    expect(near.events.map((e) => e.threshold)).toEqual([80])

    // Past it already: silent. This is also the restart case, because `spentBefore` is
    // read back from the real rows rather than from a latch we kept in memory.
    const past = build([ok()], { cap: 10, spent: 8.5 })
    await runOnce(past.deps, BINDING, REQUEST)
    expect(past.events).toEqual([])

    const exhausting = build([ok()], { cap: 10, spent: 9.999 })
    await runOnce(exhausting.deps, BINDING, REQUEST)
    expect(exhausting.events.map((e) => e.threshold)).toEqual([100])
  })
})

describe('robustness', () => {
  it('does not fail a working call when the cost log cannot be written', async () => {
    const recorder = createRecordingRecorder({ failWith: new Error('SQLITE_FULL') })
    const h = build([ok()], { recordCall: recorder.record })
    await expect(runOnce(h.deps, BINDING, REQUEST)).resolves.toMatchObject({
      text: 'a context sentence',
    })
  })

  it('reads the key once per attempt, so a rotated key needs no invalidation', async () => {
    const reads: string[] = []
    const h = build(
      [
        failure(new AiError('server_error', 'boom', { statusCode: 500 })),
        failure(new AiError('server_error', 'boom', { statusCode: 500 })),
        ok({ modelId: 'claude-haiku-4-5' }),
      ],
      {
        getSecret: async (name) => {
          reads.push(name)
          return name === 'google' ? 'AIza-key' : 'sk-ant-key'
        },
      },
    )
    await runOnce(h.deps, BINDING, REQUEST)
    expect(reads).toEqual(['google', 'anthropic'])
  })
})
