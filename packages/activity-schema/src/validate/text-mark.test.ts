import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleTextMark } from '../testing/samples'
import { validateTextMark } from './text-mark'

const codes = (correctIds: string[]): string[] => {
  const base: Activity<'text_mark'> = sampleTextMark()
  return validateTextMark({ ...base, payload: { ...base.payload, correctIds } }).map(
    (issue) => issue.code,
  )
}

describe('validateTextMark()', () => {
  it('passes the sample', () => {
    expect(validateTextMark(sampleTextMark())).toEqual([])
  })

  it('token-unknown, text-mark-correct-duplicate and text-mark-all-correct', () => {
    expect(codes(['t3', 't9'])).toEqual(['token-unknown'])
    expect(codes(['t3', 't3'])).toEqual(['text-mark-correct-duplicate'])
    expect(codes(['t1', 't2', 't3', 't4', 't5'])).toEqual(['text-mark-all-correct'])
  })
})
