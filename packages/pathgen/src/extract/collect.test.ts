import { describe, expect, it } from 'vitest'
import { chunk, extraction, extractionJson, extractPrompt } from '../testing/extract-fixtures'
import { addUsage, usageOf, wasProviderCall, ZERO_USAGE } from '../usage'
import {
  postValidate,
  readExtractionRow,
  toExtractedChunk,
  toExtractionRow,
  validateExtraction,
} from './collect'

describe('validateExtraction()', () => {
  it('accepts a valid answer, with or without a code fence', () => {
    const text = extractionJson(['memoria de trabajo'])
    expect(validateExtraction(text)).toEqual({
      ok: true,
      value: extraction(['memoria de trabajo']),
    })
    expect(validateExtraction(`\`\`\`json\n${text}\n\`\`\``).ok).toBe(true)
  })

  it('rejects what is not JSON or not the schema, naming the issue', () => {
    expect(validateExtraction('not json')).toMatchObject({ ok: false })
    const wrong = validateExtraction(JSON.stringify({ concepts: 'nope' }))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.issues.join(' ')).toContain('concepts')
  })
})

describe('postValidate()', () => {
  it('keeps only the block ids the chunk covers, once each', () => {
    const output = extraction(['a'], {
      claims: [
        { text: 'Una afirmación', block_ids: ['b1', 'ghost', 'b1', 'b2'] },
        { text: 'Otra', block_ids: [] },
      ],
    })
    expect(postValidate(output, ['b1', 'b2']).claims.map((claim) => claim.block_ids)).toEqual([
      ['b1', 'b2'],
      [],
    ])
  })
})

describe('toExtractionRow() and readExtractionRow()', () => {
  it('maps a chunk and its answer onto the row, and reads it back', () => {
    const output = extraction(['memoria de trabajo', 'olvido'])
    const row = toExtractionRow({
      runId: 'run-1',
      chunk: chunk('c0', 0),
      customId: 'P1-abc',
      prompt: extractPrompt,
      provider: 'google',
      model: 'gemini-3.7-flash',
      output,
      usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, usd: 0.001 },
    })
    expect(row).toMatchObject({
      runId: 'run-1',
      sourceId: 'src-book',
      chunkId: 'c0',
      chunkKey: 'key-c0',
      chunkHash: 'hash-c0',
      customId: 'P1-abc',
      promptVersion: '1',
      provider: 'google',
      model: 'gemini-3.7-flash',
      conceptCount: 2,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      costUsd: 0.001,
    })
    expect(readExtractionRow(row)).toEqual(output)
    expect(readExtractionRow({ output: { concepts: 'nope' } })).toBeUndefined()
  })
})

describe('toExtractedChunk()', () => {
  it('carries the identity, the position and the block ids consolidation needs', () => {
    expect(toExtractedChunk(chunk('c3', 3))).toEqual({
      chunkId: 'c3',
      chunkKey: 'key-c3',
      sourceId: 'src-book',
      ordinal: 3,
      headingPath: 'Libro > Cap. 4',
      blockIds: ['c3-b1', 'c3-b2'],
    })
  })
})

describe('usage arithmetic', () => {
  it('reads what a result reports and defaults the rest to zero', () => {
    expect(usageOf(undefined)).toEqual(ZERO_USAGE)
    expect(usageOf({ inputTokens: 10, usd: 0.5 })).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cachedTokens: 0,
      usd: 0.5,
    })
    expect(
      addUsage(
        { inputTokens: 1, outputTokens: 2, cachedTokens: 3, usd: 4 },
        { inputTokens: 10, outputTokens: 20, cachedTokens: 30, usd: 40 },
      ),
    ).toEqual({ inputTokens: 11, outputTokens: 22, cachedTokens: 33, usd: 44 })
  })

  it('tells a provider call from a cache replay', () => {
    expect(wasProviderCall({ inputTokens: 5, usd: 0 })).toBe(true)
    expect(wasProviderCall({ usd: 0.01 })).toBe(true)
    expect(wasProviderCall({ usd: 0 })).toBe(false)
    expect(wasProviderCall(undefined)).toBe(false)
  })
})
