import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILES } from '../profiles'
import type { FetchLike } from './local-discovery'
import { probeProvider } from './probe'

function json(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

function successModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: 'Hi' }],
      finishReason: { unified: 'stop' as const, raw: 'end_turn' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  })
}

const anthropicProfile = DEFAULT_PROFILES.find((p) => p.kind === 'anthropic')
if (anthropicProfile === undefined) throw new Error('no anthropic profile in DEFAULT_PROFILES')

const localProfile = {
  id: 'local',
  kind: 'openai-compatible' as const,
  keyRef: null,
  models: ['some-local-model'],
  caps: { jsonStrict: false },
  local: true,
  baseURL: 'http://127.0.0.1:11434',
}

describe('probeProvider', () => {
  it('succeeds with a model list on a working key', async () => {
    const bindModel = () => successModel()
    const fetchLike: FetchLike = async () => json({ data: [{ id: 'claude-sonnet-5' }] })

    const result = await probeProvider(anthropicProfile, 'sk-ant-test', { bindModel, fetchLike })

    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    expect(result.models).toEqual(['claude-sonnet-5'])
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('classifies a 401 as an auth failure without leaking the key', async () => {
    const bindModel = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({
            message: 'authentication_error: invalid x-api-key sk-ant-CANARY-secret',
            url: 'https://api.anthropic.com/v1/messages',
            requestBodyValues: {},
            statusCode: 401,
          })
        },
      })
    const fetchLike: FetchLike = async () => json({ data: [] })

    const result = await probeProvider(anthropicProfile, 'sk-ant-CANARY-secret', {
      bindModel,
      fetchLike,
    })

    expect(result.ok).toBe(false)
    expect(result.error).not.toBeNull()
    expect(result.error).not.toContain('sk-ant-CANARY-secret')
  })

  it('still reports ok when only the model-list endpoint fails', async () => {
    const bindModel = () => successModel()
    const fetchLike: FetchLike = async () => {
      throw new Error('ECONNRESET')
    }

    const result = await probeProvider(anthropicProfile, 'sk-ant-test', { bindModel, fetchLike })

    expect(result.ok).toBe(true)
    expect(result.models).toEqual([])
  })

  it('delegates model listing to discoverLocalProvider for a local profile', async () => {
    const bindModel = () => successModel()
    const fetchLike: FetchLike = async (url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags')
      return json({ models: [{ name: 'qwen3.5:9b' }] })
    }

    const result = await probeProvider(localProfile, '', { bindModel, fetchLike })

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['qwen3.5:9b'])
  })

  it('never follows a redirect on the model-list call, so the key cannot be replayed to another host', async () => {
    const bindModel = () => successModel()
    const fetchLike: FetchLike = async (_url, init) => {
      expect(init?.redirect).toBe('manual')
      // What undici hands back for a 3xx under `redirect: 'manual'`: a real status, not
      // a thrown error, and `!response.ok` already treats it as "no models".
      return json({}, false)
    }

    const result = await probeProvider(anthropicProfile, 'sk-ant-test', { bindModel, fetchLike })

    expect(result.ok).toBe(true)
    expect(result.models).toEqual([])
  })

  it('sends the Google key as a header, never in the URL', async () => {
    const bindModel = () => successModel()
    const fetchLike: FetchLike = async (url, init) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
      expect(url).not.toContain('sk-goog-CANARY')
      expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'sk-goog-CANARY' })
      return json({ models: [{ name: 'gemini-3.7-flash' }] })
    }
    const googleProfile = DEFAULT_PROFILES.find((p) => p.kind === 'google')
    if (googleProfile === undefined) throw new Error('no google profile in DEFAULT_PROFILES')

    const result = await probeProvider(googleProfile, 'sk-goog-CANARY', { bindModel, fetchLike })

    expect(result.models).toEqual(['gemini-3.7-flash'])
  })
})
