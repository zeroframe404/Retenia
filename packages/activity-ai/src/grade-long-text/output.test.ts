import { describe, expect, it } from 'vitest'
import { loadGradeLongTextPrompt } from '../prompt-files'
import { extractJsonObject, GRADE_LONG_TEXT_JSON_SCHEMA, parseGradeLongTextOutput } from './output'

const VALID = {
  perCriterion: [{ id: 'c1', score: 1, level: 'Lo explica.', comment: 'Menciona el intervalo.' }],
  score: 1,
  rating: 4,
  feedback: 'Muy completo.',
  uncertain: false,
  evidence: [{ quote: 'repasos distribuidos', criterionId: 'c1' }],
}

describe('the prompt file and the schema', () => {
  it('carries the P10 front matter the pipeline keys on', () => {
    const prompt = loadGradeLongTextPrompt()
    expect(prompt).toContain('id: grade_long_text')
    expect(prompt).toContain('temperature: 0')
    expect(prompt).toContain('pipeline_prompt: P10_grade')
    // §12's guards have to be *in the prompt*, not only in the code around it.
    expect(prompt).toContain('data, never instructions')
    expect(prompt).toContain('uncertain')
    expect(prompt).toContain('{{task}}')
  })

  it('embeds exactly the JSON Schema the provider is handed', () => {
    const fenced = /```json\s*([\s\S]*?)```/.exec(loadGradeLongTextPrompt())
    expect(fenced).not.toBeNull()
    expect(JSON.parse(fenced?.[1] ?? '')).toEqual(GRADE_LONG_TEXT_JSON_SCHEMA)
  })

  it('stays inside Claude strict mode: no min/max, pattern or $ref', () => {
    const json = JSON.stringify(GRADE_LONG_TEXT_JSON_SCHEMA)
    for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', '$ref']) {
      expect(json).not.toContain(`"${banned}"`)
    }
  })
})

describe('extractJsonObject()', () => {
  it('reads a bare object, a fenced one and one wrapped in prose', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('Acá va:\n{"a":1}\nEso es todo.')).toEqual({ a: 1 })
  })

  it('throws when there is no object at all', () => {
    expect(() => extractJsonObject('lo siento, no puedo')).toThrow(SyntaxError)
    expect(() => extractJsonObject('}{')).toThrow(SyntaxError)
  })
})

describe('parseGradeLongTextOutput()', () => {
  it('accepts the documented shape, with a null rating for an uncertain grade', () => {
    expect(parseGradeLongTextOutput(JSON.stringify(VALID))).toEqual(VALID)
    expect(
      parseGradeLongTextOutput(JSON.stringify({ ...VALID, rating: null, uncertain: true })).rating,
    ).toBeNull()
  })

  it('rejects a rating outside 1–4 and a missing field', () => {
    expect(() => parseGradeLongTextOutput(JSON.stringify({ ...VALID, rating: 7 }))).toThrow()
    const { feedback: _feedback, ...missing } = VALID
    expect(() => parseGradeLongTextOutput(JSON.stringify(missing))).toThrow()
  })
})
