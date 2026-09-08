import type { TextGenerationRequest, TextGenerationResult } from '@retenia/ai'
import { loadPrompt } from '@retenia/ai/prompts'
import { describe, expect, it, vi } from 'vitest'
import { makeSourceDoc, paragraph } from '../../test/make-source-doc'
import type { ChunkDraft } from '../chunking'
import { chunkSourceDoc } from '../chunking'
import { contextualizeChunks, normalizeContext } from './contextualize'
import { describeDocument } from './document-context'
import type { DocumentContext } from './task'

const PROMPT = loadPrompt('contextualize').template

function fixture(): { chunks: ChunkDraft[]; document: DocumentContext } {
  const doc = makeSourceDoc({
    title: 'Memoria y repaso',
    sections: [
      { title: 'Capítulo 1', blocks: [{ text: paragraph(300, 'uno') }] },
      { title: 'Capítulo 2', blocks: [{ text: paragraph(300, 'dos') }] },
    ],
  })
  const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })
  return { chunks, document: describeDocument(doc, chunks) }
}

function generator(
  reply: (request: TextGenerationRequest, call: number) => Promise<TextGenerationResult>,
) {
  let call = 0
  const seen: TextGenerationRequest[] = []
  const fn = async (request: TextGenerationRequest): Promise<TextGenerationResult> => {
    seen.push(request)
    call += 1
    return reply(request, call)
  }
  return { fn, seen }
}

const ok = (text: string): TextGenerationResult => ({
  text,
  model: 'fake-cheap',
  usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, usd: 0.001 },
})

describe('normalizeContext', () => {
  it('strips a code fence, a label and the line breaks', () => {
    expect(normalizeContext('```\nContexto: Del capítulo 3,\nsobre la curva.\n```')).toBe(
      'Del capítulo 3, sobre la curva.',
    )
  })

  it('truncates a model that ignored the length instruction', () => {
    const context = normalizeContext('x'.repeat(2_000))
    expect(context.length).toBeLessThanOrEqual(601)
    expect(context.endsWith('…')).toBe(true)
  })

  it('is empty for an empty answer, so nothing is stored', () => {
    expect(normalizeContext('   \n  ')).toBe('')
  })
})

describe('contextualizeChunks', () => {
  it('asks once per chunk, at temperature 0, and returns the contexts in input order', async () => {
    const { chunks, document } = fixture()
    const { fn, seen } = generator(async (_request, call) => ok(`Contexto ${call}`))

    const result = await contextualizeChunks(chunks, {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
      concurrency: 1,
    })

    expect(seen).toHaveLength(chunks.length)
    expect(seen.every((request) => request.temperature === 0)).toBe(true)
    expect(result.contexts.map((entry) => entry.chunkKey)).toEqual(chunks.map((chunk) => chunk.key))
    expect(result.failures).toEqual([])
    expect(result.usage.usd).toBeCloseTo(0.001 * chunks.length, 10)
  })

  it('puts the prompt file in `system` and the document + chunk in `prompt`', async () => {
    const { chunks, document } = fixture()
    const { fn, seen } = generator(async () => ok('Contexto'))

    await contextualizeChunks(chunks.slice(0, 1), {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
    })

    const request = seen[0] as TextGenerationRequest
    expect(request.system).toContain('You situate a fragment')
    expect(request.system).not.toContain('{{task}}')
    expect(request.prompt).toContain('<document')
    expect(request.prompt).toContain('<chunk')
    expect(request.prompt).toContain(chunks[0]?.text.slice(0, 40) as string)
  })

  it('keys each call so a resumed run does not pay twice', async () => {
    const { chunks, document } = fixture()
    const { fn, seen } = generator(async () => ok('Contexto'))

    await contextualizeChunks(chunks, {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
      promptVersion: '1',
    })

    expect(seen.map((request) => request.idempotencyKey)).toEqual(
      chunks.map((chunk) => `contextualize:1:src:${chunk.key}`),
    )
    // The key is a function of the chunk, so two runs agree.
    const second = generator(async () => ok('Contexto'))
    await contextualizeChunks(chunks, {
      textGenerator: second.fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
      promptVersion: '1',
    })
    expect(second.seen.map((request) => request.idempotencyKey)).toEqual(
      seen.map((request) => request.idempotencyKey),
    )
  })

  it('reports a failed chunk and keeps going', async () => {
    const { chunks, document } = fixture()
    const { fn } = generator(async (_request, call) => {
      if (call === 1) throw new Error('429 rate limited')
      return ok('Contexto')
    })

    const result = await contextualizeChunks(chunks, {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
      concurrency: 1,
    })

    expect(result.failures).toEqual([{ chunkKey: chunks[0]?.key, error: '429 rate limited' }])
    expect(result.contexts).toHaveLength(chunks.length - 1)
  })

  it('drops an empty answer rather than storing a blank context', async () => {
    const { chunks, document } = fixture()
    const { fn } = generator(async () => ok('   '))

    const result = await contextualizeChunks(chunks, {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
    })

    expect(result.contexts).toEqual([])
    expect(result.failures).toEqual([])
  })

  it('stops on an aborted signal without starting the rest', async () => {
    const { chunks, document } = fixture()
    const controller = new AbortController()
    const { fn, seen } = generator(async () => {
      controller.abort()
      return ok('Contexto')
    })

    await contextualizeChunks(chunks, {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
      concurrency: 1,
      signal: controller.signal,
    })

    expect(seen).toHaveLength(1)
  })

  it('reports progress as it goes', async () => {
    const { chunks, document } = fixture()
    const { fn } = generator(async () => ok('Contexto'))
    const onProgress = vi.fn()

    await contextualizeChunks(chunks, {
      textGenerator: fn,
      promptTemplate: PROMPT,
      document,
      sourceId: 'src',
      concurrency: 1,
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(chunks.length)
    expect(onProgress).toHaveBeenLastCalledWith(chunks.length, chunks.length)
  })
})
