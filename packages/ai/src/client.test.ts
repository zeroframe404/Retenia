import type { Clock } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createAiClient } from './client'
import { ZERO_USAGE } from './pricing'
import { DEFAULT_PROFILES } from './profiles'
import { DEFAULT_ROLES } from './roles'
import {
  createFakeSecretReader,
  createFakeSpendReader,
  createManualTimers,
  createRecordingRecorder,
  createScriptedInvoker,
} from './testing'

const clock: Clock = { now: () => new Date(2026, 8, 7, 12) }

function client(script: Parameters<typeof createScriptedInvoker>[0] = []) {
  const { invoker, calls } = createScriptedInvoker(script)
  const recorder = createRecordingRecorder()
  const spend = createFakeSpendReader(0)
  return {
    calls,
    rows: recorder.rows,
    client: createAiClient({
      invoker,
      getSecret: createFakeSecretReader({ anthropic: 'sk', google: 'AIza' }).getSecret,
      recordCall: recorder.record,
      spentSinceUsd: spend.spentSinceUsd,
      monthlyBudgetUsd: async () => 30,
      clock,
      timers: createManualTimers(),
      random: () => 0.5,
    }),
  }
}

describe('createAiClient', () => {
  it('hands out a plain TextGenerator, the seam four packages already inject', () => {
    const generate = client().client.textGenerator({ role: 'cheap', purpose: 'contextualize' })
    expect(generate).toBeTypeOf('function')
  })

  it('runs a bound call and logs it', async () => {
    const harness = client([
      {
        kind: 'ok',
        text: 'a context sentence',
        modelId: 'gemini-3.7-flash',
        usage: { ...ZERO_USAGE, inputTokens: 1000, outputTokens: 100 },
        finishReason: 'stop',
      },
    ])
    const result = await harness.client.textGenerator({
      role: 'cheap',
      purpose: 'contextualize',
      jobId: 'job-1',
      promptVersion: '1',
    })({ prompt: 'hola', temperature: 0 })

    expect(result.text).toBe('a context sentence')
    expect(harness.rows[0]).toMatchObject({
      purpose: 'contextualize',
      jobId: 'job-1',
      promptVersion: '1',
    })
  })

  it('quotes the cheap role at Gemini Flash rates', async () => {
    await expect(client().client.ratesFor('cheap')).resolves.toEqual({
      inputUsdPerMillion: 0.75,
      outputUsdPerMillion: 3.75,
      cachedInputUsdPerMillion: 0.075,
      cacheWriteUsdPerMillion: 0.75,
    })
  })

  it('answers undefined rather than throwing for a role it cannot quote', async () => {
    // The caller is an estimate the user is waiting on; it still has to render something.
    await expect(client().client.ratesFor('vision')).resolves.toBeUndefined()
    await expect(client().client.ratesFor('embed')).resolves.toBeUndefined()
  })

  it('narrows the matrix through the injected registry', async () => {
    // This is the shape `ai.providers.allowlist` reaches the package in: a resolver main
    // calls per run, never a setting this package reads.
    const { invoker, calls } = createScriptedInvoker([
      {
        kind: 'ok',
        text: 'ok',
        modelId: 'claude-haiku-4-5',
        usage: ZERO_USAGE,
        finishReason: 'stop',
      },
    ])
    const recorder = createRecordingRecorder()
    const instance = createAiClient({
      invoker,
      registry: async () => ({
        profiles: DEFAULT_PROFILES.filter((p) => p.id === 'anthropic'),
        roles: DEFAULT_ROLES,
      }),
      getSecret: createFakeSecretReader({ anthropic: 'sk' }).getSecret,
      recordCall: recorder.record,
      spentSinceUsd: async () => 0,
      monthlyBudgetUsd: async () => 30,
      clock,
    })
    await instance.textGenerator({ role: 'cheap', purpose: 'contextualize' })({
      prompt: 'hola',
      temperature: 0,
    })
    expect(calls[0]?.target.profile.id).toBe('anthropic')
    await expect(instance.ratesFor('cheap')).resolves.toMatchObject({ inputUsdPerMillion: 1 })
  })

  it('blocks by default when the cap is reached', async () => {
    // `hardBlockEnabled` is optional and defaults to true: an unenforced cap is a number
    // that only looks like a control. 7.5 exposes the toggle.
    const instance = createAiClient({
      invoker: createScriptedInvoker([]).invoker,
      getSecret: createFakeSecretReader({ google: 'AIza' }).getSecret,
      recordCall: async () => {},
      spentSinceUsd: async () => 30,
      monthlyBudgetUsd: async () => 30,
      clock,
    })
    await expect(
      instance.textGenerator({ role: 'cheap', purpose: 'contextualize' })({
        prompt: 'hola',
        temperature: 0,
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' })
  })
})

describe('composed with the real SDK invoker', () => {
  it('carries a call from a role name to a costed ai_calls row', async () => {
    // The one place `createAiClient` and `createSdkInvoker` are exercised together, so the
    // seam between the pure half and the SDK half is proved rather than assumed. Only the
    // network is replaced.
    const { MockLanguageModelV4 } = await import('ai/test')
    const { createSdkInvoker } = await import('./providers')

    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: 'un contexto' }],
        finishReason: { unified: 'stop' as const, raw: 'end_turn' },
        usage: {
          inputTokens: { total: 12_000, noCache: 4000, cacheRead: 8000, cacheWrite: 0 },
          outputTokens: { total: 900, text: 600, reasoning: 300 },
        },
        warnings: [],
      }),
    })

    const recorder = createRecordingRecorder()
    const instance = createAiClient({
      invoker: createSdkInvoker({ bindModel: () => model }),
      getSecret: createFakeSecretReader({ google: 'AIza' }).getSecret,
      recordCall: recorder.record,
      spentSinceUsd: async () => 0,
      monthlyBudgetUsd: async () => 30,
      clock,
    })

    const result = await instance.textGenerator({ role: 'cheap', purpose: 'contextualize' })({
      prompt: 'el fragmento',
      temperature: 0,
      idempotencyKey: 'contextualize:1:s:c',
    })

    expect(result.text).toBe('un contexto')
    expect(recorder.rows[0]).toMatchObject({
      provider: 'google',
      model: 'gemini-3.7-flash',
      status: 'ok',
      inputTokens: 4000,
      cachedInputTokens: 8000,
      outputTokens: 900,
      reasoningTokens: 300,
      costUsd: 0.006975,
      customId: 'contextualize:1:s:c',
    })
  })
})
