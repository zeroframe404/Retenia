import { describe, expect, it } from 'vitest'
import { buildModuleGraph, DEFAULT_MODULE_IMPORTANCE, type ModuleGraphInput } from './module-graph'

const section = (id: string, modules: ModuleGraphInput['sections'][number]['modules']) => ({
  id,
  modules,
})
const concept = (concept_id: string, importance: number) => ({ concept_id, importance })
const edge = (from: string, to: string, kind: string, confidence: number) => ({
  from,
  to,
  kind,
  confidence,
})

describe('buildModuleGraph()', () => {
  it('lifts a PREREQ_OF edge between concepts to an edge between their modules', () => {
    const graph = buildModuleGraph({
      sections: [
        section('S1', [{ id: 'M1', conceptIds: ['a'] }]),
        section('S2', [{ id: 'M2', conceptIds: ['b'] }]),
      ],
      concepts: [concept('a', 0.5), concept('b', 0.5)],
      edges: [edge('a', 'b', 'PREREQ_OF', 0.9)],
    })
    expect(graph.parents.get('M2')).toEqual(['M1'])
    expect(graph.children.get('M1')).toEqual(['M2'])
    expect(graph.parents.get('M1')).toEqual([])
    expect(graph.children.get('M2')).toEqual([])
  })

  it('ignores RELATED_TO and PART_OF edges', () => {
    const graph = buildModuleGraph({
      sections: [
        section('S1', [{ id: 'M1', conceptIds: ['a'] }]),
        section('S2', [{ id: 'M2', conceptIds: ['b'] }]),
      ],
      concepts: [concept('a', 0.5), concept('b', 0.5)],
      edges: [edge('a', 'b', 'RELATED_TO', 0.9), edge('a', 'b', 'PART_OF', 0.9)],
    })
    expect(graph.parents.get('M2')).toEqual([])
    expect(graph.children.get('M1')).toEqual([])
  })

  it('ignores an edge between two concepts homed in the same module', () => {
    const graph = buildModuleGraph({
      sections: [section('S1', [{ id: 'M1', conceptIds: ['a', 'b'] }])],
      concepts: [concept('a', 0.5), concept('b', 0.5)],
      edges: [edge('a', 'b', 'PREREQ_OF', 0.9)],
    })
    expect(graph.parents.get('M1')).toEqual([])
    expect(graph.children.get('M1')).toEqual([])
  })

  it('ignores an edge to a concept not homed in any module', () => {
    const graph = buildModuleGraph({
      sections: [section('S1', [{ id: 'M1', conceptIds: ['a'] }])],
      concepts: [concept('a', 0.5)],
      edges: [edge('a', 'zzz', 'PREREQ_OF', 0.9)],
    })
    expect(graph.modules).toHaveLength(1)
    expect(graph.parents.get('M1')).toEqual([])
    expect(graph.children.get('M1')).toEqual([])
  })

  it('keeps the strongest confidence of parallel lifted edges', () => {
    // M1 -> M2 lifts twice (0.2 and 0.9); M2 -> M1 lifts once (0.5). If the weaker of the
    // two M1->M2 lifts were kept instead, breakCycles would drop M1->M2 (0.2 < 0.5) and keep
    // M2->M1; keeping the strongest (0.9) instead drops M2->M1.
    const graph = buildModuleGraph({
      sections: [
        section('S1', [{ id: 'M1', conceptIds: ['a1', 'a2'] }]),
        section('S2', [{ id: 'M2', conceptIds: ['b1', 'b2'] }]),
      ],
      concepts: [concept('a1', 0.5), concept('a2', 0.5), concept('b1', 0.5), concept('b2', 0.5)],
      edges: [
        edge('a1', 'b1', 'PREREQ_OF', 0.2),
        edge('a2', 'b2', 'PREREQ_OF', 0.9),
        edge('b1', 'a1', 'PREREQ_OF', 0.5),
      ],
    })
    expect(graph.parents.get('M2')).toEqual(['M1'])
    expect(graph.parents.get('M1')).toEqual([])
  })

  it('breaks a lifted two-cycle by dropping the weaker module edge', () => {
    const graph = buildModuleGraph({
      sections: [
        section('S1', [{ id: 'M1', conceptIds: ['a'] }]),
        section('S2', [{ id: 'M2', conceptIds: ['b'] }]),
      ],
      concepts: [concept('a', 0.5), concept('b', 0.5)],
      edges: [edge('a', 'b', 'PREREQ_OF', 0.9), edge('b', 'a', 'PREREQ_OF', 0.3)],
    })
    expect(graph.parents.get('M2')).toEqual(['M1'])
    expect(graph.parents.get('M1')).toEqual([])
  })

  it('computes depth as the longest path, over a diamond followed by a long chain', () => {
    // M1 -> {M2, M3} -> M4 (diamond, depth 2) -> M5 -> M6 -> M7 -> M8 (chain to depth 6).
    const chain = [
      ['M1', 'M2'],
      ['M1', 'M3'],
      ['M2', 'M4'],
      ['M3', 'M4'],
      ['M4', 'M5'],
      ['M5', 'M6'],
      ['M6', 'M7'],
      ['M7', 'M8'],
    ]
    const ids = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']
    const concepts = ids.map((id) => concept(`${id}.c`, 0.5))
    const graph = buildModuleGraph({
      sections: [
        section(
          'S1',
          ids.map((id) => ({ id, conceptIds: [`${id}.c`] })),
        ),
      ],
      concepts,
      edges: chain.map(([from, to]) => edge(`${from}.c`, `${to}.c`, 'PREREQ_OF', 0.9)),
    })
    expect(graph.depth.get('M1')).toBe(0)
    expect(graph.depth.get('M2')).toBe(1)
    expect(graph.depth.get('M3')).toBe(1)
    expect(graph.depth.get('M4')).toBe(2)
    expect(graph.depth.get('M5')).toBe(3)
    expect(graph.depth.get('M6')).toBe(4)
    expect(graph.depth.get('M7')).toBe(5)
    expect(graph.depth.get('M8')).toBe(6)
  })

  it('sorts parents and children by module ordinal, not by edge insertion order', () => {
    const graph = buildModuleGraph({
      sections: [
        section('S1', [
          { id: 'M1', conceptIds: ['a1'] },
          { id: 'M2', conceptIds: ['a2'] },
          { id: 'M3', conceptIds: ['a3'] },
        ]),
        section('S2', [{ id: 'M4', conceptIds: ['a4'] }]),
      ],
      concepts: ['a1', 'a2', 'a3', 'a4'].map((id) => concept(id, 0.5)),
      // Declared out of ordinal order: M3 before M2, M2 before M1.
      edges: [
        edge('a3', 'a4', 'PREREQ_OF', 0.9),
        edge('a2', 'a4', 'PREREQ_OF', 0.9),
        edge('a1', 'a4', 'PREREQ_OF', 0.9),
      ],
    })
    expect(graph.parents.get('M4')).toEqual(['M1', 'M2', 'M3'])
    expect(graph.children.get('M1')).toEqual(['M4'])
  })

  it('averages the importance of the module’s known concepts', () => {
    const graph = buildModuleGraph({
      sections: [section('S1', [{ id: 'M1', conceptIds: ['a', 'b'] }])],
      concepts: [concept('a', 0.2), concept('b', 0.8)],
      edges: [],
    })
    expect(graph.modules[0]?.importance).toBeCloseTo(0.5, 10)
  })

  it('falls back to DEFAULT_MODULE_IMPORTANCE when no concept of the module is known', () => {
    const graph = buildModuleGraph({
      sections: [section('S1', [{ id: 'M1', conceptIds: ['a'] }])],
      concepts: [],
      edges: [],
    })
    expect(graph.modules[0]?.importance).toBe(DEFAULT_MODULE_IMPORTANCE)
    expect(DEFAULT_MODULE_IMPORTANCE).toBe(0.5)
  })

  it('homes a concept listed in two modules in the first one', () => {
    const graph = buildModuleGraph({
      sections: [
        section('S1', [{ id: 'M1', conceptIds: ['shared'] }]),
        section('S2', [
          { id: 'M2', conceptIds: ['shared'] },
          { id: 'M3', conceptIds: ['x'] },
        ]),
      ],
      concepts: [concept('shared', 0.5), concept('x', 0.5)],
      edges: [edge('x', 'shared', 'PREREQ_OF', 0.9)],
    })
    // "shared" homes at M1, so the lift goes to M3 -> M1, not M3 -> M2.
    expect(graph.parents.get('M1')).toEqual(['M3'])
    expect(graph.parents.get('M2')).toEqual([])
  })

  it('assigns ordinals in section order then module order', () => {
    const graph = buildModuleGraph({
      sections: [
        section('S1', [
          { id: 'M1', conceptIds: [] },
          { id: 'M2', conceptIds: [] },
        ]),
        section('S2', [{ id: 'M3', conceptIds: [] }]),
      ],
      concepts: [],
      edges: [],
    })
    expect(graph.modules.map((m) => [m.id, m.ordinal])).toEqual([
      ['M1', 0],
      ['M2', 1],
      ['M3', 2],
    ])
  })
})
