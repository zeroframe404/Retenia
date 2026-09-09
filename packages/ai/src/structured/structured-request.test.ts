import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { structuredRequestFor } from './run-structured'

const schema = z.object({ answer: z.string() })

describe('structuredRequestFor()', () => {
  it('appends the output instruction and binds the schema in object mode', () => {
    const request = structuredRequestFor({
      system: 'Be brief.',
      prompt: 'Say hi.',
      temperature: 0,
      schema,
      schemaName: 'greeting',
      maxOutputTokens: 50,
      idempotencyKey: 'greet-1',
    })
    expect(request.system).toMatch(/^Be brief\.\n\n## Output/)
    expect(request).toMatchObject({
      prompt: 'Say hi.',
      temperature: 0,
      structuredMode: 'object',
      schemaName: 'greeting',
      maxOutputTokens: 50,
      idempotencyKey: 'greet-1',
    })
    expect(request.jsonSchema).toBeDefined()
    expect(request).not.toHaveProperty('cachePrefix')
    expect(request).not.toHaveProperty('cache')
  })

  it('carries a cache plan through to the transport request, untouched', () => {
    const cache = { ttl: '1h', system: true, prefix: true } as const
    const request = structuredRequestFor({
      system: 'Be brief.',
      prompt: 'Say hi.',
      temperature: 0.3,
      schema,
      cachePrefix: '<user_content label="toc">…</user_content>',
      cache,
    })
    expect(request.cachePrefix).toBe('<user_content label="toc">…</user_content>')
    expect(request.cache).toBe(cache)
  })
})
