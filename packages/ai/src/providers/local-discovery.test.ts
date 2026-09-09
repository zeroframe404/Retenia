import { describe, expect, it } from 'vitest'
import type { FetchLike } from './local-discovery'
import { discoverLocalProvider } from './local-discovery'

function json(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

describe('discoverLocalProvider', () => {
  it("reads Ollama's /api/tags first", async () => {
    const fetchLike: FetchLike = async (url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags')
      return json({ models: [{ name: 'qwen3.5:9b' }, { name: 'gemma4:12b' }] })
    }
    const result = await discoverLocalProvider('http://127.0.0.1:11434', fetchLike)
    expect(result).toEqual({
      reachable: true,
      server: 'ollama',
      models: [{ id: 'qwen3.5:9b' }, { id: 'gemma4:12b' }],
    })
  })

  it('falls back to the OpenAI-compatible /v1/models when /api/tags is not there', async () => {
    const fetchLike: FetchLike = async (url) => {
      if (url.endsWith('/api/tags')) return json({}, false)
      expect(url).toBe('http://localhost:1234/v1/models')
      return json({ data: [{ id: 'local-model' }] })
    }
    const result = await discoverLocalProvider('http://localhost:1234', fetchLike)
    expect(result).toEqual({ reachable: true, server: 'lmstudio', models: [{ id: 'local-model' }] })
  })

  it('reports unreachable when nothing answers', async () => {
    const fetchLike: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const result = await discoverLocalProvider('http://127.0.0.1:11434', fetchLike)
    expect(result).toEqual({ reachable: false, server: 'unknown', models: [] })
  })

  it('reports unreachable on a non-ok response from both endpoints', async () => {
    const fetchLike: FetchLike = async () => json({}, false)
    const result = await discoverLocalProvider('http://127.0.0.1:11434', fetchLike)
    expect(result.reachable).toBe(false)
  })

  it('trims a trailing slash before building the probe URL', async () => {
    const fetchLike: FetchLike = async (url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags')
      return json({ models: [] })
    }
    await discoverLocalProvider('http://127.0.0.1:11434/', fetchLike)
  })
})
