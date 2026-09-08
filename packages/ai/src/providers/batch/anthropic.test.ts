import { describe, expect, it } from 'vitest'
import { AiError } from '../../errors'
import type { InvokeTarget } from '../../invoker'
import { DEFAULT_PROFILES } from '../../profiles'
import type { TextGenerationRequest } from '../../text-generator'
import { createAnthropicBatchProvider, parseResults, toMessageParams } from './anthropic'
import type { FetchLike } from './http'

const profile = DEFAULT_PROFILES.find((entry) => entry.id === 'anthropic')
if (profile === undefined) throw new Error('DEFAULT_PROFILES changed')

const CANARY = 'sk-ant-CANARY-7f3a'
const target: InvokeTarget = { profile, modelId: 'claude-sonnet-5', apiKey: CANARY }
const options = { signal: undefined }

interface Recorded {
  url: string
  init: RequestInit
}

/** A `fetch` that answers a scripted queue and records what it was asked. */
function scriptedFetch(script: Array<Response | (() => Response)>): {
  fetch: FetchLike
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  return {
    calls,
    fetch: async (url, init) => {
      const step = script[calls.length]
      calls.push({ url, init })
      if (step === undefined) throw new Error(`no scripted response for call #${calls.length}`)
      return typeof step === 'function' ? step() : step
    },
  }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init })

describe('toMessageParams', () => {
  it('sends the sources as a user part and the instructions as system', () => {
    // The trust boundary `sdk-invoker.ts` states, preserved across the REST translation:
    // untrusted material is never instructions, however stable a prefix it makes.
    const params = toMessageParams('claude-sonnet-5', {
      system: 'You write lessons.',
      cachePrefix: '<user_content>chapter three</user_content>',
      prompt: 'Write lesson 4.',
      temperature: 0.6,
    })

    const system = params.system as Array<Record<string, unknown>>
    expect(system[0]?.text).toBe('You write lessons.')

    const messages = params.messages as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages[0]?.content.map((part) => part.text)).toEqual([
      '<user_content>chapter three</user_content>',
      'Write lesson 4.',
    ])
  })

  it('carries the cache breakpoints through as cache_control', () => {
    // §2's "compatible with caching" is the reason a batch of forty lessons over one book is
    // affordable at all; a translation that dropped the breakpoints would cost 5x in silence.
    const params = toMessageParams('claude-sonnet-5', {
      system: 'You write lessons.',
      cachePrefix: 'the book',
      prompt: 'Write lesson 4.',
      temperature: 0.6,
      cache: { ttl: '1h', system: true, prefix: true },
    })

    const system = params.system as Array<Record<string, unknown>>
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })

    const messages = params.messages as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages[0]?.content[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    // Never the volatile half: marking it would make every call a cache miss and a write.
    expect(messages[0]?.content[1]?.cache_control).toBeUndefined()
  })

  it('marks nothing when the request carries no directive', () => {
    const params = toMessageParams('claude-sonnet-5', {
      system: 'You write lessons.',
      cachePrefix: 'the book',
      prompt: 'Write lesson 4.',
      temperature: 0.6,
    })
    const system = params.system as Array<Record<string, unknown>>
    expect(system[0]?.cache_control).toBeUndefined()
  })

  it('always sends a max_tokens, which the REST endpoint requires', () => {
    expect(toMessageParams('claude-sonnet-5', { prompt: 'x', temperature: 0 }).max_tokens).toBe(
      8192,
    )
    expect(
      toMessageParams('claude-sonnet-5', { prompt: 'x', temperature: 0, maxOutputTokens: 500 })
        .max_tokens,
    ).toBe(500)
  })

  it('binds a schema as output_config, matching the synchronous path', () => {
    const params = toMessageParams('claude-sonnet-5', {
      prompt: 'x',
      temperature: 0,
      jsonSchema: { type: 'object' },
      schemaName: 'Lesson',
    } satisfies TextGenerationRequest)

    expect(params.output_config).toEqual({
      format: { type: 'json_schema', schema: { type: 'object' }, name: 'Lesson' },
    })
  })
})

describe('submit', () => {
  it('posts one entry per request, keyed by custom_id, and returns the batch id', async () => {
    const { fetch, calls } = scriptedFetch([
      json({ id: 'msgbatch_01', processing_status: 'in_progress' }),
    ])
    const provider = createAnthropicBatchProvider({ fetch, baseUrl: 'https://example.test' })

    const submission = await provider.submit(
      target,
      [
        { customId: 'a', request: { prompt: 'one', temperature: 0 } },
        { customId: 'b', request: { prompt: 'two', temperature: 0 } },
      ],
      options,
    )

    expect(submission.providerBatchId).toBe('msgbatch_01')
    expect(calls[0]?.url).toBe('https://example.test/v1/messages/batches')
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      requests: Array<{ custom_id: string }>
    }
    expect(body.requests.map((entry) => entry.custom_id)).toEqual(['a', 'b'])
    const headers = calls[0]?.init.headers as Record<string, string> | undefined
    expect(headers?.['x-api-key']).toBe(CANARY)
  })

  it('refuses a response with no id rather than inventing something to poll', async () => {
    const { fetch } = scriptedFetch([json({ processing_status: 'in_progress' })])
    const provider = createAnthropicBatchProvider({ fetch })

    await expect(
      provider.submit(
        target,
        [{ customId: 'a', request: { prompt: 'one', temperature: 0 } }],
        options,
      ),
    ).rejects.toThrow(/no id/)
  })

  it('classifies a 401 as auth and keeps the key out of the message', async () => {
    // A provider that echoes the key back in its error body is not hypothetical, and this
    // message goes straight into `ai_calls.error`.
    const { fetch } = scriptedFetch([
      json({ error: `bad key ${CANARY}` }, { status: 401, statusText: 'Unauthorized' }),
    ])
    const provider = createAnthropicBatchProvider({ fetch })

    const thrown = await provider
      .submit(target, [{ customId: 'a', request: { prompt: 'x', temperature: 0 } }], options)
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(AiError)
    expect((thrown as AiError).code).toBe('auth')
    expect((thrown as AiError).message).not.toContain(CANARY)
    expect((thrown as AiError).message).toContain('«redacted»')
  })
})

describe('poll', () => {
  it('reports a running batch without fetching results', async () => {
    const { fetch, calls } = scriptedFetch([
      json({
        id: 'msgbatch_01',
        processing_status: 'in_progress',
        request_counts: { processing: 12, succeeded: 28 },
      }),
    ])
    const provider = createAnthropicBatchProvider({ fetch })

    const poll = await provider.poll(target, 'msgbatch_01', options)

    expect(poll).toMatchObject({ status: 'in_progress', processing: 12 })
    expect(calls).toHaveLength(1)
  })

  it('reads the results file once the batch has ended', async () => {
    const results = [
      JSON.stringify({
        custom_id: 'a',
        result: {
          type: 'succeeded',
          message: {
            id: 'msg_1',
            model: 'claude-sonnet-5',
            stop_reason: 'end_turn',
            content: [
              { type: 'text', text: '{"ok":' },
              { type: 'text', text: 'true}' },
            ],
            usage: {
              input_tokens: 900,
              cache_read_input_tokens: 4000,
              cache_creation_input_tokens: 100,
              output_tokens: 300,
            },
          },
        },
      }),
      JSON.stringify({ custom_id: 'b', result: { type: 'errored', error: { status: 429 } } }),
    ].join('\n')

    const { fetch } = scriptedFetch([
      json({
        processing_status: 'ended',
        request_counts: { processing: 0 },
        results_url: 'https://example.test/results.jsonl',
      }),
      new Response(results, { status: 200 }),
    ])
    const provider = createAnthropicBatchProvider({ fetch, baseUrl: 'https://example.test' })

    const poll = await provider.poll(target, 'msgbatch_01', options)

    expect(poll.status).toBe('completed')
    expect(poll.results).toHaveLength(2)
    const [first, second] = poll.results
    expect(first?.outcome).toMatchObject({ kind: 'ok', text: '{"ok":true}', requestId: 'msg_1' })
    expect(second?.outcome).toMatchObject({ kind: 'error' })
  })

  it('answers a throttled poll with the wait the provider asked for', async () => {
    // Not a failed batch: the job upstream is untouched, and counting this against the poll
    // ceiling would abandon work that is still running.
    const { fetch } = scriptedFetch([
      json({ error: 'slow down' }, { status: 429, headers: { 'retry-after': '90' } }),
    ])
    const provider = createAnthropicBatchProvider({ fetch })

    const poll = await provider.poll(target, 'msgbatch_01', options)

    expect(poll).toMatchObject({ status: 'in_progress', retryAfterMs: 90_000 })
  })

  it('refuses to send the key to a results URL on another origin', async () => {
    // `results_url` comes out of the provider's own response and is fetched WITH the key
    // in a header. Anything that can answer as the batch endpoint would otherwise name a
    // host of its choosing and be handed the credential in one hop.
    const { fetch, calls } = scriptedFetch([
      json({
        processing_status: 'ended',
        request_counts: { processing: 0 },
        results_url: 'https://evil.test/results.jsonl',
      }),
    ])
    const provider = createAnthropicBatchProvider({ fetch, baseUrl: 'https://example.test' })

    await expect(provider.poll(target, 'msgbatch_01', options)).rejects.toThrow(
      /refusing to send the API key/,
    )
    // The status call and nothing else: the second fetch never happened.
    expect(calls).toHaveLength(1)
  })

  it('refuses a results URL that would put the key on the wire in clear', async () => {
    const { fetch } = scriptedFetch([
      json({
        processing_status: 'ended',
        request_counts: { processing: 0 },
        results_url: 'http://example.test/results.jsonl',
      }),
    ])
    const provider = createAnthropicBatchProvider({ fetch, baseUrl: 'https://example.test' })

    await expect(provider.poll(target, 'msgbatch_01', options)).rejects.toThrow(
      /refusing to send the API key/,
    )
  })

  it('treats a throttled results download as come-back-later, not a failed batch', async () => {
    // The batch has ended and its answers exist upstream, already paid for. A 429 here
    // that counted against the runner's poll-failure ceiling would eventually throw them
    // away.
    const { fetch } = scriptedFetch([
      json({
        processing_status: 'ended',
        request_counts: { processing: 0 },
        results_url: 'https://example.test/results.jsonl',
      }),
      json({ error: 'slow down' }, { status: 429, headers: { 'retry-after': '45' } }),
    ])
    const provider = createAnthropicBatchProvider({ fetch, baseUrl: 'https://example.test' })

    expect(await provider.poll(target, 'msgbatch_01', options)).toMatchObject({
      status: 'in_progress',
      retryAfterMs: 45_000,
    })
  })

  it('reports a batch that ended with nowhere to read as failed', async () => {
    const { fetch } = scriptedFetch([json({ processing_status: 'ended', request_counts: {} })])
    const provider = createAnthropicBatchProvider({ fetch })

    const poll = await provider.poll(target, 'msgbatch_01', options)
    expect(poll.status).toBe('failed')
    expect(poll.error).toBeInstanceOf(AiError)
  })
})

describe('parseResults', () => {
  it('maps every result type onto an outcome', () => {
    const jsonl = [
      JSON.stringify({ custom_id: 'ok', result: { type: 'succeeded', message: { content: [] } } }),
      JSON.stringify({ custom_id: 'gone', result: { type: 'expired' } }),
      JSON.stringify({ custom_id: 'stopped', result: { type: 'canceled' } }),
      JSON.stringify({
        custom_id: 'broken',
        result: { type: 'errored', error: { status: 400, error: { message: 'bad schema' } } },
      }),
    ].join('\n')

    const items = parseResults(jsonl, 'claude-sonnet-5')

    expect(items.map((item) => item.customId)).toEqual(['ok', 'gone', 'stopped', 'broken'])
    expect(items[1]?.outcome).toMatchObject({ kind: 'error', error: { code: 'aborted' } })
    expect(items[3]?.outcome).toMatchObject({ kind: 'error', error: { code: 'bad_request' } })
  })

  it('skips a malformed line rather than discarding the file', () => {
    // Thirty-nine paid-for answers must not be lost to one bad line; the missing id simply
    // never reconciles, which the runner already treats as "not done".
    const jsonl = [
      JSON.stringify({ custom_id: 'a', result: { type: 'succeeded', message: { content: [] } } }),
      '{ not json',
      JSON.stringify({ result: { type: 'succeeded' } }),
      '',
      JSON.stringify({ custom_id: 'b', result: { type: 'succeeded', message: { content: [] } } }),
    ].join('\n')

    expect(parseResults(jsonl, 'claude-sonnet-5').map((item) => item.customId)).toEqual(['a', 'b'])
  })

  it('reads input_tokens as the uncached count Anthropic reports', () => {
    // The 11x over-count `providers/usage.ts` warns about, on the batch path: cache reads are
    // reported separately, so treating `input_tokens` as a total bills them twice.
    const jsonl = JSON.stringify({
      custom_id: 'a',
      result: {
        type: 'succeeded',
        message: {
          content: [],
          usage: {
            input_tokens: 900,
            cache_read_input_tokens: 4000,
            cache_creation_input_tokens: 100,
            output_tokens: 300,
          },
        },
      },
    })

    const [item] = parseResults(jsonl, 'claude-sonnet-5')
    expect(item?.outcome.kind === 'ok' ? item.outcome.usage : undefined).toEqual({
      inputTokens: 900,
      cachedInputTokens: 4000,
      cacheWriteTokens: 100,
      outputTokens: 300,
      reasoningTokens: 0,
    })
  })
})

describe('cancel', () => {
  it('posts to the cancel endpoint', async () => {
    const { fetch, calls } = scriptedFetch([json({ processing_status: 'canceling' })])
    const provider = createAnthropicBatchProvider({ fetch, baseUrl: 'https://example.test' })

    await provider.cancel(target, 'msgbatch_01', options)

    expect(calls[0]?.url).toBe('https://example.test/v1/messages/batches/msgbatch_01/cancel')
    expect(calls[0]?.init.method).toBe('POST')
  })
})
