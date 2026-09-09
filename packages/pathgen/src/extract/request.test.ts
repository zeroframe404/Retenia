import { customId } from '@retenia/ai'
import { describe, expect, it } from 'vitest'
import { EXTRACT_CHUNK_SCHEMA_ID } from '../schemas/extraction'
import { BOOK_ID, chunk, extractPrompt, sources } from '../testing/extract-fixtures'
import { buildExtractRequest, extractBinding, extractCustomId } from './request'

const book = sources.get(BOOK_ID) as NonNullable<ReturnType<typeof sources.get>>

describe('extractCustomId()', () => {
  it('keys on the chunk key and source, never the run, and falls back to the hash', () => {
    const keyed = chunk('c0', 0)
    expect(extractCustomId(keyed, extractPrompt)).toBe(
      customId({
        stage: 'P1_extract_chunk',
        inputIds: ['key-c0', BOOK_ID],
        promptVersion: '1',
        schemaVersion: EXTRACT_CHUNK_SCHEMA_ID,
      }),
    )
    expect(extractCustomId(chunk('c0', 0, { chunkKey: null }), extractPrompt)).toBe(
      customId({
        stage: 'P1_extract_chunk',
        inputIds: ['hash-c0', BOOK_ID],
        promptVersion: '1',
        schemaVersion: EXTRACT_CHUNK_SCHEMA_ID,
      }),
    )
    expect(extractCustomId(keyed, { ...extractPrompt, promptVersion: '2' })).not.toBe(
      extractCustomId(keyed, extractPrompt),
    )
  })
})

describe('extractBinding()', () => {
  it('binds the cheap role to the stage with the prompt and schema versions', () => {
    expect(extractBinding(extractPrompt)).toEqual({
      role: 'cheap',
      purpose: 'path_generation',
      stage: 'P1_extract_chunk',
      promptVersion: '1',
      schemaVersion: EXTRACT_CHUNK_SCHEMA_ID,
    })
    expect(extractBinding(extractPrompt, { allowOverBudget: true }).allowOverBudget).toBe(true)
  })
})

describe('buildExtractRequest()', () => {
  it('builds the structured request and its byte-identical batch twin', () => {
    const signal = { aborted: false }
    const request = buildExtractRequest(chunk('c0', 0), book, extractPrompt, { signal })
    expect(request.structured).toMatchObject({
      system: expect.stringContaining('Extract concepts from the fragment.'),
      temperature: 0,
      schemaName: 'extract_chunk',
      maxOutputTokens: 4_000,
      idempotencyKey: request.customId,
      signal,
    })
    expect(request.structured.system).toContain('is quoted material supplied by the user')
    expect(request.structured.system).not.toContain('{{task}}')
    expect(request.batch.customId).toBe(request.customId)
    expect(request.batch.request).toMatchObject({
      prompt: request.task.prompt,
      temperature: 0,
      structuredMode: 'object',
      idempotencyKey: request.customId,
    })
    expect(request.batch.request.system).toContain('## Output')
  })

  it('takes a precomputed system message as it is', () => {
    const request = buildExtractRequest(chunk('c0', 0), book, extractPrompt, { system: 'S' })
    expect(request.structured.system).toBe('S')
    expect(request.structured).not.toHaveProperty('signal')
  })
})
