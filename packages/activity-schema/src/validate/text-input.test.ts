import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleTextInput } from '../testing/samples'
import { isValidRegex, validateTextInput } from './text-input'

const codes = (activity: Activity<'text_input'>) =>
  validateTextInput(activity).map((issue) => issue.code)
const patch = (
  payload: Partial<Activity<'text_input'>['payload']>,
  rest: Partial<Activity<'text_input'>> = {},
): Activity<'text_input'> => {
  const base = sampleTextInput()
  return { ...base, ...rest, payload: { ...base.payload, ...payload } }
}

describe('validateTextInput()', () => {
  it('passes the sample', () => {
    expect(codes(sampleTextInput())).toEqual([])
  })

  it('text-input-kind-mismatch: each type fixes its input kind', () => {
    expect(codes(patch({ inputKind: 'number' }))).toEqual([
      'text-input-kind-mismatch',
      'numeric-block-required',
    ])
    expect(codes(patch({ inputKind: 'letters' }))).toEqual([])
    const numeric = patch(
      { inputKind: 'text', answers: [{ value: '42' }] },
      {
        type: 'numeric_answer',
        grading: { method: 'det' },
        review: { eligible: true, ratingStrategy: 'objective' },
      },
    )
    expect(codes(numeric)).toEqual(['text-input-kind-mismatch'])
  })

  it('numeric-block-required: a number answer needs payload.numeric', () => {
    const numeric = (payload: Partial<Activity<'text_input'>['payload']>) =>
      patch(
        { inputKind: 'number', answers: [{ value: '42' }], ...payload },
        {
          type: 'numeric_answer',
          grading: { method: 'det' },
          review: { eligible: true, ratingStrategy: 'objective' },
        },
      )
    expect(codes(numeric({}))).toEqual(['numeric-block-required'])
    expect(codes(numeric({ numeric: { value: 42 } }))).toEqual([])
  })

  it('regex-invalid and regex-cases-misplaced', () => {
    expect(codes(patch({ answers: [{ value: '(unclosed', isRegex: true }] }))).toEqual([
      'regex-invalid',
    ])
    expect(codes(patch({ answers: [{ value: '^par[ií]s$', isRegex: true }] }))).toEqual([])
    expect(codes(patch({ regexCases: [{ input: 'a', shouldMatch: true }] }))).toEqual([
      'regex-cases-misplaced',
    ])
    const regex = patch(
      {
        inputKind: 'regex',
        answers: [{ value: '^a+$', isRegex: true }],
        regexCases: [{ input: 'aa', shouldMatch: true }],
      },
      {
        type: 'regex_task',
        grading: { method: 'det' },
        review: { eligible: true, ratingStrategy: 'partial' },
      },
    )
    expect(codes(regex)).toEqual([])
    expect(isValidRegex('[')).toBe(false)
  })

  it('answer-in-prompt: a plain answer in the prompt warns; a regex answer is not checked', () => {
    expect(codes(patch({}, { prompt: '¿Es París la capital?' }))).toEqual(['answer-in-prompt'])
    expect(
      codes(
        patch(
          { answers: [{ value: 'París', isRegex: true }] },
          { prompt: '¿Es París la capital?' },
        ),
      ),
    ).toEqual([])
  })
})
