import { mulberry32 } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { adjacentPairsScore, exactScore, kendallTau, positionScore } from './metrics'

const random = mulberry32(0x0bde)
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}
const key = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`)

describe('ordering metrics', () => {
  it('exactScore accepts any key', () => {
    expect(exactScore(['a', 'b'], [['a', 'b']])).toBe(1)
    expect(
      exactScore(
        ['b', 'a'],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    ).toBe(1)
    expect(exactScore(['a', 'b', 'c'], [['a', 'b']])).toBe(0)
    expect(exactScore(['b', 'a'], [['a', 'b']])).toBe(0)
  })

  it('adjacentPairsScore counts consecutive pairs in the right relative order', () => {
    expect(adjacentPairsScore(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual({
      score: 1,
      outOfOrder: 0,
    })
    expect(adjacentPairsScore(['a', 'c', 'b', 'd'], ['a', 'b', 'c', 'd'])).toEqual({
      score: 2 / 3,
      outOfOrder: 1,
    })
    expect(adjacentPairsScore(['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd'])).toEqual({
      score: 0,
      outOfOrder: 3,
    })
    // A distractor breaks both pairs it takes part in; a missing item leaves a pair uncounted.
    expect(adjacentPairsScore(['a', 'x', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual({
      score: 2 / 3,
      outOfOrder: 1,
    })
    expect(adjacentPairsScore(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual({
      score: 1 / 3,
      outOfOrder: 2,
    })
    expect(adjacentPairsScore([], ['a'])).toEqual({ score: 1, outOfOrder: 0 })
  })

  it('kendallTau is 1 on the key, −1 on its reverse, and penalizes missing items', () => {
    expect(kendallTau(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual({
      tau: 1,
      concordant: 6,
      discordant: 0,
    })
    expect(kendallTau(['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd'])).toEqual({
      tau: -1,
      concordant: 0,
      discordant: 6,
    })
    expect(kendallTau(['a', 'c', 'b', 'd'], ['a', 'b', 'c', 'd']).tau).toBeCloseTo(4 / 6, 10)
    expect(kendallTau([], ['a', 'b']).tau).toBe(-1)
    expect(kendallTau(['a'], ['a']).tau).toBe(1)
  })

  it('positionScore is the fraction of positions holding the right item', () => {
    expect(positionScore(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1)
    expect(positionScore(['a', 'c', 'b'], ['a', 'b', 'c'])).toBeCloseTo(1 / 3, 10)
    expect(positionScore(['x', 'a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0)
    expect(positionScore([], [])).toBe(1)
  })

  it('property: bounds and identities over random permutations', () => {
    for (let i = 0; i < 1000; i++) {
      const n = 2 + Math.floor(random() * 11)
      const items = key(n)
      const order = shuffled(items)
      const { tau } = kendallTau(order, items)
      expect(tau).toBeGreaterThanOrEqual(-1)
      expect(tau).toBeLessThanOrEqual(1)
      expect((tau + 1) / 2).toBeGreaterThanOrEqual(0)
      expect((tau + 1) / 2).toBeLessThanOrEqual(1)
      expect(kendallTau(items, items).tau).toBe(1)
      expect(kendallTau([...items].reverse(), items).tau).toBe(-1)
      const adjacent = adjacentPairsScore(order, items)
      expect(adjacent.score).toBeGreaterThanOrEqual(0)
      expect(adjacent.score).toBeLessThanOrEqual(1)
      expect(adjacent.outOfOrder).toBeLessThanOrEqual(n - 1)
      expect(adjacent.outOfOrder).toBeGreaterThanOrEqual(0)
      const position = positionScore(order, items)
      expect(position).toBeGreaterThanOrEqual(0)
      expect(position).toBeLessThanOrEqual(1)
      // One adjacent swap is exactly one pair out of order.
      const swapAt = Math.floor(random() * (n - 1))
      const swapped = [...items]
      ;[swapped[swapAt], swapped[swapAt + 1]] = [
        swapped[swapAt + 1] as string,
        swapped[swapAt] as string,
      ]
      expect(adjacentPairsScore(swapped, items).outOfOrder).toBe(1)
    }
  })
})
