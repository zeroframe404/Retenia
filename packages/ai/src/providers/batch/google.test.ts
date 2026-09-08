import { describe, expect, it } from 'vitest'
import { AiError } from '../../errors'
import type { InvokeTarget } from '../../invoker'
import { DEFAULT_PROFILES } from '../../profiles'
import { createGoogleBatchProvider, parseInlined, toGenerateContentRequest } from './google'
import type { FetchLike } from './http'

const profile = DEFAULT_PROFILES.find((entry) => entry.id === 'google')
if (profile === undefined) throw new Error('DEFAULT_PROFILES changed')

const target: InvokeTarget = { profile, modelId: 'gemini-3.7-flash', apiKey: 'AIza-CANARY' }
const options = { signal: undefined }

function scriptedFetch(script: Response[]): {
  fetch: FetchLike
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  return {
    calls,
    fetch: async (url, init) => {
      const step = script[calls.length]
      calls.push({ url, init })
      if (step === undefined) throw new Error(`no scripted response for call #${calls.length}`)
      return step
    },
  }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init })

describe('toGenerateContentRequest', () => {
  it('puts the stable prefix ahead of the task, which is what implicit caching matches on', () => {
    // Gemini has nothing to mark (§2), so the *order* is the entire optimisation. A request
    // that led with the volatile half would defeat it silently and at full price.
    const body = toGenerateContentRequest({
      system: 'You write lessons.',
      cachePrefix: 'the whole book',
      prompt: 'Write lesson 4.',
      temperature: 0.6,
    })

    const contents = body.contents as Array<{ parts: Array<{ text: string }> }>
    expect(contents[0]?.parts.map((part) => part.text)).toEqual([
      'the whole book',
      'Write lesson 4.',
    ])
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You write lessons.' }] })
  })

  it('binds a schema through responseJsonSchema', () => {
    const body = toGenerateContentRequest({
      prompt: 'x',
      temperature: 0,
      jsonSchema: { type: 'object' },
    })
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
    })
  })
})

describe('submit', () => {
  it('attaches the custom_id as request metadata and returns the operation name', async () => {
    const { fetch, calls } = scriptedFetch([json({ name: 'batches/abc123' })])
    const provider = createGoogleBatchProvider({ fetch, baseUrl: 'https://example.test' })

    const submission = await provider.submit(
      target,
      [
        { customId: 'a', request: { prompt: 'one', temperature: 0 } },
        { customId: 'b', request: { prompt: 'two', temperature: 0 } },
      ],
      options,
    )

    expect(submission.providerBatchId).toBe('batches/abc123')
    expect(calls[0]?.url).toBe(
      'https://example.test/v1beta/models/gemini-3.7-flash:batchGenerateContent',
    )
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      batch: { inputConfig: { requests: { requests: Array<{ metadata: { key: string } }> } } }
    }
    expect(body.batch.inputConfig.requests.requests.map((entry) => entry.metadata.key)).toEqual([
      'a',
      'b',
    ])
  })

  it('refuses an accepted batch with no operation name', async () => {
    const { fetch } = scriptedFetch([json({})])
    const provider = createGoogleBatchProvider({ fetch })

    await expect(
      provider.submit(
        target,
        [{ customId: 'a', request: { prompt: 'x', temperature: 0 } }],
        options,
      ),
    ).rejects.toThrow(/no operation name/)
  })
})

describe('poll', () => {
  it('reports an unfinished operation as running', async () => {
    const { fetch } = scriptedFetch([json({ name: 'batches/abc', done: false })])
    const provider = createGoogleBatchProvider({ fetch })

    expect(await provider.poll(target, 'batches/abc', options)).toMatchObject({
      status: 'in_progress',
    })
  })

  it('returns the inlined answers of a finished operation', async () => {
    const { fetch } = scriptedFetch([
      json({
        done: true,
        response: {
          inlinedResponses: {
            inlinedResponses: [
              {
                metadata: { key: 'a' },
                response: {
                  modelVersion: 'gemini-3.7-flash-002',
                  candidates: [
                    { finishReason: 'STOP', content: { parts: [{ text: 'lesson a' }] } },
                  ],
                  usageMetadata: {
                    promptTokenCount: 5000,
                    cachedContentTokenCount: 4000,
                    candidatesTokenCount: 300,
                  },
                },
              },
              { metadata: { key: 'b' }, error: { code: 400, message: 'bad request' } },
            ],
          },
        },
      }),
    ])
    const provider = createGoogleBatchProvider({ fetch })

    const poll = await provider.poll(target, 'batches/abc', options)

    expect(poll.status).toBe('completed')
    const [first, second] = poll.results
    expect(first?.outcome).toMatchObject({ kind: 'ok', text: 'lesson a' })
    // `promptTokenCount` is the TOTAL, cached tokens included — the opposite of Anthropic's
    // convention. Left as reported, every cached token is billed twice.
    expect(first?.outcome.kind === 'ok' ? first.outcome.usage : undefined).toMatchObject({
      inputTokens: 1000,
      cachedInputTokens: 4000,
      cacheWriteTokens: 0,
    })
    expect(second?.outcome).toMatchObject({ kind: 'error', error: { code: 'bad_request' } })
  })

  it('reports an operation that finished badly as a failed batch', async () => {
    const { fetch } = scriptedFetch([
      json({ done: true, error: { code: 500, message: 'internal' } }),
    ])
    const provider = createGoogleBatchProvider({ fetch })

    const poll = await provider.poll(target, 'batches/abc', options)
    expect(poll.status).toBe('failed')
    expect(poll.error).toBeInstanceOf(AiError)
    expect(poll.results).toEqual([])
  })

  it('answers a throttled poll with the wait the provider asked for', async () => {
    const { fetch } = scriptedFetch([json({}, { status: 429, headers: { 'retry-after': '30' } })])
    const provider = createGoogleBatchProvider({ fetch })

    expect(await provider.poll(target, 'batches/abc', options)).toMatchObject({
      status: 'in_progress',
      retryAfterMs: 30_000,
    })
  })
})

describe('parseInlined', () => {
  it('drops an entry with no key rather than guessing by position', () => {
    // The failure this prevents is the worst one this layer can have: one lesson's answer
    // stored under another lesson's cache key, silently, for ever.
    const items = parseInlined(
      {
        inlinedResponses: {
          inlinedResponses: [
            { response: { candidates: [{ content: { parts: [{ text: 'orphan' }] } }] } },
            {
              metadata: { key: 'b' },
              response: { candidates: [{ content: { parts: [{ text: 'b' }] } }] },
            },
          ],
        },
      },
      'gemini-3.7-flash',
    )

    expect(items.map((item) => item.customId)).toEqual(['b'])
  })

  it('answers an unrecognised payload with no items rather than throwing', () => {
    expect(parseInlined(undefined, 'gemini-3.7-flash')).toEqual([])
    expect(parseInlined({ response: 'nonsense' }, 'gemini-3.7-flash')).toEqual([])
  })
})

describe('cancel', () => {
  it('posts to the operation cancel endpoint', async () => {
    const { fetch, calls } = scriptedFetch([json({})])
    const provider = createGoogleBatchProvider({ fetch, baseUrl: 'https://example.test' })

    await provider.cancel(target, 'batches/abc', options)

    expect(calls[0]?.url).toBe('https://example.test/v1beta/batches/abc:cancel')
    expect(calls[0]?.init.method).toBe('POST')
  })
})
