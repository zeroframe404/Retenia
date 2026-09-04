import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import type { ChoiceSet } from '../families/choice'
import { sampleChoice } from '../testing/samples'
import { validateChoice } from './choice'

const codes = (activity: Activity<'choice'>) => validateChoice(activity).map((issue) => issue.code)
const set = (overrides: Partial<ChoiceSet> = {}): ChoiceSet => ({
  ...(sampleChoice().payload.sets[0] as ChoiceSet),
  ...overrides,
})
const withSets = (
  sets: ChoiceSet[],
  overrides: Partial<Activity<'choice'>> = {},
): Activity<'choice'> => {
  const base = sampleChoice()
  return { ...base, ...overrides, payload: { ...base.payload, sets, ...(overrides.payload ?? {}) } }
}

/** §11: "exactly 1 correct answer in `mcq_single`" and the rest of the choice shape. */
describe('validateChoice()', () => {
  it('passes the sample', () => {
    expect(codes(sampleChoice())).toEqual([])
  })

  it('choice-single-correct-count: a single-choice set has exactly one correct option', () => {
    const options = set().options.map((o) => ({ ...o, correct: o.id !== 'c' }))
    expect(codes(withSets([set({ options })]))).toEqual(['choice-single-correct-count'])
    expect(
      codes(withSets([set({ options: options.map((o) => ({ ...o, correct: false })) })])),
    ).toEqual(['choice-single-correct-count'])
  })

  it('choice-multi-correct-count and choice-all-correct on multiple-response sets', () => {
    const multi = (correct: boolean[]) =>
      set({
        multiple: true,
        options: set().options.map((o, i) => ({ ...o, correct: correct[i] ?? false })),
      })
    expect(
      codes(
        withSets([multi([true, true, false])], {
          type: 'mcq_multi',
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual([])
    expect(
      codes(
        withSets([multi([false, false, false])], {
          type: 'mcq_multi',
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual(['choice-multi-correct-count'])
    expect(
      codes(
        withSets([multi([true, true, true])], {
          type: 'mcq_multi',
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual(['choice-all-correct'])
  })

  it('choice-set-count: one set for a question, at least two for a burst', () => {
    expect(codes(withSets([set(), set({ id: 's2' })]))).toEqual(['choice-set-count'])
    expect(
      codes(
        withSets([set()], {
          type: 'statement_set',
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual(['choice-set-count'])
    expect(
      codes(
        withSets([set(), set({ id: 's2' })], {
          type: 'statement_set',
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual([])
  })

  it('choice-multiple-flag: the type fixes the flag', () => {
    expect(codes(withSets([set({ multiple: true })]))).toEqual(['choice-multiple-flag'])
    expect(
      codes(
        withSets([set()], {
          type: 'mcq_multi',
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual(['choice-multiple-flag'])
  })

  it('choice-option-count: true_false has two options', () => {
    const tf = withSets(
      [
        set({
          options: [
            { id: 't', text: 'Verdadero', correct: true },
            { id: 'f', text: 'Falso', correct: false },
          ],
        }),
      ],
      { type: 'true_false' },
    )
    expect(codes(tf)).toEqual([])
    expect(codes(withSets([set()], { type: 'true_false' }))).toEqual(['choice-option-count'])
  })

  it('choice-select-range: a single-choice set selects one; ranges stay within the options', () => {
    expect(codes(withSets([set({ minSelect: 2 })]))).toEqual(['choice-select-range'])
    expect(codes(withSets([set({ minSelect: 1, maxSelect: 1 })]))).toEqual([])
    const multi = set({
      multiple: true,
      options: set().options.map((o, i) => ({ ...o, correct: i < 2 })),
    })
    const type = {
      type: 'mcq_multi' as const,
      review: { eligible: true, ratingStrategy: 'partial' as const },
    }
    expect(codes(withSets([{ ...multi, maxSelect: 4 }], type))).toEqual(['choice-select-range'])
    expect(codes(withSets([{ ...multi, minSelect: 3, maxSelect: 2 }], type))).toEqual([
      'choice-select-range',
    ])
    expect(codes(withSets([{ ...multi, minSelect: 1, maxSelect: 3 }], type))).toEqual([])
  })

  it('choice-confidence-required: confidence_mcq asks for certainty', () => {
    const cbm = withSets([set()], { type: 'confidence_mcq' })
    expect(codes(cbm)).toEqual(['choice-confidence-required'])
    expect(codes({ ...cbm, payload: { ...cbm.payload, askConfidence: true } })).toEqual([])
  })

  it('answer-in-prompt: the correct option text in the prompt or a stem is a warning', () => {
    const leaked = withSets([set({ stem: 'París, ¿sí o no?' })], { prompt: 'Capital: París?' })
    const issues = validateChoice(leaked)
    expect(issues.map((issue) => issue.code)).toEqual(['answer-in-prompt', 'answer-in-prompt'])
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
  })
})
