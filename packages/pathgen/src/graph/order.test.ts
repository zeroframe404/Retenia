import { describe, expect, it } from 'vitest'
import {
  chain,
  compareNumbers,
  comparePrimary,
  compareStrings,
  minPrimary,
  NO_POSITION,
  sortedBy,
  sourceRank,
} from './order'

describe('compareStrings()', () => {
  it('orders by code unit, never by locale', () => {
    expect(compareStrings('Z', 'a')).toBe(-1)
    expect(compareStrings('a', 'Z')).toBe(1)
    expect(compareStrings('é', 'z')).toBe(1)
    expect(compareStrings('same', 'same')).toBe(0)
    expect(['b', 'a', 'B'].sort(compareStrings)).toEqual(['B', 'a', 'b'])
  })
})

describe('compareNumbers()', () => {
  it('orders ascending and treats Infinity as larger than anything finite', () => {
    expect(compareNumbers(1, 2)).toBe(-1)
    expect(compareNumbers(2, 1)).toBe(1)
    expect(compareNumbers(3, 3)).toBe(0)
    expect(compareNumbers(1e9, Number.POSITIVE_INFINITY)).toBe(-1)
    expect(compareNumbers(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('sourceRank()', () => {
  it('ranks the primary source first, the rest in order, and unknown sources last', () => {
    const sources = ['primary', 'second']
    expect(sourceRank('primary', sources)).toBe(0)
    expect(sourceRank('second', sources)).toBe(1)
    expect(sourceRank('dropped', sources)).toBe(2)
  })
})

describe('comparePrimary() and minPrimary()', () => {
  it('compares rank first, then ordinal', () => {
    expect(comparePrimary([0, 9], [1, 0])).toBe(-1)
    expect(comparePrimary([1, 0], [0, 9])).toBe(1)
    expect(comparePrimary([0, 2], [0, 5])).toBe(-1)
    expect(comparePrimary([0, 5], [0, 5])).toBe(0)
  })

  it('finds the earliest position, and the sentinel when there is none', () => {
    expect(
      minPrimary([
        [1, 0],
        [0, 7],
        [0, 3],
      ]),
    ).toEqual([0, 3])
    expect(minPrimary([])).toBe(NO_POSITION)
    expect(minPrimary([NO_POSITION])).toBe(NO_POSITION)
  })
})

describe('chain() and sortedBy()', () => {
  it('lets the first deciding comparator win and falls through on ties', () => {
    const byLength = (a: string, b: string) => compareNumbers(a.length, b.length)
    const compare = chain<string>(byLength, compareStrings)
    expect(compare('bb', 'a')).toBe(1)
    expect(compare('ab', 'aa')).toBe(1)
    expect(compare('x', 'x')).toBe(0)
  })

  it('sorts a copy and leaves the input alone', () => {
    const input = ['c', 'a', 'b']
    expect(sortedBy(input, compareStrings)).toEqual(['a', 'b', 'c'])
    expect(input).toEqual(['c', 'a', 'b'])
  })
})
