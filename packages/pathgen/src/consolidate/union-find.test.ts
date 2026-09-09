import { describe, expect, it } from 'vitest'
import { UnionFind } from './union-find'

describe('UnionFind', () => {
  it('starts with every index alone and joins sets once', () => {
    const sets = new UnionFind(4)
    expect(sets.groups()).toEqual([[0], [1], [2], [3]])
    expect(sets.union(0, 2)).toBe(true)
    expect(sets.union(2, 0)).toBe(false)
    expect(sets.union(3, 1)).toBe(true)
    expect(sets.union(1, 2)).toBe(true)
    expect(sets.groups()).toEqual([[0, 1, 2, 3]])
  })

  it('keeps the smallest index as the root and compresses paths', () => {
    const sets = new UnionFind(5)
    sets.union(4, 3)
    sets.union(3, 2)
    sets.union(2, 1)
    expect(sets.find(4)).toBe(1)
    expect(sets.find(4)).toBe(1)
    expect(sets.groups()).toEqual([[0], [1, 2, 3, 4]])
  })

  it('is empty for a size of zero', () => {
    expect(new UnionFind(0).groups()).toEqual([])
  })
})
