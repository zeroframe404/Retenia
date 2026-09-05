import { describe, expect, it } from 'vitest'
import { diffChars } from './text-diff'

/**
 * `TextDiff` itself reads `useActivity()` for its labels, so it is exercised end to end through
 * `<ActivityHost/>` in `host/activity-host.test.tsx` (the near-miss case on a real `short_answer`
 * grade). What is worth testing in isolation is the alignment `diffChars` computes.
 */

describe('diffChars', () => {
  it('is a single equal token for identical strings', () => {
    expect(diffChars('París', 'París')).toEqual([{ type: 'equal', text: 'París' }])
  })

  it('is a single insert when the input is a prefix of the expected answer', () => {
    expect(diffChars('ab', 'abc')).toEqual([
      { type: 'equal', text: 'ab' },
      { type: 'insert', text: 'c' },
    ])
  })

  it('is a single delete when the expected answer is a prefix of the input', () => {
    expect(diffChars('abc', 'ab')).toEqual([
      { type: 'equal', text: 'ab' },
      { type: 'delete', text: 'c' },
    ])
  })

  it('marks an unambiguous middle substitution as one delete and one insert', () => {
    expect(diffChars('axc', 'abc')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'delete', text: 'x' },
      { type: 'insert', text: 'b' },
      { type: 'equal', text: 'c' },
    ])
  })

  it('merges consecutive tokens of the same kind into one', () => {
    expect(diffChars('xyc', 'abc')).toEqual([
      { type: 'delete', text: 'xy' },
      { type: 'insert', text: 'ab' },
      { type: 'equal', text: 'c' },
    ])
  })

  it('handles an empty input as all-insert, and an empty expected answer as all-delete', () => {
    expect(diffChars('', 'abc')).toEqual([{ type: 'insert', text: 'abc' }])
    expect(diffChars('abc', '')).toEqual([{ type: 'delete', text: 'abc' }])
    expect(diffChars('', '')).toEqual([])
  })

  it('reconstructs both original strings from the token stream', () => {
    const tokens = diffChars('Parxz', 'París')
    const got = tokens
      .filter((token) => token.type !== 'insert')
      .map((token) => token.text)
      .join('')
    const expected = tokens
      .filter((token) => token.type !== 'delete')
      .map((token) => token.text)
      .join('')
    expect(got).toBe('Parxz')
    expect(expected).toBe('París')
  })

  it('counts an astral character (surrogate pair) as one edit, not two', () => {
    expect(diffChars('a😀c', 'abc')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'delete', text: '😀' },
      { type: 'insert', text: 'b' },
      { type: 'equal', text: 'c' },
    ])
  })
})
