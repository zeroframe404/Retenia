import { mulberry32 } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { damerauLevenshtein, relativeDistance } from './distance'

const random = mulberry32(0xd15)
const randomWord = () => {
  const letters = 'abcdeé😀'
  let out = ''
  const length = Math.floor(random() * 10)
  for (let i = 0; i < length; i++) out += [...letters][Math.floor(random() * 7)]
  return out
}

describe('damerauLevenshtein()', () => {
  it('matches the textbook values', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3)
    expect(damerauLevenshtein('ca', 'ac')).toBe(1)
    expect(damerauLevenshtein('abcd', 'acbd')).toBe(1)
    expect(damerauLevenshtein('', 'abc')).toBe(3)
    expect(damerauLevenshtein('paris', 'parris')).toBe(1)
    expect(damerauLevenshtein('café', 'cafe')).toBe(1)
    expect(damerauLevenshtein('😀a', 'a😀')).toBe(1)
  })

  it('is a metric: zero on itself, symmetric, bounded, triangle inequality', () => {
    for (let i = 0; i < 1000; i++) {
      const a = randomWord()
      const b = randomWord()
      const c = randomWord()
      expect(damerauLevenshtein(a, a)).toBe(0)
      expect(damerauLevenshtein(a, b)).toBe(damerauLevenshtein(b, a))
      expect(damerauLevenshtein(a, b)).toBeLessThanOrEqual(Math.max([...a].length, [...b].length))
      expect(damerauLevenshtein(a, c)).toBeLessThanOrEqual(
        damerauLevenshtein(a, b) + damerauLevenshtein(b, c),
      )
      const relative = relativeDistance(a, b)
      expect(relative).toBeGreaterThanOrEqual(0)
      expect(relative).toBeLessThanOrEqual(1)
    }
  })
})

describe('relativeDistance()', () => {
  it('divides by the longer length and is 0 for two empty strings', () => {
    expect(relativeDistance('', '')).toBe(0)
    expect(relativeDistance('abc', '')).toBe(1)
    expect(relativeDistance('paris', 'parris')).toBeCloseTo(1 / 6, 10)
  })
})
