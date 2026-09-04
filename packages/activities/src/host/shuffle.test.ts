import { describe, expect, it } from 'vitest'
import { createRng, hashSeed, listSeed, shuffleWithRng, shuffleWithSeed } from './shuffle'

const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

describe('deterministic shuffle', () => {
  it('gives the same order for the same seed', () => {
    expect(shuffleWithSeed(ITEMS, 'session-1')).toEqual(shuffleWithSeed(ITEMS, 'session-1'))
  })

  it('gives a different order for a different seed', () => {
    expect(shuffleWithSeed(ITEMS, 'session-1')).not.toEqual(shuffleWithSeed(ITEMS, 'session-2'))
  })

  it('is a permutation: same elements, no loss, no duplication', () => {
    const out = shuffleWithSeed(ITEMS, 'session-1')
    expect(out).toHaveLength(ITEMS.length)
    expect([...out].sort()).toEqual([...ITEMS].sort())
  })

  it('never mutates the input', () => {
    const input = [...ITEMS]
    shuffleWithSeed(input, 'session-1')
    expect(input).toEqual(ITEMS)
  })

  it('handles the degenerate lengths', () => {
    expect(shuffleWithSeed([], 'seed')).toEqual([])
    expect(shuffleWithSeed(['only'], 'seed')).toEqual(['only'])
  })

  it('namespaces lists so two lists of one activity are permuted differently', () => {
    const left = shuffleWithSeed(ITEMS, listSeed('s', 'act-1', 'left'))
    const right = shuffleWithSeed(ITEMS, listSeed('s', 'act-1', 'right'))
    expect(left).not.toEqual(right)
  })

  it('namespaces activities so two activities of one session are permuted differently', () => {
    const first = shuffleWithSeed(ITEMS, listSeed('s', 'act-1', 'options'))
    const second = shuffleWithSeed(ITEMS, listSeed('s', 'act-2', 'options'))
    expect(first).not.toEqual(second)
  })
})

describe('createRng', () => {
  it('is reproducible and stays inside [0, 1)', () => {
    const draw = (seed: string) => Array.from({ length: 50 }, createRng(seed))
    const first = draw('seed')
    expect(first).toEqual(draw('seed'))
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is not constant', () => {
    const rng = createRng('seed')
    expect(new Set([rng(), rng(), rng(), rng()]).size).toBeGreaterThan(1)
  })

  it('spreads roughly evenly over the unit interval', () => {
    const rng = createRng('distribution')
    const buckets = [0, 0, 0, 0]
    for (let index = 0; index < 4_000; index += 1) {
      const bucket = Math.min(3, Math.floor(rng() * 4))
      buckets[bucket] = (buckets[bucket] ?? 0) + 1
    }
    for (const count of buckets) expect(count).toBeGreaterThan(800)
  })

  it('accepts an injected rng, so a test can pin the permutation', () => {
    // Always drawing 0 makes Fisher-Yates swap every position with index 0, which rotates the
    // list: `abc` → `cba` (swap 2↔0) → `bca` (swap 1↔0).
    expect(shuffleWithRng(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a'])
  })
})

describe('hashSeed', () => {
  it('is stable, unsigned and different for different strings', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'))
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'))
    expect(hashSeed('')).toBeGreaterThanOrEqual(0)
  })
})
