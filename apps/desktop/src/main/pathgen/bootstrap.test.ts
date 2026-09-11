import type { AiClient, TextGenerator } from '@retenia/ai'
import type { AiGradeInput } from '@retenia/core'
import { describe, expect, it, vi } from 'vitest'
import { createLongTextGrader } from './bootstrap'

// `createLongTextGrader` logs a fallback through `../logging/log`, which pulls in Electron.
vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/**
 * `createLongTextGrader`'s own wiring: the real P10 prompt file (loaded from disk, the way
 * `loadPathgenPrompts()`'s own suite reads the other ten), bound to whatever `AiClient` the
 * caller hands in, on the role and temperature the prompt declares. Not a re-test of
 * `createAiLongTextGrader`'s grading logic, which `packages/activity-ai`'s own suite already
 * covers in full — this only has to prove the plumbing between the two is real.
 */

function fakeAiClient(textGenerator: TextGenerator): AiClient {
  return {
    textGenerator: vi.fn(() => textGenerator),
    structured: vi.fn(),
    ratesFor: vi.fn(async () => undefined),
  }
}

function gradeInput(overrides: Partial<AiGradeInput> = {}): AiGradeInput {
  return {
    activity: {
      id: '0192f000-0000-7000-8000-000000000001',
      type: 'essay_rubric',
      lang: 'es-AR',
      prompt: 'Explicá por qué la práctica espaciada supera al estudio masivo.',
    },
    answer: 'La práctica espaciada mejora la retención mediante repasos distribuidos.',
    rubric: [
      {
        id: 'c1',
        criterion: 'Mecanismo',
        levels: [
          { score: 0, description: 'No lo menciona.' },
          { score: 1, description: 'Lo explica.' },
        ],
      },
    ],
    ...overrides,
  }
}

describe('createLongTextGrader()', () => {
  it('binds the real P10 prompt to the given AiClient, on the role and temperature it declares', async () => {
    const textGenerator = vi.fn<TextGenerator>(async () => ({
      text: JSON.stringify({
        perCriterion: [{ id: 'c1', score: 1 }],
        score: 1,
        rating: 4,
        feedback: 'Muy completo.',
        uncertain: false,
        evidence: [],
      }),
      model: 'claude-sonnet-5',
    }))
    const client = fakeAiClient(textGenerator)

    const grader = createLongTextGrader(client)
    const result = await grader(gradeInput())

    // P10 runs on the mid ("smart") tier at temperature 0 — `grader.test.ts` pins the same
    // fact about the prompt file itself; this pins that `createLongTextGrader` actually reads
    // it rather than a hardcoded binding of its own.
    expect(client.textGenerator).toHaveBeenCalledWith({ role: 'smart', purpose: 'grade_long_text' })
    expect(textGenerator.mock.calls[0]?.[0]).toMatchObject({
      temperature: 0,
      schemaName: 'grade_long_text',
    })
    expect(result).toMatchObject({ engine: 'ai', score: 1, rating: 4, model: 'claude-sonnet-5' })
  })

  it('falls back to the deterministic estimate when the bound generator fails', async () => {
    const client = fakeAiClient(
      vi.fn<TextGenerator>(async () => {
        throw new Error('503 from the provider')
      }),
    )

    const result = await createLongTextGrader(client)(gradeInput())
    expect(result.engine).toBe('fake')
  })
})
