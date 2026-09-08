import { AiError, DEFAULT_PROFILES, ZERO_USAGE } from '@retenia/ai'
import { createScriptedInvoker } from '@retenia/ai/testing'
import type { AiCall, AiResult, NewEntity, SettingsMap } from '@retenia/core'
import { describe, expect, it, vi } from 'vitest'

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
} as unknown as SettingsMap

function harness(
  over: Partial<SettingsMap> = {},
  keys: Record<string, string> = { google: 'AIza', anthropic: 'sk-ant' },
) {
  const rows: Array<NewEntity<AiCall>> = []
  const settings = { ...SETTINGS, ...over }
  return {
    rows,
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
          get: async <K extends keyof SettingsMap>(key: K) => settings[key],
        },
      },
      secrets: { getSecret: async (name: string) => keys[name] },
    },
  }
}

const { allowedProfiles, createMainAiClient } = await import('./client')

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
