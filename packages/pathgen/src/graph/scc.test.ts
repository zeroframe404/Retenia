import { describe, expect, it } from 'vitest'
import { stronglyConnectedComponents } from './scc'

function graph(edges: ReadonlyArray<readonly [string, string]>, extra: readonly string[] = []) {
  const ids = new Set<string>(extra)
  const next = new Map<string, string[]>()
  for (const [from, to] of edges) {
    ids.add(from)
    ids.add(to)
    next.set(from, [...(next.get(from) ?? []), to])
  }
  return {
    ids: [...ids],
    successors: (id: string): readonly string[] => next.get(id) ?? [],
  }
}

describe('stronglyConnectedComponents()', () => {
  it('returns nothing for an empty graph', () => {
    expect(stronglyConnectedComponents([], () => [])).toEqual([])
  })

  it('makes every node of a chain its own component, ordered by id', () => {
    const g = graph([
      ['c', 'b'],
      ['b', 'a'],
    ])
    expect(stronglyConnectedComponents(g.ids, g.successors)).toEqual([['a'], ['b'], ['c']])
  })

  it('groups a single cycle and sorts its members', () => {
    const g = graph([
      ['x', 'y'],
      ['y', 'z'],
      ['z', 'x'],
    ])
    expect(stronglyConnectedComponents(g.ids, g.successors)).toEqual([['x', 'y', 'z']])
  })

  it('keeps two cycles apart and orders components by their smallest id', () => {
    const g = graph([
      ['m', 'n'],
      ['n', 'm'],
      ['a', 'b'],
      ['b', 'a'],
      ['n', 'a'],
    ])
    expect(stronglyConnectedComponents(g.ids, g.successors)).toEqual([
      ['a', 'b'],
      ['m', 'n'],
    ])
  })

  it('merges two cycles that share a node into one component', () => {
    const g = graph([
      ['a', 'b'],
      ['b', 'a'],
      ['b', 'c'],
      ['c', 'b'],
    ])
    expect(stronglyConnectedComponents(g.ids, g.successors)).toEqual([['a', 'b', 'c']])
  })

  it('does not depend on the order the ids or the edges were given in', () => {
    const forward = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
      ['c', 'd'],
    ])
    const backward = graph([
      ['c', 'd'],
      ['c', 'a'],
      ['b', 'c'],
      ['a', 'b'],
    ])
    const one = stronglyConnectedComponents([...forward.ids].reverse(), forward.successors)
    const two = stronglyConnectedComponents(backward.ids, backward.successors)
    expect(one).toEqual(two)
    expect(one).toEqual([['a', 'b', 'c'], ['d']])
  })

  it('ignores a successor outside the node set instead of visiting it', () => {
    const g = graph([['a', 'ghost']])
    expect(stronglyConnectedComponents(['a'], g.successors)).toEqual([['a']])
  })

  it('handles a 2,000-node chain without recursion', () => {
    const edges: Array<readonly [string, string]> = []
    for (let i = 0; i < 2_000; i += 1) {
      edges.push([`n${String(i).padStart(4, '0')}`, `n${String(i + 1).padStart(4, '0')}`])
    }
    const g = graph(edges)
    const components = stronglyConnectedComponents(g.ids, g.successors)
    expect(components).toHaveLength(2_001)
    expect(components[0]).toEqual(['n0000'])
  })
})
