import { describe, expect, it } from 'vitest'
import { AiError } from './errors'
import { DEFAULT_PROFILES } from './profiles'
import { DEFAULT_ROLES, judgeConflict, resolveTargets, withJudgeDefault } from './roles'

const registry = { profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }

const sonnet = { profileId: 'anthropic', modelId: 'claude-sonnet-5' }
const gemini = { profileId: 'google', modelId: 'gemini-3.7-flash' }
const haiku = { profileId: 'anthropic', modelId: 'claude-haiku-4-5' }

describe('the judge role (docs/spec/04-path-generation.md §5 gate 9)', () => {
  it('defaults to Gemini 3.7 Flash, the complement of the Sonnet 5 generator', () => {
    expect(resolveTargets('judge', registry).map((t) => `${t.profile.id}/${t.modelId}`)).toEqual([
      'google/gemini-3.7-flash',
      'anthropic/claude-haiku-4-5',
    ])
    expect(judgeConflict(DEFAULT_ROLES)).toBeNull()
    // Nothing to derive: the very same object comes back, so identity comparisons hold.
    expect(withJudgeDefault(DEFAULT_ROLES)).toBe(DEFAULT_ROLES)
  })

  it('derives Sonnet 5 when the lessons are written by Gemini', () => {
    const roles = withJudgeDefault({
      smart: { primary: gemini, fallbacks: [sonnet] },
      cheap: DEFAULT_ROLES.cheap as never,
    })
    expect(roles.judge).toEqual({ primary: sonnet, fallbacks: [haiku] })
    expect(judgeConflict(roles)).toBeNull()
  })

  it('re-derives a judge that collides with a moved generator', () => {
    // The user moved `smart` onto the model the judge defaulted to.
    const collided = { ...DEFAULT_ROLES, smart: { primary: gemini, fallbacks: [] } }
    expect(judgeConflict(collided)).toMatch(/must not run on the model that writes the lessons/)
    expect(withJudgeDefault(collided).judge).toEqual({ primary: sonnet, fallbacks: [haiku] })
  })

  it('keeps an explicit judge that already differs from the generator', () => {
    const explicit = { ...DEFAULT_ROLES, judge: { primary: haiku, fallbacks: [] } }
    expect(withJudgeDefault(explicit)).toBe(explicit)
  })

  it('strips the generator from an explicit judge’s fallbacks', () => {
    // Sonnet writes the lessons; a judge that falls back to Sonnet is the same bias one hop
    // later, so that fallback goes and the rest of the chain stays as chosen.
    const explicit = { ...DEFAULT_ROLES, judge: { primary: haiku, fallbacks: [sonnet, gemini] } }
    expect(withJudgeDefault(explicit).judge).toEqual({ primary: haiku, fallbacks: [gemini] })
  })

  it('never lets a fallback land on the generator either', () => {
    // A generator that is neither chain's primary: the first chain applies, minus any
    // fallback equal to the generator.
    const roles = withJudgeDefault({ smart: { primary: haiku, fallbacks: [] } })
    expect(roles.judge?.primary).toEqual(gemini)
    expect(roles.judge?.fallbacks).toEqual([])
  })

  it('has nothing to conflict with when a role is missing', () => {
    expect(judgeConflict({})).toBeNull()
    expect(judgeConflict({ smart: { primary: sonnet, fallbacks: [] } })).toBeNull()
    expect(withJudgeDefault({}).judge?.primary).toEqual(gemini)
  })
})

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
