import { describe, expect, it, vi } from 'vitest'
import { isAiError } from './errors'
import type { InvokeOutcome, InvokeTarget, ProviderInvoker } from './invoker'
import {
  createLocalProfile,
  DEFAULT_LOCAL_CONTEXT_TOKENS,
  guardLocalContext,
  withLocalPolicy,
  withLocalPreference,
} from './local'
import type { Timers } from './ports'
import { ZERO_USAGE } from './pricing'
import { DEFAULT_ROLES } from './roles'
import type { TextGenerationRequest } from './text-generator'

const TARGET: InvokeTarget = {
  profile: createLocalProfile({
    id: 'ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: ['m'],
  }),
  modelId: 'm',
  apiKey: '',
}
const CLOUD_TARGET: InvokeTarget = {
  profile: {
    id: 'google',
    kind: 'google',
    keyRef: 'google',
    caps: { jsonStrict: true },
    models: ['g'],
  },
  modelId: 'g',
  apiKey: 'k',
}
const REQUEST: TextGenerationRequest = { prompt: 'hi', temperature: 0 }
const OK: InvokeOutcome = {
  kind: 'ok',
  text: 'hi',
  modelId: 'm',
  usage: ZERO_USAGE,
  finishReason: 'stop',
}

/** Never resolves — forces `Promise.race` to settle on whichever other promise is racing it. */
function hangingInvoker(): ProviderInvoker {
  return () => new Promise(() => undefined)
}

/** Resolves to `NEXT` synchronously (via a scripted answer), so a race with a real timer loses. */
function fixedInvoker(outcome: InvokeOutcome): ProviderInvoker {
  return async () => outcome
}

function neverTimers(): Timers {
  return { setTimeout: () => undefined, sleep: () => new Promise(() => undefined) }
}
function instantTimers(): Timers {
  return { setTimeout: (fn) => fn(), sleep: async () => undefined }
}

describe('createLocalProfile', () => {
  it('builds a keyless, zero-cost, non-strict-JSON profile', () => {
    const profile = createLocalProfile({
      id: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      models: ['qwen3.5:9b', 'gemma4:12b'],
    })
    expect(profile).toMatchObject({
      id: 'ollama',
      kind: 'openai-compatible',
      keyRef: null,
      local: true,
      baseURL: 'http://127.0.0.1:11434/v1',
      caps: { jsonStrict: false },
      models: ['qwen3.5:9b', 'gemma4:12b'],
    })
  })
})

describe('withLocalPreference', () => {
  it('splices the local target in front of an existing role chain', () => {
    const roles = withLocalPreference(DEFAULT_ROLES, 'cheap', { profileId: 'ollama', modelId: 'm' })
    expect(roles.cheap?.primary).toEqual({ profileId: 'ollama', modelId: 'm' })
    // The role's old primary survives as the first fallback — the cloud chain is preserved,
    // not discarded.
    expect(roles.cheap?.fallbacks).toEqual([
      DEFAULT_ROLES.cheap?.primary,
      ...(DEFAULT_ROLES.cheap?.fallbacks ?? []),
    ])
    // Untouched: composing "cheap" must not touch "smart".
    expect(roles.smart).toBe(DEFAULT_ROLES.smart)
  })

  it('gives a role with no prior config a local-only chain', () => {
    const roles = withLocalPreference({}, 'local', { profileId: 'ollama', modelId: 'm' })
    expect(roles.local).toEqual({ primary: { profileId: 'ollama', modelId: 'm' }, fallbacks: [] })
  })
})

describe('guardLocalContext', () => {
  it('leaves a short request untouched', () => {
    const result = guardLocalContext(REQUEST)
    expect(result).toEqual({ request: REQUEST, truncated: false })
  })

  it('truncates an over-budget cachePrefix, keeping system and prompt intact', () => {
    const prefix = 'x'.repeat(DEFAULT_LOCAL_CONTEXT_TOKENS * 4 + 4000)
    const request: TextGenerationRequest = { ...REQUEST, system: 'be helpful', cachePrefix: prefix }
    const result = guardLocalContext(request, DEFAULT_LOCAL_CONTEXT_TOKENS)

    expect(result.truncated).toBe(true)
    expect(result.request.system).toBe('be helpful')
    expect(result.request.prompt).toBe('hi')
    expect(result.request.cachePrefix?.length).toBeLessThan(prefix.length)
    // The tail survives, not the head: the most recent context is what is kept.
    expect(prefix.endsWith(result.request.cachePrefix ?? '\0')).toBe(true)
  })
})

describe('withLocalPolicy', () => {
  it('passes a local target straight through to the real invoker', async () => {
    const policy = withLocalPolicy(fixedInvoker(OK), { timers: neverTimers() })
    const result = await policy(TARGET, REQUEST, { signal: undefined })
    expect(result).toBe(OK)
  })

  it('turns a stalled local call into a network error instead of hanging forever', async () => {
    const policy = withLocalPolicy(hangingInvoker(), { timers: instantTimers(), localTimeoutMs: 5 })
    const result = await policy(TARGET, REQUEST, { signal: undefined })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error.code).toBe('network')
      expect(result.error.message).toContain('did not answer')
    }
  })

  it('refuses a cloud target while offline without touching the invoker', async () => {
    const invoker = vi.fn(fixedInvoker(OK))
    const policy = withLocalPolicy(invoker, { timers: neverTimers(), isOnline: () => false })
    const result = await policy(CLOUD_TARGET, REQUEST, { signal: undefined })

    expect(invoker).not.toHaveBeenCalled()
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(isAiError(result.error)).toBe(true)
      expect(result.error.code).toBe('offline')
    }
  })

  it('dispatches a cloud target normally when online', async () => {
    const policy = withLocalPolicy(fixedInvoker(OK), {
      timers: neverTimers(),
      isOnline: () => true,
    })
    const result = await policy(CLOUD_TARGET, REQUEST, { signal: undefined })
    expect(result).toBe(OK)
  })

  it('never gates a local target on connectivity', async () => {
    // `isOnline` says offline, but the target is local: the whole point of "local" is that
    // it needs no network, so it must dispatch anyway.
    const policy = withLocalPolicy(fixedInvoker(OK), {
      timers: neverTimers(),
      isOnline: () => false,
    })
    const result = await policy(TARGET, REQUEST, { signal: undefined })
    expect(result).toBe(OK)
  })
})
