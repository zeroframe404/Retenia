import { describe, expect, it } from 'vitest'
import { countTokensByChars, createCl100kTokenCounter, createTokenCounter } from './tokenizer'

const SPANISH =
  'La práctica de recuperación produce memorias más duraderas que volver a leer el mismo texto.'

describe('countTokensByChars', () => {
  it('is ceil(chars / 4)', () => {
    expect(countTokensByChars('')).toBe(0)
    expect(countTokensByChars('abcd')).toBe(1)
    expect(countTokensByChars('abcde')).toBe(2)
  })

  it('is monotonic in length, which is what the chunker relies on', () => {
    let previous = 0
    for (let length = 0; length < 200; length += 7) {
      const tokens = countTokensByChars('x'.repeat(length))
      expect(tokens).toBeGreaterThanOrEqual(previous)
      previous = tokens
    }
  })
})

describe('createCl100kTokenCounter', () => {
  it('counts the same text the way the API bills it', async () => {
    const count = await createCl100kTokenCounter()
    // The exact number is the point of using it at all, so it is asserted, not bounded.
    expect(count('hello world')).toBe(2)
    expect(count('')).toBe(0)
  })

  it('lands within a quarter of the heuristic on Spanish prose', async () => {
    const count = await createCl100kTokenCounter()
    const exact = count(SPANISH)
    const approximate = countTokensByChars(SPANISH)
    // The heuristic is what the specs' own cost estimates use; this pins how far off it is,
    // so a change to `CHARS_PER_TOKEN` has to be argued for rather than slipped in.
    expect(Math.abs(exact - approximate) / exact).toBeLessThan(0.25)
  })
})

describe('createTokenCounter', () => {
  it('builds either counter by id', async () => {
    expect(await createTokenCounter('chars4')).toBe(countTokensByChars)
    expect((await createTokenCounter('cl100k'))('hello world')).toBe(2)
  })
})
