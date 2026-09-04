import { describe, expect, it } from 'vitest'
import { mean, plural, result } from './shared'

describe('shared helpers', () => {
  it('result() clamps the score and defaults the rating', () => {
    const meta = { timeMs: 1, attempts: 1, hintsUsed: 0 }
    expect(result(meta, { score: 1.2, correct: true, feedback: '' })).toEqual({
      score: 1,
      correct: true,
      feedback: '',
      rating: null,
      meta,
    })
    expect(
      result(meta, { score: -0.1, correct: false, feedback: 'x', rating: 2, perItem: [] }),
    ).toMatchObject({ score: 0, rating: 2, perItem: [] })
  })
  it('mean() of nothing is 0; plural() picks the form', () => {
    expect(mean([])).toBe(0)
    expect(mean([1, 0])).toBe(0.5)
    expect(plural(1, 'pair')).toBe('1 pair')
    expect(plural(2, 'pair')).toBe('2 pairs')
    expect(plural(3, 'match', 'matches')).toBe('3 matches')
  })
})
