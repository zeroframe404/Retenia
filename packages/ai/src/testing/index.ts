import type { AbortSignalLike, AiCall, NewEntity, SecretName } from '@retenia/core'
import type { AiBudgetEvent } from '../budget'
import type { InvokeOutcome, InvokeTarget, ProviderInvoker } from '../invoker'
import type { SecretReader, Timers } from '../ports'
import type { ModelPricing, PricingTable, Rates } from '../pricing'
import type { TextGenerationRequest } from '../text-generator'

/**
 * Hand-written fakes for everything `createAiClient` injects.
 *
 * They live in the package (behind the `./testing` entry point) rather than in one test
 * file because `apps/desktop` needs them too, and because a fake that is exported is a
 * fake somebody maintains.
 */

export type InvokeScript =
  | InvokeOutcome
  | ((
      target: InvokeTarget,
      request: TextGenerationRequest,
    ) => InvokeOutcome | Promise<InvokeOutcome>)

export interface ScriptedInvoker {
  readonly invoker: ProviderInvoker
  readonly calls: Array<{ target: InvokeTarget; request: TextGenerationRequest }>
}

/**
 * Answers the given outcomes in order.
 *
 * Running off the end **throws** rather than repeating the last entry: a test that expects
 * two attempts and gets three should fail saying exactly that, not hang or silently pass
 * because the extra call happened to succeed.
 */
export function createScriptedInvoker(script: readonly InvokeScript[]): ScriptedInvoker {
  const calls: Array<{ target: InvokeTarget; request: TextGenerationRequest }> = []

  const invoker: ProviderInvoker = async (target, request) => {
    const index = calls.length
    calls.push({ target, request })
    const step = script[index]
    if (step === undefined) {
      throw new Error(
        `createScriptedInvoker: call #${index + 1} (${target.profile.id}/${target.modelId}) ` +
          `has no scripted outcome; the script has ${script.length}`,
      )
    }
    return typeof step === 'function' ? step(target, request) : step
  }

  return { invoker, calls }
}

export interface ManualTimers extends Timers {
  /** Every `sleep(ms)` in order — assert `expect(timers.slept).toEqual([250])`. */
  readonly slept: number[]
}

/**
 * Records sleeps and returns immediately.
 *
 * Backoff is asserted as *what was requested*, not as elapsed wall time, which is why this
 * package needs no `vi.useFakeTimers()` anywhere (`no-mocks.test.ts` enforces that).
 */
export function createManualTimers(): ManualTimers {
  const slept: number[] = []
  return {
    slept,
    setTimeout: (fn) => {
      fn()
    },
    sleep: async (ms) => {
      slept.push(ms)
    },
  }
}

export interface RecordingRecorder {
  record: (call: NewEntity<AiCall>) => Promise<void>
  readonly rows: Array<NewEntity<AiCall>>
}

export function createRecordingRecorder(options: { failWith?: Error } = {}): RecordingRecorder {
  const rows: Array<NewEntity<AiCall>> = []
  return {
    rows,
    record: async (call) => {
      if (options.failWith !== undefined) throw options.failWith
      rows.push(call)
    },
  }
}

export interface FakeSpendReader {
  spentSinceUsd: (from: Date) => Promise<number>
  set(total: number): void
  readonly reads: Date[]
}

export function createFakeSpendReader(initial = 0): FakeSpendReader {
  let total = initial
  const reads: Date[] = []
  return {
    reads,
    set: (next) => {
      total = next
    },
    spentSinceUsd: async (from) => {
      reads.push(from)
      return total
    },
  }
}

export function createFakeSecretReader(
  keys: Partial<Record<SecretName, string>>,
): SecretReader & { getSecret: (name: SecretName) => Promise<string | undefined> } {
  return { getSecret: async (name) => keys[name] }
}

export interface CollectingBudgetSink {
  emit: (event: AiBudgetEvent) => void
  readonly events: AiBudgetEvent[]
}

export function createCollectingBudgetSink(): CollectingBudgetSink {
  const events: AiBudgetEvent[] = []
  return { events, emit: (event) => events.push(event) }
}

/** The `{ aborted }` shape core's ports use, with a way to flip it. */
export function createManualAbort(): { signal: AbortSignalLike; abort(): void } {
  const state = { aborted: false }
  return {
    signal: state as AbortSignalLike,
    abort: () => {
      state.aborted = true
    },
  }
}

export const FIXTURE_RATES: Rates = Object.freeze({
  input: 1,
  output: 4,
  cacheRead: 0.1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  batchDiscount: 0.5,
})

/**
 * A table under the test's control.
 *
 * Most cost assertions run against this rather than the shipped file, so that only the
 * handful of tests deliberately pinning `pricing.json` break when a real price changes.
 */
export function makePricingTable(
  models: Record<string, Partial<ModelPricing> & { rates?: Partial<Rates> }>,
  aggregators: Record<string, { feePct: number }> = {},
): PricingTable {
  const entries = Object.entries(models).map(([key, model]) => {
    const { rates, ...rest } = model
    const base: ModelPricing = {
      provider: key.split(':')[0] ?? 'fixture',
      modelId: key.split(':')[1] ?? key,
      label: key,
      ...(rest.aliasOf === undefined
        ? { periods: [{ from: null, ...FIXTURE_RATES, ...rates }] }
        : {}),
      ...rest,
    }
    return [key, base] as const
  })
  return {
    version: 1,
    revision: '2026-01-01',
    models: Object.fromEntries(entries),
    aggregators,
  }
}

/** Exercises alias, aggregator and window resolution without touching the shipped table. */
export const FIXTURE_TABLE: PricingTable = makePricingTable(
  {
    'fixture:base': {},
    'fixture:windowed': {
      periods: [
        {
          from: null,
          ...FIXTURE_RATES,
          windows: [{ id: 'off-peak', startUtc: '16:30', endUtc: '00:30', input: 0.5, output: 2 }],
        },
      ],
    },
    'agg:base': { aliasOf: 'fixture:base', aggregator: 'demo' },
  },
  { demo: { feePct: 5.5 } },
)
