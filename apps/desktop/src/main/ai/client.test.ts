import { AiError, DEFAULT_PROFILES, DEFAULT_ROLES, ZERO_USAGE } from '@retenia/ai'
import { createScriptedInvoker } from '@retenia/ai/testing'
import type { AiCall, AiResult, NewEntity, SettingsMap } from '@retenia/core'
import { describe, expect, it, vi } from 'vitest'
import { settleJudgeAssignment } from './client'

// `vi.mock` here is the repo's usual reason for it: making the `electron` specifier
// resolve outside a real Electron process. `redactPaths` reads these paths to build its
// substitutions, and `log` reaches electron-log through them.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? '/home/ana' : `/home/ana/.config/${name}`),
    getAppPath: () => '/opt/Retenia/resources/app.asar',
  },
}))

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/**
 * The adapter, plus one end-to-end pass through the whole stack with nothing faked but the
 * network: role resolution -> key lookup -> the real `generateText` -> usage translation ->
 * cost math -> the cost log.
 */

const SETTINGS: SettingsMap = {
  'ai.budget.monthlyUsd': 30,
  'ai.budget.hardBlock': true,
  'ai.providers.allowlist': [],
  'ai.roles': {},
  'ai.pricing.overlay': {},
  'ai.budget.lastAlertedThreshold': { period: '', threshold: 0 },
} as unknown as SettingsMap

function harness(
  over: Partial<SettingsMap> = {},
  keys: Record<string, string> = { google: 'AIza', anthropic: 'sk-ant' },
) {
  const rows: Array<NewEntity<AiCall>> = []
  const settings: Record<string, unknown> = { ...SETTINGS, ...over }
  return {
    rows,
    settings,
    deps: {
      repos: {
        aiCalls: {
          record: async (call: NewEntity<AiCall>) => {
            rows.push(call)
            return call as unknown as AiCall
          },
          sumCost: async () => 0,
        },
        aiResults: {
          findByCustomId: async () => undefined,
          put: async (input: NewEntity<AiResult>) => input as unknown as AiResult,
        },
        settings: {
          get: async <K extends keyof SettingsMap>(key: K) => settings[key] as SettingsMap[K],
          set: async <K extends keyof SettingsMap>(key: K, value: SettingsMap[K]) => {
            settings[key] = value
          },
        },
      },
      secrets: { getSecret: async (name: string) => keys[name] },
    },
  }
}

const { allowedProfiles, buildRegistry, createMainAiClient, LOCAL_PROFILE_ID } = await import(
  './client'
)

describe('allowedProfiles', () => {
  it('reads an empty allowlist as "all of them"', () => {
    // An unset list is the default state; reading it as a total block would make the app
    // unusable until the user found a setting they never knew existed.
    expect(allowedProfiles(DEFAULT_PROFILES, [])).toEqual(DEFAULT_PROFILES)
  })

  it('narrows to the named profiles', () => {
    expect(allowedProfiles(DEFAULT_PROFILES, ['anthropic']).map((p) => p.id)).toEqual(['anthropic'])
    expect(allowedProfiles(DEFAULT_PROFILES, ['nope'])).toEqual([])
  })
})

describe('createMainAiClient', () => {
  it('is synchronous, so bootstrapJobs can stay synchronous', () => {
    // The registry is a resolver rather than a value precisely so this holds.
    const client = createMainAiClient(harness().deps)
    expect(client.textGenerator).toBeTypeOf('function')
  })

  it('quotes the cheap role from the shipped table', async () => {
    await expect(createMainAiClient(harness().deps).ratesFor('cheap')).resolves.toMatchObject({
      inputUsdPerMillion: 0.75,
      outputUsdPerMillion: 3.75,
    })
  })

  it('applies ai.providers.allowlist, its first reader since 3.5', async () => {
    const client = createMainAiClient(harness({ 'ai.providers.allowlist': ['anthropic'] }).deps)
    // Haiku, not Gemini: the Google profile is gone, so the fallback becomes the primary.
    await expect(client.ratesFor('cheap')).resolves.toMatchObject({ inputUsdPerMillion: 1 })
  })

  it('blocks once ai.budget.monthlyUsd is spent', async () => {
    const h = harness()
    const client = createMainAiClient({
      ...h.deps,
      repos: { ...h.deps.repos, aiCalls: { ...h.deps.repos.aiCalls, sumCost: async () => 30 } },
    })
    await expect(
      client.textGenerator({ role: 'cheap', purpose: 'contextualize' })({
        prompt: 'hola',
        temperature: 0,
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' })
    expect(h.rows).toHaveLength(0)
  })

  it('redacts an absolute path out of a provider message before it is stored', async () => {
    // `redactKey` already removed the API key upstream, where the plaintext was in scope.
    // This is the second pass: a provider can echo a temp path from its own stack, and
    // `ai_calls.error` is read back into the usage dashboard.
    const h = harness()
    const { invoker } = createScriptedInvoker([
      {
        kind: 'error',
        error: new AiError('bad_request', 'could not read /home/ana/AppData/Local/retenia/x.pdf', {
          statusCode: 400,
        }),
      },
      {
        kind: 'error',
        error: new AiError('bad_request', 'nope', { statusCode: 400 }),
      },
    ])
    const client = createMainAiClient({ ...h.deps, invoker })

    await client
      .textGenerator({ role: 'cheap', purpose: 'contextualize' })({ prompt: 'x', temperature: 0 })
      .catch(() => undefined)

    expect(h.rows).toHaveLength(2)
    expect(h.rows[0]?.error).not.toContain('/home/ana')
    expect(h.rows[0]?.error).toContain('<home>')
  })

  it('logs one row per dispatched attempt, with the purpose and the cost', async () => {
    const h = harness()
    const { invoker } = createScriptedInvoker([
      {
        kind: 'ok',
        text: 'un contexto',
        modelId: 'gemini-3.7-flash',
        usage: {
          ...ZERO_USAGE,
          inputTokens: 4000,
          cachedInputTokens: 8000,
          outputTokens: 900,
          reasoningTokens: 300,
        },
        finishReason: 'stop',
      },
    ])
    const client = createMainAiClient({ ...h.deps, invoker })
    const result = await client.textGenerator({ role: 'cheap', purpose: 'contextualize' })({
      prompt: 'el fragmento',
      temperature: 0,
      idempotencyKey: 'contextualize:1:s:c',
    })

    expect(result.text).toBe('un contexto')
    expect(h.rows[0]).toMatchObject({
      provider: 'google',
      model: 'gemini-3.7-flash',
      purpose: 'contextualize',
      status: 'ok',
      inputTokens: 4000,
      cachedInputTokens: 8000,
      costUsd: 0.006975,
      customId: 'contextualize:1:s:c',
    })
  })
})

describe('buildRegistry: local providers', () => {
  it('leaves the registry untouched when no local model is configured', async () => {
    const registry = await buildRegistry(harness().deps.repos)
    expect(registry.profiles).toEqual(DEFAULT_PROFILES)
    expect(registry.roles).toBe(DEFAULT_ROLES)
  })

  it('adds the local profile and prefers it for the named roles', async () => {
    const h = harness({
      'ai.providers.local.model': 'qwen3.5:9b',
      'ai.providers.local.baseUrl': 'http://127.0.0.1:11434',
      'ai.providers.local.preferRoles': ['cheap'],
    })
    const registry = await buildRegistry(h.deps.repos)

    const local = registry.profiles.find((p) => p.id === LOCAL_PROFILE_ID)
    expect(local).toMatchObject({
      kind: 'openai-compatible',
      keyRef: null,
      local: true,
      baseURL: 'http://127.0.0.1:11434',
      models: ['qwen3.5:9b'],
    })

    expect(registry.roles.cheap?.primary).toEqual({
      profileId: LOCAL_PROFILE_ID,
      modelId: 'qwen3.5:9b',
    })
    // "smart" was not in `preferRoles`: composing "cheap" must not touch it.
    expect(registry.roles.smart).toBe(DEFAULT_ROLES.smart)
  })

  it('ignores preferRoles when no local model is configured', async () => {
    const h = harness({ 'ai.providers.local.preferRoles': ['cheap'] })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.roles).toBe(DEFAULT_ROLES)
    expect(registry.profiles.some((p) => p.id === LOCAL_PROFILE_ID)).toBe(false)
  })

  it('applies the provider allowlist to the local profile too', async () => {
    const h = harness({
      'ai.providers.local.model': 'qwen3.5:9b',
      'ai.providers.local.baseUrl': 'http://127.0.0.1:11434',
      'ai.providers.allowlist': ['anthropic'],
    })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.profiles.map((p) => p.id)).toEqual(['anthropic'])
  })
})

describe('buildRegistry: ai.roles overrides', () => {
  it('leaves the default role untouched when ai.roles has no entry for it', async () => {
    const registry = await buildRegistry(harness().deps.repos)
    expect(registry.roles.smart).toBe(DEFAULT_ROLES.smart)
  })

  it('overrides a role whose stored profile/model pair resolves', async () => {
    const h = harness({
      'ai.roles': {
        cheap: {
          primary: { profileId: 'anthropic', modelId: 'claude-haiku-4-5' },
          fallbacks: [],
        },
      },
    })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.roles.cheap).toEqual({
      primary: { profileId: 'anthropic', modelId: 'claude-haiku-4-5' },
      fallbacks: [],
    })
    expect(registry.roles.smart).toBe(DEFAULT_ROLES.smart)
  })

  it('keeps the default when the stored assignment does not resolve', async () => {
    const h = harness({
      'ai.roles': {
        cheap: {
          primary: { profileId: 'anthropic', modelId: 'model-that-does-not-exist' },
          fallbacks: [],
        },
      },
    })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.roles.cheap).toBe(DEFAULT_ROLES.cheap)
  })

  it('drops a fallback that does not resolve but keeps the rest', async () => {
    const h = harness({
      'ai.roles': {
        smart: {
          primary: { profileId: 'anthropic', modelId: 'claude-sonnet-5' },
          fallbacks: [
            { profileId: 'google', modelId: 'gemini-3.7-flash' },
            { profileId: 'anthropic', modelId: 'model-that-does-not-exist' },
          ],
        },
      },
    })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.roles.smart).toEqual({
      primary: { profileId: 'anthropic', modelId: 'claude-sonnet-5' },
      fallbacks: [{ profileId: 'google', modelId: 'gemini-3.7-flash' }],
    })
  })
})

describe('the budget-alert latch', () => {
  const overBudget = { 'ai.budget.monthlyUsd': 0.05 }

  function bigCall(inputTokens = 100_000) {
    return createScriptedInvoker([
      {
        kind: 'ok' as const,
        text: 'ok',
        modelId: 'gemini-3.7-flash',
        usage: { ...ZERO_USAGE, inputTokens, outputTokens: 100 },
        finishReason: 'stop' as const,
      },
    ])
  }

  it('fires the alert and persists the latch on a threshold crossing', async () => {
    const h = harness(overBudget)
    const alerts: Array<{ period: string; threshold: 80 | 100 }> = []
    const client = createMainAiClient({
      ...h.deps,
      invoker: bigCall().invoker,
      onBudgetAlert: (a) => alerts.push(a),
    })

    await client.textGenerator({ role: 'cheap', purpose: 'x' })({ prompt: 'y', temperature: 0 })

    expect(alerts.length).toBeGreaterThan(0)
    expect(h.settings['ai.budget.lastAlertedThreshold']).toMatchObject({
      threshold: alerts[alerts.length - 1]?.threshold,
    })
  })

  it('does not re-fire the same threshold again within the same month', async () => {
    const h = harness(overBudget)
    const alerts: unknown[] = []
    const options = { ...h.deps, onBudgetAlert: (a: unknown) => alerts.push(a) }

    await createMainAiClient({ ...options, invoker: bigCall().invoker }).textGenerator({
      role: 'cheap',
      purpose: 'x',
    })({ prompt: 'y', temperature: 0 })
    const afterFirst = alerts.length
    expect(afterFirst).toBeGreaterThan(0)

    // The latch is now stored; a second run whose crossings top out at the same threshold
    // (or lower) must not alert again.
    await createMainAiClient({ ...options, invoker: bigCall(1000).invoker }).textGenerator({
      role: 'cheap',
      purpose: 'x',
    })({ prompt: 'y', temperature: 0 })

    expect(alerts.length).toBe(afterFirst)
  })

  it('resets the latch for a new month', async () => {
    const h = harness(overBudget)
    h.settings['ai.budget.lastAlertedThreshold'] = { period: '2020-01', threshold: 100 }
    const alerts: unknown[] = []

    await createMainAiClient({
      ...h.deps,
      invoker: bigCall().invoker,
      onBudgetAlert: (a) => alerts.push(a),
    }).textGenerator({ role: 'cheap', purpose: 'x' })({ prompt: 'y', temperature: 0 })

    expect(alerts.length).toBeGreaterThan(0)
  })
})

describe('buildRegistry: the judge role (docs/spec/04-path-generation.md §5 gate 9)', () => {
  it('resolves the default judge to Gemini, the complement of the Sonnet 5 generator', async () => {
    const registry = await buildRegistry(harness().deps.repos)
    expect(registry.roles.judge?.primary).toEqual({
      profileId: 'google',
      modelId: 'gemini-3.7-flash',
    })
    // Nothing to derive on the defaults: the very same map, so identity checks elsewhere hold.
    expect(registry.roles).toBe(DEFAULT_ROLES)
  })

  it('re-derives the judge when a stored smart override lands on its model', async () => {
    const h = harness({
      'ai.roles': {
        smart: { primary: { profileId: 'google', modelId: 'gemini-3.7-flash' }, fallbacks: [] },
      },
    })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.roles.judge?.primary).toEqual({
      profileId: 'anthropic',
      modelId: 'claude-sonnet-5',
    })
  })

  it('keeps a stored judge that differs from the generator', async () => {
    const h = harness({
      'ai.roles': {
        judge: { primary: { profileId: 'anthropic', modelId: 'claude-haiku-4-5' }, fallbacks: [] },
      },
    })
    const registry = await buildRegistry(h.deps.repos)
    expect(registry.roles.judge?.primary).toEqual({
      profileId: 'anthropic',
      modelId: 'claude-haiku-4-5',
    })
  })
})

describe('settleJudgeAssignment()', () => {
  const gemini = { profileId: 'google', modelId: 'gemini-3.7-flash' }
  const sonnet = { profileId: 'anthropic', modelId: 'claude-sonnet-5' }

  it('stores a judge that differs from the generator as submitted', () => {
    const submitted = {
      smart: { primary: sonnet, fallbacks: [] },
      judge: { primary: gemini, fallbacks: [] },
    }
    expect(settleJudgeAssignment(gemini, submitted)).toEqual({ stored: submitted, error: null })
  })

  it('drops a colliding judge the panel merely echoed back, so the registry re-derives it', () => {
    // The user moved `smart` onto Gemini; the panel resubmitted the judge it was shown (Gemini).
    const settled = settleJudgeAssignment(gemini, {
      smart: { primary: gemini, fallbacks: [] },
      judge: { primary: gemini, fallbacks: [] },
    })
    expect(settled.error).toBeNull()
    expect(settled.stored).toEqual({ smart: { primary: gemini, fallbacks: [] } })
  })

  it('refuses a judge the user chose onto the generator', () => {
    const settled = settleJudgeAssignment(gemini, {
      smart: { primary: sonnet, fallbacks: [] },
      judge: { primary: sonnet, fallbacks: [] },
    })
    expect(settled.error).toMatch(/must not run on the model that writes the lessons/)
  })

  it('has nothing to settle when either role is unassigned', () => {
    const submitted = {
      smart: { primary: null, fallbacks: [] },
      judge: { primary: gemini, fallbacks: [] },
    }
    expect(settleJudgeAssignment(null, submitted).error).toBeNull()
  })
})
