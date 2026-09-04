import { describe, expect, it } from 'vitest'
import { matchText } from './match'

/** The FUZ chain of `docs/spec/03-activities.md` §10: normalize → exact → synonyms → regex → distance. */
describe('matchText()', () => {
  it('exact after normalization', () => {
    expect(matchText('  PARÍS ', ['París'])).toEqual({
      matched: true,
      similarity: 1,
      via: 'exact',
      best: 'París',
    })
    expect(matchText('paris', ['París'], { ignoreDiacritics: false }).via).toBe('fuzzy')
    expect(matchText('Paris', ['París'], { caseSensitive: true }).via).toBe('exact')
    expect(matchText('PARIS', ['París'], { caseSensitive: true })).toMatchObject({
      matched: false,
      via: 'none',
    })
  })

  it('synonym groups that contain an expected answer', () => {
    const synonyms = [
      ['Estados Unidos', 'EE. UU.', 'USA'],
      ['Reino Unido', 'UK'],
    ]
    expect(matchText('usa', ['Estados Unidos'], { synonyms })).toEqual({
      matched: true,
      similarity: 1,
      via: 'synonym',
      best: 'Estados Unidos',
    })
    // A group that does not include the expected answer is not a licence to match its members.
    expect(matchText('UK', ['Estados Unidos'], { synonyms }).via).toBe('none')
    expect(matchText('Canadá', ['Estados Unidos'], { synonyms }).via).toBe('none')
  })

  it('regular expressions against the raw and the normalized input; invalid ones are skipped', () => {
    expect(
      matchText('The United States', ['EE. UU.'], { regexes: ['^the united states$'] }).via,
    ).toBe('regex')
    expect(matchText('París', ['x'], { regexes: ['^paris$'] }).via).toBe('regex')
    expect(matchText('Paris', ['x'], { regexes: ['^Paris$'] })).toMatchObject({
      matched: true,
      via: 'regex',
      best: '^Paris$',
    })
    expect(matchText('Paris', ['x'], { regexes: ['(unclosed'] }).via).toBe('none')
  })

  it('relative edit distance with the 0.2 default and a custom threshold', () => {
    expect(matchText('Parris', ['París'])).toMatchObject({
      matched: true,
      via: 'fuzzy',
      best: 'París',
    })
    expect(matchText('Parris', ['París']).similarity).toBeCloseTo(5 / 6, 10)
    expect(matchText('Parris', ['París'], { maxRelativeEditDistance: 0.1 })).toMatchObject({
      matched: false,
      via: 'none',
    })
    expect(matchText('Parris', ['París'], { maxRelativeEditDistance: 0 }).matched).toBe(false)
    expect(matchText('Parrs', ['París'], { maxRelativeEditDistance: 0.4 }).matched).toBe(true)
    // 1/5 = 0.2 matches; 2/5 does not.
    expect(matchText('parix', ['paris']).matched).toBe(true)
    expect(matchText('parxx', ['paris']).matched).toBe(false)
  })

  it('picks the closest of several expected answers', () => {
    const match = matchText('Bogotá', ['Lima', 'Bogota', 'Quito'])
    expect(match).toEqual({ matched: true, similarity: 1, via: 'exact', best: 'Bogota' })
    const near = matchText('Bogotaa', ['Lima', 'Bogotá', 'Quito'])
    expect(near.best).toBe('Bogotá')
    expect(near.matched).toBe(true)
  })

  it('handles empty input and an empty expected list', () => {
    expect(matchText('', ['París'])).toMatchObject({ matched: false, similarity: 0, via: 'none' })
    expect(matchText('x', [])).toEqual({ matched: false, similarity: 0, via: 'none' })
  })
})
