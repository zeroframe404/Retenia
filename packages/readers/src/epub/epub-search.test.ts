import { describe, expect, it } from 'vitest'
import { findMatchesInSection } from './epub-search'

describe('findMatchesInSection', () => {
  it('finds a case-insensitive match', () => {
    expect(findMatchesInSection('La consolidación de la memoria', 'CONSOLIDACIÓN')).toEqual([
      { charIndex: 3, length: 13 },
    ])
  })

  it('finds every occurrence', () => {
    expect(findMatchesInSection('ab ab ab', 'ab')).toEqual([
      { charIndex: 0, length: 2 },
      { charIndex: 3, length: 2 },
      { charIndex: 6, length: 2 },
    ])
  })

  it('returns nothing for an empty query or no match', () => {
    expect(findMatchesInSection('algún texto', '')).toEqual([])
    expect(findMatchesInSection('algún texto', 'nope')).toEqual([])
  })
})
