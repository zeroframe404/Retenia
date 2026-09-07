import { describe, expect, it } from 'vitest'
import { AiError } from './errors'
import { DEFAULT_PROFILES } from './profiles'
import { DEFAULT_ROLES, resolveTargets } from './roles'

const registry = { profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }

describe('resolveTargets', () => {
  it('puts Gemini Flash first for the cheap role, then Haiku as the fallback', () => {
    expect(resolveTargets('cheap', registry).map((t) => `${t.profile.id}/${t.modelId}`)).toEqual([
      'google/gemini-3.7-flash',
      'anthropic/claude-haiku-4-5',
    ])
  })

  it('puts Sonnet 5 first for the smart role', () => {
    expect(resolveTargets('smart', registry).map((t) => `${t.profile.id}/${t.modelId}`)).toEqual([
      'anthropic/claude-sonnet-5',
      'google/gemini-3.7-flash',
    ])
  })

  it('drops a target whose profile the allowlist removed', () => {
    // This is how `ai.providers.allowlist` narrows the matrix: main hands in a filtered
    // profile list and the role degrades to whatever survives.
    const onlyAnthropic = {
      profiles: DEFAULT_PROFILES.filter((p) => p.id === 'anthropic'),
      roles: DEFAULT_ROLES,
    }
    expect(
      resolveTargets('cheap', onlyAnthropic).map((t) => `${t.profile.id}/${t.modelId}`),
    ).toEqual(['anthropic/claude-haiku-4-5'])
  })

  it('drops a ref for a model its profile does not list', () => {
    const stale = {
      profiles: DEFAULT_PROFILES,
      roles: {
        cheap: {
          primary: { profileId: 'google', modelId: 'gemini-99-retired' },
          fallbacks: [{ profileId: 'anthropic', modelId: 'claude-haiku-4-5' }],
        },
      },
    }
    expect(resolveTargets('cheap', stale).map((t) => t.modelId)).toEqual(['claude-haiku-4-5'])
  })

  it('fails loudly for a role nobody configured, rather than borrowing another role model', () => {
    for (const role of ['vision', 'audio', 'local'] as const) {
      expect(() => resolveTargets(role, registry)).toThrow(AiError)
      try {
        resolveTargets(role, registry)
      } catch (error) {
        expect((error as AiError).code).toBe('not_configured')
        expect((error as AiError).message).toContain(role)
      }
    }
  })

  it('refuses to route embed at all, and says why in the message', () => {
    // The asymmetry is deliberate and surprising, so the error carries the reason: a
    // fallback would write two incomparable vector spaces into one index.
    try {
      resolveTargets('embed', registry)
      expect.unreachable('embed must not resolve')
    } catch (error) {
      expect((error as AiError).code).toBe('not_configured')
      expect((error as AiError).message).toContain('retrieval.embeddingModel')
      expect((error as AiError).message).toContain('vector space')
    }
  })

  it('fails when every profile is gone', () => {
    expect(() => resolveTargets('cheap', { profiles: [], roles: DEFAULT_ROLES })).toThrow(AiError)
  })
})
