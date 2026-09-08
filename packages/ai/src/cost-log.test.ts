import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AiCallMeta } from './cost-log'
import { aiCallMetaSchema, META_STRING_MAX, sanitizeMeta } from './cost-log'

const base: AiCallMeta = { attempt: 1, target: 0 }

describe('aiCallMetaSchema', () => {
  it('refuses any field nobody declared', () => {
    // `ai_calls.meta` is documented "never the content itself". A comment is not a control;
    // a strict object is.
    for (const extra of [{ prompt: 'x' }, { response: 'x' }, { apiKey: 'sk-x' }, { body: 'x' }]) {
      expect(aiCallMetaSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      )
    }
  })

  it('caps every declared string below the length of any real content', () => {
    // Introspected rather than asserted field by field, so adding `prompt: z.string()`
    // fails HERE, in CI, rather than in review.
    const json = z.toJSONSchema(aiCallMetaSchema) as {
      properties?: Record<string, { type?: string; maxLength?: number }>
    }
    const strings = Object.entries(json.properties ?? {}).filter(([, v]) => v.type === 'string')
    expect(strings.length).toBeGreaterThan(0)
    for (const [name, spec] of strings) {
      expect(spec.maxLength, `${name} is an uncapped string`).toBeLessThanOrEqual(META_STRING_MAX)
    }
  })

  it('accepts the shape run.ts actually writes', () => {
    expect(
      aiCallMetaSchema.safeParse({
        attempt: 2,
        target: 1,
        code: 'rate_limited',
        statusCode: 429,
        pricingRevision: '2026-09-07',
        rates: { input: 0.75, output: 3.75, cacheRead: 0.075 },
        cacheWriteTokens: 1024,
        costUnknown: true,
      }).success,
    ).toBe(true)
  })
})

describe('sanitizeMeta', () => {
  it('never throws on the settle path of a successful call', () => {
    // `meta` is a TEXT column with a json_valid CHECK. A BigInt reaching JSON.stringify
    // would turn a working answer into an error the user sees.
    const hostile = {
      ...base,
      statusCode: 10n as unknown as number,
      requestId: new Error('boom') as unknown as string,
      finishReason: 'stop',
    }
    const meta = sanitizeMeta(hostile)
    expect(() => JSON.stringify(meta)).not.toThrow()
    expect(meta.finishReason).toBe('stop')
    expect(meta.statusCode).toBeUndefined()
  })

  it('truncates a string that slipped past validation', () => {
    const meta = sanitizeMeta({ ...base, requestId: 'r'.repeat(500) })
    expect(String(meta.requestId ?? '').length).toBeLessThanOrEqual(META_STRING_MAX)
  })

  it('keeps the nested rates snapshot, nulls included', () => {
    const meta = sanitizeMeta({ ...base, rates: { input: 1, output: 5, cacheRead: null } })
    expect(meta.rates).toEqual({ input: 1, output: 5, cacheRead: null })
  })

  it('falls back to a valid row rather than losing the call', () => {
    const meta = sanitizeMeta({ attempt: -1, target: 0 } as AiCallMeta)
    expect(meta).toEqual({ attempt: 1, target: 0 })
  })
})
