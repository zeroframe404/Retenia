import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import type { ClozeSegment } from '../families/cloze'
import { sampleCloze } from '../testing/samples'
import { validateCloze } from './cloze'

const codes = (activity: Activity<'cloze'>) => validateCloze(activity).map((issue) => issue.code)
const patch = (
  payload: Partial<Activity<'cloze'>['payload']>,
  rest: Partial<Activity<'cloze'>> = {},
): Activity<'cloze'> => {
  const base = sampleCloze()
  return { ...base, ...rest, payload: { ...base.payload, ...payload } }
}
const dropdown = {
  type: 'cloze_dropdown' as const,
  grading: { method: 'det' as const },
  review: { eligible: true, ratingStrategy: 'partial' as const },
}
const wordbank = {
  type: 'cloze_wordbank' as const,
  grading: { method: 'det' as const },
  review: { eligible: true, ratingStrategy: 'partial' as const },
}

/** §11: "every gap referenced" — answerable gaps and a consistent bank. */
describe('validateCloze()', () => {
  it('passes the sample', () => {
    expect(codes(sampleCloze())).toEqual([])
  })

  it('cloze-no-gaps and cloze-mode-mismatch', () => {
    expect(codes(patch({ segments: [{ kind: 'text', text: 'Sin huecos.' }] }))).toEqual([
      'cloze-no-gaps',
    ])
    expect(codes(patch({ mode: 'dropdown' }))).toEqual([
      'cloze-mode-mismatch',
      'cloze-gap-options-required',
    ])
  })

  it('cloze-gap-options-required and cloze-gap-answer-not-in-options for dropdowns', () => {
    const gap = (options?: string[]): ClozeSegment[] => [
      { kind: 'text', text: 'Capital: ' },
      { kind: 'gap', id: 'g1', answers: ['París'], ...(options ? { options } : {}) },
    ]
    expect(codes(patch({ mode: 'dropdown', segments: gap() }, dropdown))).toEqual([
      'cloze-gap-options-required',
    ])
    expect(codes(patch({ mode: 'dropdown', segments: gap(['París']) }, dropdown))).toEqual([
      'cloze-gap-options-required',
    ])
    expect(codes(patch({ mode: 'dropdown', segments: gap(['Lyon', 'Roma']) }, dropdown))).toEqual([
      'cloze-gap-answer-not-in-options',
    ])
    expect(codes(patch({ mode: 'dropdown', segments: gap(['paris', 'Roma']) }, dropdown))).toEqual(
      [],
    )
    // Typed gaps may carry options (as a hint list) without the membership rule.
    expect(codes(patch({ segments: gap(['Lyon', 'Roma']) }))).toEqual([])
  })

  it('cloze-distractor-is-answer for the word bank', () => {
    expect(
      codes(patch({ mode: 'wordbank', bankDistractors: ['Lyon', 'PARÍS'] }, wordbank)),
    ).toEqual(['cloze-distractor-is-answer'])
    expect(codes(patch({ mode: 'wordbank', bankDistractors: ['Lyon'] }, wordbank))).toEqual([])
  })

  it('cloze-adjacent-gaps and cloze-gap-answer-leak are warnings', () => {
    const adjacent: ClozeSegment[] = [
      { kind: 'gap', id: 'g1', answers: ['a1b'] },
      { kind: 'gap', id: 'g2', answers: ['c2d'] },
    ]
    const issues = validateCloze(patch({ segments: adjacent }))
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['cloze-adjacent-gaps', 'warning'],
    ])
    const leak: ClozeSegment[] = [
      { kind: 'text', text: 'París es la capital: ' },
      { kind: 'gap', id: 'g1', answers: ['París'] },
    ]
    expect(codes(patch({ segments: leak }))).toEqual(['cloze-gap-answer-leak'])
  })

  it('answer-in-prompt when a gap answer is in the prompt', () => {
    expect(codes(patch({}, { prompt: 'Completá: la capital es París' }))).toEqual([
      'answer-in-prompt',
    ])
  })
})
