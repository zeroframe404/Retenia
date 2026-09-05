import { describe, expect, it } from 'vitest'
import { fuzzSeed, hashString, mulberry32, pickWithSeed, shuffleWithRng } from './prng'

describe('hashString (FNV-1a)', () => {
  it('reproduces the published test vectors', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).toBe(0xe40c292c)
    expect(hashString('foobar')).toBe(0xbf9cf968)
  })

  it('is an unsigned 32-bit integer and depends on the seed', () => {
    const hash = hashString('019a05a4-3fc0-7b39-9bf2-1abab07b14b1')
    expect(Number.isInteger(hash)).toBe(true)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThan(2 ** 32)
    expect(hashString('x', 1)).not.toBe(hashString('x', 2))
  })
})

describe('mulberry32', () => {
  it('is deterministic per seed and yields values in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const draws = Array.from({ length: 1000 }, () => a())
    expect(Array.from({ length: 1000 }, () => b())).toEqual(draws)
    for (const value of draws) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(new Set(draws).size).toBeGreaterThan(990)
  })

  it('differs between seeds and is roughly uniform', () => {
    const first = mulberry32(1)()
    expect(mulberry32(2)()).not.toBe(first)
    const random = mulberry32(2026)
    let sum = 0
    const buckets = new Array<number>(10).fill(0)
    for (let i = 0; i < 20_000; i++) {
      const value = random()
      sum += value
      buckets[Math.floor(value * 10)] = (buckets[Math.floor(value * 10)] as number) + 1
    }
    expect(Math.abs(sum / 20_000 - 0.5)).toBeLessThan(0.01)
    for (const count of buckets) expect(Math.abs(count - 2000)).toBeLessThan(200)
  })

  it('treats the seed as a 32-bit unsigned integer', () => {
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)())
    expect(mulberry32(2 ** 32 + 5)()).toBe(mulberry32(5)())
  })
})

describe('fuzzSeed', () => {
  it('changes with the card and with every review of it', () => {
    const id = '019a05a4-3fc0-7b39-9bf2-1abab07b14b1'
    expect(fuzzSeed(id, 0)).toBe(fuzzSeed(id, 0))
    expect(fuzzSeed(id, 0)).not.toBe(fuzzSeed(id, 1))
    expect(fuzzSeed(id, 0)).not.toBe(fuzzSeed('019a05a4-3fc0-7b39-9bf2-1abab07b14b2', 0))
  })
})

describe('shuffleWithRng', () => {
  it('returns a permutation without touching the input', () => {
    const items = [1, 2, 3, 4, 5]
    const shuffled = shuffleWithRng(items, mulberry32(7))
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5])
  })

  it('is deterministic for the same seed', () => {
    expect(shuffleWithRng([1, 2, 3, 4, 5], mulberry32(7))).toEqual(
      shuffleWithRng([1, 2, 3, 4, 5], mulberry32(7)),
    )
  })

  it('handles an empty list', () => {
    expect(shuffleWithRng([], mulberry32(1))).toEqual([])
  })
})

describe('pickWithSeed', () => {
  it('returns undefined when there is nothing to pick', () => {
    expect(pickWithSeed([], 'seed')).toBeUndefined()
  })

  it('picks the same item for the same seed and a different one for another', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    expect(pickWithSeed(items, 'seed-1')).toBe(pickWithSeed(items, 'seed-1'))
    const picks = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => pickWithSeed(items, s)))
    expect(picks.size).toBeGreaterThan(1)
  })
})
