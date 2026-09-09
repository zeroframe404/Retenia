import { describe, expect, it } from 'vitest'
import {
  chunk,
  context,
  edge,
  node,
  nodeAt,
  PRIMARY,
  ref,
  SECONDARY,
  standardChunks,
} from '../testing/graph-fixtures'
import { clamp, validateGraph } from './graph'

const ctx = context()

describe('validateGraph()', () => {
  it('keeps a clean graph, sorted, with every ref resolved against the chunk index', () => {
    const { graph, warnings, dropped } = validateGraph(
      {
        nodes: [
          node('b', { source_refs: [ref('c3', { ordinal: 99, source_id: 'wrong' })] }),
          node('a', { source_refs: [ref('s1', { source_id: 'wrong' }), ref('c0')] }),
        ],
        edges: [edge('b', 'a', 0.5, 'RELATED_TO'), edge('a', 'b', 0.9)],
      },
      ctx,
    )
    expect(warnings).toEqual([])
    expect(dropped.size).toBe(0)
    expect(graph.nodes.map((entry) => entry.concept_id)).toEqual(['a', 'b'])
    // Position and source come from our index, not from what the model wrote.
    expect(graph.nodes[1]?.source_refs).toEqual([
      { ...ref('c3'), source_id: PRIMARY, ordinal: 3, heading_path: 'Libro > c3' },
    ])
    // Primary source first, then the secondary one.
    expect(graph.nodes[0]?.source_refs.map((entry) => entry.source_id)).toEqual([
      PRIMARY,
      SECONDARY,
    ])
    expect(graph.edges).toEqual([edge('a', 'b', 0.9), edge('b', 'a', 0.5, 'RELATED_TO')])
  })

  it('drops a duplicate node, keeping the first in id order', () => {
    const { graph, warnings } = validateGraph(
      { nodes: [node('a', { canonical: 'second' }), node('a', { canonical: 'first' })], edges: [] },
      ctx,
    )
    expect(graph.nodes).toHaveLength(1)
    expect(warnings).toEqual([
      { code: 'duplicate_node', stage: 'validate', params: { concept_id: 'a' } },
    ])
  })

  it('clamps importance and difficulty and defaults an unknown bloom or kind', () => {
    const { graph } = validateGraph(
      {
        nodes: [
          node('a', { importance: 1.4, difficulty: 7.6 }),
          node('b', { importance: -1, difficulty: 0 }),
          node('c', {
            importance: Number.NaN,
            difficulty: 2.4,
            bloom_target: 'nope' as never,
            kind: 'weird' as never,
          }),
        ],
        edges: [],
      },
      ctx,
    )
    expect(graph.nodes.map((entry) => [entry.importance, entry.difficulty])).toEqual([
      [1, 5],
      [0, 1],
      [0, 2],
    ])
    expect(graph.nodes[2]).toMatchObject({ bloom_target: 'understand', kind: 'concept' })
    expect(clamp(3, 1, 5)).toBe(3)
  })

  it('counts refs it cannot resolve and keeps one ref per chunk', () => {
    const { graph, warnings } = validateGraph(
      {
        nodes: [node('a', { source_refs: [ref('c2'), ref('ghost'), ref('c2'), ref('nope')] })],
        edges: [],
      },
      ctx,
    )
    expect(graph.nodes[0]?.source_refs.map((entry) => entry.chunk_id)).toEqual(['c2'])
    expect(warnings).toEqual([
      { code: 'unknown_chunk_ref', stage: 'validate', params: { concept_id: 'a', count: 2 } },
    ])
  })

  it('removes a concept whose every reference is front matter, and its edges silently', () => {
    const { graph, warnings, dropped } = validateGraph(
      {
        nodes: [nodeAt('toc', 'f0', { canonical: 'Índice' }), nodeAt('a', 'c1')],
        edges: [edge('toc', 'a'), edge('a', 'toc', 0.2, 'RELATED_TO')],
      },
      ctx,
    )
    expect(dropped).toEqual(new Set(['toc']))
    expect(graph.nodes.map((entry) => entry.concept_id)).toEqual(['a'])
    expect(graph.edges).toEqual([])
    expect(warnings).toEqual([
      {
        code: 'frontmatter_excluded',
        stage: 'validate',
        params: { concept_id: 'toc', canonical: 'Índice' },
      },
    ])
  })

  it('keeps a concept referenced only by front matter and a real chunk', () => {
    const { graph, warnings } = validateGraph(
      { nodes: [node('a', { source_refs: [ref('f0'), ref('c4')] })], edges: [] },
      ctx,
    )
    expect(graph.nodes).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  it('keeps a concept with no resolvable reference and says so', () => {
    const { graph, warnings } = validateGraph(
      {
        nodes: [node('a', { source_refs: [] }), node('b', { source_refs: [ref('ghost')] })],
        edges: [],
      },
      ctx,
    )
    expect(graph.nodes).toHaveLength(2)
    expect(warnings).toEqual([
      { code: 'concept_without_sources', stage: 'validate', params: { concept_id: 'a' } },
      { code: 'unknown_chunk_ref', stage: 'validate', params: { concept_id: 'b', count: 1 } },
      { code: 'concept_without_sources', stage: 'validate', params: { concept_id: 'b' } },
    ])
  })

  it('drops dangling edges and self-loops, defaults an unknown kind, keeps the strongest of parallels', () => {
    const { graph, warnings } = validateGraph(
      {
        nodes: [node('a'), node('b')],
        edges: [
          edge('a', 'ghost'),
          edge('a', 'a', 0.9),
          edge('a', 'b', 0.3),
          edge('a', 'b', 0.8),
          edge('b', 'a', 1.7, 'odd' as never),
        ],
      },
      ctx,
    )
    expect(graph.edges).toEqual([edge('a', 'b', 0.8), edge('b', 'a', 1, 'RELATED_TO')])
    // Edges are walked in (kind, from, to) order, so `a → a` is seen before `a → ghost`.
    expect(warnings).toEqual([
      { code: 'self_loop', stage: 'validate', params: { concept_id: 'a', kind: 'PREREQ_OF' } },
      {
        code: 'dangling_edge',
        stage: 'validate',
        params: { from: 'a', to: 'ghost', kind: 'PREREQ_OF' },
      },
    ])
  })

  it('breaks prerequisite cycles at the weakest edge and leaves the other kinds alone', () => {
    const { graph, warnings } = validateGraph(
      {
        nodes: [node('a'), node('b'), node('c')],
        edges: [
          edge('a', 'b', 0.9),
          edge('b', 'a', 0.4),
          edge('b', 'c', 0.7, 'RELATED_TO'),
          edge('c', 'b', 0.1, 'RELATED_TO'),
        ],
      },
      ctx,
    )
    expect(graph.edges).toEqual([
      edge('a', 'b', 0.9),
      edge('b', 'c', 0.7, 'RELATED_TO'),
      edge('c', 'b', 0.1, 'RELATED_TO'),
    ])
    expect(warnings).toEqual([
      {
        code: 'cycle_broken',
        stage: 'validate',
        params: { from: 'b', to: 'a', confidence: 0.4 },
      },
    ])
  })

  it('is idempotent and independent of the input order', () => {
    const nodes = [nodeAt('c', 'c5'), nodeAt('a', 'c2'), nodeAt('b', 'c9')]
    const edges = [edge('a', 'b'), edge('b', 'c', 0.5), edge('c', 'a', 0.2)]
    const forward = validateGraph({ nodes, edges }, ctx)
    const backward = validateGraph(
      { nodes: [...nodes].reverse(), edges: [...edges].reverse() },
      ctx,
    )
    expect(backward).toEqual(forward)

    const again = validateGraph(forward.graph, ctx)
    expect(again.graph).toEqual(forward.graph)
    expect(again.warnings).toEqual([])
  })

  it('ranks a source outside the configuration after every configured one', () => {
    const { graph } = validateGraph(
      { nodes: [node('a', { source_refs: [ref('x0'), ref('c8')] })], edges: [] },
      context([...standardChunks(), chunk('x0', 0, { sourceId: 'src-dropped' })]),
    )
    expect(graph.nodes[0]?.source_refs.map((entry) => entry.chunk_id)).toEqual(['c8', 'x0'])
  })

  it('orders two refs at the same position of the same source by chunk id', () => {
    const { graph } = validateGraph(
      { nodes: [node('a', { source_refs: [ref('t0'), ref('s0')] })], edges: [] },
      context([...standardChunks(), chunk('t0', 0, { sourceId: SECONDARY })]),
    )
    expect(graph.nodes[0]?.source_refs.map((entry) => entry.chunk_id)).toEqual(['s0', 't0'])
  })
})
