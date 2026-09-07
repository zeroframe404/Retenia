import { describe, expect, it } from 'vitest'
import { findMatches, stepMatch } from './pdf-search'

describe('findMatches', () => {
  it('finds a case-insensitive match on the right page', () => {
    const pageTexts = new Map([
      [1, 'La consolidación de la memoria ocurre durante el sueño.'],
      [2, 'El efecto de espaciamiento distribuye los repasos.'],
    ])
    expect(findMatches(pageTexts, 'ESPACIAMIENTO')).toEqual([
      { page: 2, charIndex: 13, length: 13 },
    ])
  })

  it('finds every occurrence, including overlapping-adjacent ones, in reading order', () => {
    const pageTexts = new Map([
      [3, 'ab ab ab'],
      [1, 'ab'],
    ])
    const matches = findMatches(pageTexts, 'ab')
    expect(matches.map((m) => m.page)).toEqual([1, 3, 3, 3])
    expect(matches.filter((m) => m.page === 3).map((m) => m.charIndex)).toEqual([0, 3, 6])
  })

  it('returns nothing for an empty or whitespace-only query', () => {
    const pageTexts = new Map([[1, 'some text']])
    expect(findMatches(pageTexts, '')).toEqual([])
    expect(findMatches(pageTexts, '   ')).toEqual([])
  })

  it('returns nothing when no page contains the query', () => {
    const pageTexts = new Map([[1, 'some text']])
    expect(findMatches(pageTexts, 'nope')).toEqual([])
  })
})

describe('stepMatch', () => {
  it('advances and wraps forward', () => {
    expect(stepMatch(3, 0, 1)).toBe(1)
    expect(stepMatch(3, 2, 1)).toBe(0)
  })

  it('advances and wraps backward', () => {
    expect(stepMatch(3, 0, -1)).toBe(2)
    expect(stepMatch(3, 1, -1)).toBe(0)
  })

  it('starts at 0 from -1 (no current match) going forward', () => {
    expect(stepMatch(3, -1, 1)).toBe(0)
  })

  it('returns -1 when there are no matches', () => {
    expect(stepMatch(0, -1, 1)).toBe(-1)
  })
})
