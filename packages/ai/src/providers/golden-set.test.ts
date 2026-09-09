import type { AiCall, Clock, NewEntity } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { SHIPPED_PRICING, ZERO_USAGE } from '../pricing'
import type { ProviderProfile } from '../profiles'
import { DEFAULT_PROFILES } from '../profiles'
import type { AiRegistry } from '../roles'
import { resolveTargets } from '../roles'
import type { AiBinding, RunDeps } from '../run'
import { runOnce } from '../run'
import {
  createCollectingBudgetSink,
  createFakeSecretReader,
  createFakeSpendReader,
  createManualTimers,
  createRecordingRecorder,
  createScriptedInvoker,
} from '../testing'
import golden from './__fixtures__/golden-lessons.json' with { type: 'json' }

/**
 * A contract test for the provider *abstraction* — profile -> registry -> resolveTargets ->
 * the invoker seam -> `runOnce` -> one `ai_calls` row — not for output quality. It never
 * calls a real provider (`probe.test.ts` and `sdk-invoker.test.ts` cover the SDK boundary
 * itself) and costs nothing, so it runs in every `pnpm test`. `pnpm evals`
 * (`tooling/evals/`) is the separate, real-money check on whether the *answers* are good.
 */

interface GoldenLesson {
  readonly id: string
  readonly prompt: string
  readonly system?: string
  readonly expectedShape: 'text'
}

const LESSONS = golden as readonly GoldenLesson[]

const AT = new Date(2026, 8, 8, 12, 0, 0)
const clock: Clock = { now: () => AT }

const anthropicProfile = DEFAULT_PROFILES.find((p) => p.kind === 'anthropic')
const googleProfile = DEFAULT_PROFILES.find((p) => p.kind === 'google')
if (anthropicProfile === undefined || googleProfile === undefined) {
  throw new Error('DEFAULT_PROFILES is missing an anthropic or google profile')
}

const localProfile: ProviderProfile = {
  id: 'local',
  kind: 'openai-compatible',
  keyRef: null,
  models: ['local-test-model'],
  caps: { jsonStrict: false },
  local: true,
  baseURL: 'http://127.0.0.1:11434',
}

interface Case {
  readonly kind: string
  readonly profile: ProviderProfile
  readonly modelId: string
}

const CASES: readonly Case[] = [
  { kind: 'anthropic', profile: anthropicProfile, modelId: anthropicProfile.models[0] as string },
  { kind: 'google', profile: googleProfile, modelId: googleProfile.models[0] as string },
  { kind: 'openai-compatible (local)', profile: localProfile, modelId: 'local-test-model' },
]

function registryFor(profile: ProviderProfile, modelId: string): AiRegistry {
  const ref = { profileId: profile.id, modelId }
  return {
    profiles: [profile],
    roles: { smart: { primary: ref, fallbacks: [] }, cheap: { primary: ref, fallbacks: [] } },
  }
}

describe.each(CASES)('the provider abstraction routes every golden lesson through $kind', (c) => {
  it('resolves a target for both "smart" and "cheap"', () => {
    const registry = registryFor(c.profile, c.modelId)
    expect(resolveTargets('smart', registry)).toHaveLength(1)
    expect(resolveTargets('cheap', registry)).toHaveLength(1)
  })

  it('answers all 20 golden lessons with an ok outcome, the right provider, and a non-negative cost', async () => {
    const registry = registryFor(c.profile, c.modelId)
    const script = LESSONS.map(() => ({
      kind: 'ok' as const,
      text: 'a lesson explanation',
      modelId: c.modelId,
      usage: { ...ZERO_USAGE, inputTokens: 200, outputTokens: 150 },
      finishReason: 'stop' as const,
    }))
    const { invoker } = createScriptedInvoker(script)
    const recorder = createRecordingRecorder()
    const timers = createManualTimers()
    const sink = createCollectingBudgetSink()
    const spend = createFakeSpendReader(0)

    const deps: RunDeps = {
      invoker,
      registry: async () => registry,
      pricing: SHIPPED_PRICING,
      getSecret: createFakeSecretReader({ anthropic: 'sk-ant-key', google: 'AIza-key' }).getSecret,
      recordCall: recorder.record,
      spentSinceUsd: spend.spentSinceUsd,
      monthlyBudgetUsd: async () => 0,
      hardBlockEnabled: async () => true,
      clock,
      timers,
      random: () => 0.5,
      onBudgetEvent: sink.emit,
      logger: { warn: () => {}, error: () => {} },
    }

    const binding: AiBinding = { role: 'smart', purpose: 'golden_set_contract' }

    for (const lesson of LESSONS) {
      const result = await runOnce(deps, binding, {
        prompt: lesson.prompt,
        system: lesson.system,
        temperature: 0,
      })
      expect(result.text).toBe('a lesson explanation')
      expect(result.usage?.usd).toBeGreaterThanOrEqual(0)
    }

    expect(recorder.rows).toHaveLength(LESSONS.length)
    for (const row of recorder.rows as Array<NewEntity<AiCall>>) {
      expect(row.provider).toBe(c.profile.id)
      expect(row.model).toBe(c.modelId)
      expect(row.status).toBe('ok')
      expect(row.costUsd).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('a broken role config is dropped, not a crash', () => {
  it('resolveTargets drops a ref naming a model the profile does not list', () => {
    const registry: AiRegistry = {
      profiles: [anthropicProfile, googleProfile],
      roles: {
        smart: {
          primary: { profileId: 'anthropic', modelId: 'model-that-does-not-exist' },
          fallbacks: [{ profileId: 'google', modelId: googleProfile.models[0] as string }],
        },
      },
    }

    const targets = resolveTargets('smart', registry)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.profile.id).toBe('google')
  })
})
