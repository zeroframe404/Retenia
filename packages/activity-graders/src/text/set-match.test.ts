import { describe, expect, it } from 'vitest'
import { setMatch } from './set-match'

/** `list_recall`'s FUZ set-match (`docs/spec/03-activities.md` §4 row 7). */
describe('setMatch()', () => {
  it('pairs each answer with at most one expected item, best similarity first', () => {
    const result = setMatch(
      ['Mercurio', 'venus', 'Marte', 'Plutón'],
      ['Mercurio', 'Venus', 'Tierra', 'Marte'],
    )
    expect(result.pairs.map((pair) => [pair.got, pair.expected])).toEqual([
      ['Mercurio', 'Mercurio'],
      ['venus', 'Venus'],
      ['Marte', 'Marte'],
    ])
    expect(result.precision).toBe(0.75)
    expect(result.recall).toBe(0.75)
    expect(result.f1).toBe(0.75)
    expect(result.unmatchedGot).toEqual(['Plutón'])
    expect(result.unmatchedExpected).toEqual(['Tierra'])
  })

  it('does not reuse a got or an expected item, and prefers exact over fuzzy', () => {
    const result = setMatch(['paris', 'parris'], ['París'])
    expect(result.pairs).toEqual([{ got: 'paris', expected: 'París', similarity: 1 }])
    expect(result.unmatchedGot).toEqual(['parris'])
    const duplicates = setMatch(['paris'], ['París', 'Paris'])
    expect(duplicates.pairs).toHaveLength(1)
    expect(duplicates.unmatchedExpected).toEqual(['Paris'])
  })

  it('is zero on either empty side', () => {
    expect(setMatch([], ['a'])).toMatchObject({ precision: 0, recall: 0, f1: 0 })
    expect(setMatch(['a'], [])).toMatchObject({ precision: 0, recall: 0, f1: 0 })
    expect(setMatch(['x'], ['y'])).toMatchObject({ precision: 0, recall: 0, f1: 0 })
  })
})
