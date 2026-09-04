import type { Activity } from '@retenia/activity-schema'
import { sampleTextInput } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { GraderUnsupportedError } from '../errors'
import { gradeTextInput } from './text-input'

const META = { timeMs: 3000, attempts: 1, hintsUsed: 0 }
const numeric = (
  payload: Partial<Activity<'text_input'>['payload']>,
  grading: Activity<'text_input'>['grading'] = { method: 'det' },
): Activity<'text_input'> => ({
  ...sampleTextInput(),
  type: 'numeric_answer',
  grading,
  review: { eligible: true, ratingStrategy: 'objective' },
  payload: {
    family: 'text_input',
    inputKind: 'number',
    answers: [{ value: '42' }],
    numeric: { value: 42 },
    ...payload,
  },
})

describe('gradeTextInput()', () => {
  it('says "Close" for a near miss below the threshold and reports the engine', () => {
    const strict = {
      ...sampleTextInput(),
      grading: {
        method: 'fuzzy' as const,
        fuzzy: { maxRelativeEditDistance: 0.1, ignoreDiacritics: true, caseSensitive: false },
      },
    }
    const graded = gradeTextInput(strict, { value: 'Parris' }, META)
    expect(graded).toMatchObject({
      correct: false,
      feedback: 'Close — expected «París».',
      meta: { engine: 'fuzzy' },
    })
    expect(graded.score).toBeCloseTo(5 / 6, 10)
    expect(gradeTextInput(sampleTextInput(), { value: 'París' }, META).meta.engine).toBe('exact')
    expect(gradeTextInput(sampleTextInput(), { value: 'Roma' }, META).feedback).toBe(
      'Incorrect — expected «París».',
    )
  })

  it('numbers: tolerance from the payload, then from grading.numeric; literal fallback; no numeric block', () => {
    expect(gradeTextInput(numeric({}), { value: '42' }, META)).toMatchObject({
      score: 1,
      correct: true,
      meta: { engine: 'numeric' },
    })
    expect(
      gradeTextInput(
        numeric({ numeric: { value: 42, tol: { abs: 1, rel: 0 } } }),
        { value: '43' },
        META,
      ).score,
    ).toBe(1)
    expect(
      gradeTextInput(
        numeric({}, { method: 'det', numeric: { absTol: 0, relTol: 0.1, units: ['unidades'] } }),
        { value: '45 unidades' },
        META,
      ).score,
    ).toBe(1)
    expect(
      gradeTextInput(numeric({ numeric: { value: 42, unit: 'km' } }), { value: '42000 m' }, META)
        .score,
    ).toBe(1)
    expect(
      gradeTextInput(
        numeric({ answers: [{ value: 'cuarenta y dos' }] }),
        { value: 'Cuarenta y dos' },
        META,
      ).score,
    ).toBe(1)
    expect(
      gradeTextInput(numeric({ answers: [{ value: '42', isRegex: true }] }), { value: 'x' }, META)
        .score,
    ).toBe(0)
    expect(gradeTextInput(numeric({ numeric: undefined }), { value: '42' }, META)).toMatchObject({
      score: 1,
      correct: true,
    })
    expect(gradeTextInput(numeric({ numeric: undefined }), { value: '43' }, META).score).toBe(0)
  })

  it('regex: the user writes the pattern; cases decide the score', () => {
    const regex = (cases?: { input: string; shouldMatch: boolean }[]): Activity<'text_input'> => ({
      ...sampleTextInput(),
      type: 'regex_task',
      grading: { method: 'det' },
      review: { eligible: true, ratingStrategy: 'partial' },
      payload: {
        family: 'text_input',
        inputKind: 'regex',
        answers: [{ value: '^a+$', isRegex: true }],
        ...(cases ? { regexCases: cases } : {}),
      },
    })
    const cases = [
      { input: 'aaa', shouldMatch: true },
      { input: 'b', shouldMatch: false },
      { input: '', shouldMatch: false },
    ]
    expect(gradeTextInput(regex(cases), { value: '^a+$' }, META)).toMatchObject({
      score: 1,
      correct: true,
      meta: { engine: 'regex' },
    })
    expect(gradeTextInput(regex(cases), { value: 'a*' }, META).score).toBeCloseTo(1 / 3, 10)
    expect(gradeTextInput(regex(cases), { value: '(' }, META).score).toBe(0)
    expect(gradeTextInput(regex(), { value: '^a+$' }, META).score).toBe(0)
  })

  it('letters behave like text; math is not graded here', () => {
    const letters = {
      ...sampleTextInput(),
      payload: { ...sampleTextInput().payload, inputKind: 'letters' as const },
    }
    expect(gradeTextInput(letters, { value: 'paris' }, META).correct).toBe(true)
    const math: Activity<'text_input'> = {
      ...sampleTextInput(),
      type: 'expression_input',
      grading: { method: 'cas' },
      review: { eligible: true, ratingStrategy: 'objective' },
      payload: { family: 'text_input', inputKind: 'math', answers: [{ value: 'x^2' }] },
    }
    expect(() => gradeTextInput(math, { value: 'x^2' }, META)).toThrow(GraderUnsupportedError)
  })
})
