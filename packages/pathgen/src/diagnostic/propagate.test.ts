import { describe, expect, it } from 'vitest'
import { makeSyntheticPath, seededRandom } from '../testing/synthetic-learners'
import { propagationTargets, withinHops } from './propagate'
import { DEFAULT_TUNING, type ModuleGraph } from './types'

const adjacency = (edges: Readonly<Record<string, readonly string[]>>) =>
  new Map(Object.entries(edges))

const makeGraph = (
  parents: Readonly<Record<string, readonly string[]>>,
  children: Readonly<Record<string, readonly string[]>>,
): ModuleGraph => ({
  modules: Object.keys(parents).map((id, ordinal) => ({
    id,
    sectionId: 'S',
    ordinal,
    importance: 0.5,
    conceptIds: [],
  })),
  parents: adjacency(parents),
  children: adjacency(children),
  depth: new Map(),
})

describe('withinHops()', () => {
  it('returns the minimum hop distance when a module is reachable at more than one length', () => {
    // a -> b, a -> d, b -> d: d is 1 hop directly, not 2 hops via b.
    const graph = adjacency({ a: ['b', 'd'], b: ['d'], d: [] })
    const hops = withinHops(graph, 'a')
    expect(hops.get('b')).toBe(1)
    expect(hops.get('d')).toBe(1)
  })

  it('treats a module absent from the adjacency map as having no neighbours', () => {
    const graph = adjacency({ a: ['b'] }) // 'b' has no entry at all
    const hops = withinHops(graph, 'a')
    expect([...hops.entries()]).toEqual([['b', 1]])
  })

  it('never includes the origin, even through a cycle back to it', () => {
    const graph = adjacency({ a: ['b'], b: ['a'] })
    const hops = withinHops(graph, 'a')
    expect(hops.has('a')).toBe(false)
    expect(hops.get('b')).toBe(1)
  })

  it('stops at two hops: a three-hop ancestor is untouched', () => {
    const graph = adjacency({ a: ['b'], b: ['c'], c: ['e'], e: [] })
    const hops = withinHops(graph, 'a')
    expect(hops.get('b')).toBe(1)
    expect(hops.get('c')).toBe(2)
    expect(hops.has('e')).toBe(false)
  })

  it('respects a custom maxHops', () => {
    const graph = adjacency({ a: ['b'], b: ['c'], c: [] })
    expect([...withinHops(graph, 'a', 1).keys()]).toEqual(['b'])
  })
})

describe('propagationTargets()', () => {
  const graph = makeGraph({ A: [], B: ['A'], C: [] }, { A: ['B'], B: [], C: [] })

  it('spreads a positive Δθ to ancestors (parents) only', () => {
    const targets = propagationTargets(graph, 'B', 0.4, DEFAULT_TUNING.hopFactors)
    expect(targets).toEqual([{ moduleId: 'A', hop: 1, delta: 0.4 * DEFAULT_TUNING.hopFactors[0] }])
  })

  it('spreads a negative Δθ to descendants (children) only', () => {
    const targets = propagationTargets(graph, 'A', -0.4, DEFAULT_TUNING.hopFactors)
    expect(targets).toEqual([{ moduleId: 'B', hop: 1, delta: -0.4 * DEFAULT_TUNING.hopFactors[0] }])
  })

  it('propagates nothing for Δθ = 0', () => {
    expect(propagationTargets(graph, 'A', 0, DEFAULT_TUNING.hopFactors)).toEqual([])
  })

  it('scales hop 1 by hopFactors[0] and hop 2 by hopFactors[1]', () => {
    // A <- B <- C (parents), so a positive Δθ on C reaches B at hop 1, A at hop 2.
    const chain = makeGraph({ A: [], B: ['A'], C: ['B'] }, { A: ['B'], B: ['C'], C: [] })
    const targets = propagationTargets(chain, 'C', 1, DEFAULT_TUNING.hopFactors)
    expect(targets).toEqual(
      expect.arrayContaining([
        { moduleId: 'B', hop: 1, delta: DEFAULT_TUNING.hopFactors[0] },
        { moduleId: 'A', hop: 2, delta: DEFAULT_TUNING.hopFactors[1] },
      ]),
    )
    expect(targets).toHaveLength(2)
  })

  it('never propagates more than half of |Δθ|, over random synthetic DAGs', () => {
    const random = seededRandom(7)
    for (let trial = 0; trial < 50; trial++) {
      const path = makeSyntheticPath(random, 10 + Math.floor(random() * 15))
      const module = path.graph.modules[Math.floor(random() * path.graph.modules.length)]
      const delta = (random() - 0.5) * 4
      const targets = propagationTargets(
        path.graph,
        (module as (typeof path.graph.modules)[number]).id,
        delta,
        DEFAULT_TUNING.hopFactors,
      )
      for (const target of targets) {
        expect(Math.abs(target.delta)).toBeLessThanOrEqual(0.5 * Math.abs(delta) + 1e-9)
      }
    }
  })
})
