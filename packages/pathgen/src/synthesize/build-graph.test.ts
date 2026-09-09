import { describe, expect, it } from 'vitest'
import type { ConsolidatedConcept } from '../consolidate'
import { buildGraph } from './build-graph'

function concept(id: string, importance: number): ConsolidatedConcept {
  return {
    concept_id: id,
    canonical: `Canonical ${id}`,
    aliases: [`alias ${id}`],
    definition: `Definition ${id}`,
    kind: 'principle',
    difficulty: 4,
    importance,
    source_refs: [
      {
        source_id: 'book',
        chunk_id: 'c1',
        chunk_key: 'k1',
        block_ids: ['b1'],
        heading_path: 'Libro > Cap. 1',
        ordinal: 1,
      },
    ],
    first_primary_ordinal: 1,
    prerequisites_mentioned: [],
    occurrences: 1,
  }
}

describe('buildGraph()', () => {
  const concepts = [concept('c_a', 0.9), concept('c_b', 0.7), concept('c_c', 0.2)]

  it('attaches names, definitions and refs to the model’s nodes and keeps its edges', () => {
    const built = buildGraph(
      {
        nodes: [
          { concept_id: 'c_a', bloom_target: 'apply', difficulty: 2, importance: 0.95 },
          { concept_id: 'c_b', bloom_target: 'remember', difficulty: 5, importance: 0.4 },
        ],
        edges: [{ from: 'c_a', to: 'c_b', kind: 'PREREQ_OF', confidence: 0.8 }],
      },
      concepts,
    )
    expect(built.warnings).toEqual([])
    expect(built.graph.nodes).toEqual([
      {
        concept_id: 'c_a',
        canonical: 'Canonical c_a',
        aliases: ['alias c_a'],
        definition: 'Definition c_a',
        kind: 'principle',
        bloom_target: 'apply',
        difficulty: 2,
        importance: 0.95,
        source_refs: concepts[0]?.source_refs,
      },
      expect.objectContaining({ concept_id: 'c_b', bloom_target: 'remember', importance: 0.4 }),
    ])
    expect(built.graph.edges).toEqual([
      { from: 'c_a', to: 'c_b', kind: 'PREREQ_OF', confidence: 0.8 },
    ])
    // Copies, not the consolidated objects.
    expect(built.graph.nodes[0]?.source_refs[0]).not.toBe(concepts[0]?.source_refs[0])
    expect(built.graph.nodes[0]?.aliases).not.toBe(concepts[0]?.aliases)
  })

  it('drops an invented id and appends an important concept the model left out', () => {
    const built = buildGraph(
      {
        nodes: [
          { concept_id: 'c_ghost', bloom_target: 'apply', difficulty: 2, importance: 0.9 },
          { concept_id: 'c_c', bloom_target: 'apply', difficulty: 2, importance: 0.2 },
        ],
        edges: [],
      },
      concepts,
    )
    expect(built.warnings).toEqual([
      { code: 'unknown_node', stage: 'synthesize', params: { concept_id: 'c_ghost' } },
      {
        code: 'coverage_gap',
        stage: 'validate',
        params: { concept_ids: ['c_a', 'c_b'], level: 'graph' },
      },
    ])
    expect(built.graph.nodes.map((node) => node.concept_id)).toEqual(['c_c', 'c_a', 'c_b'])
    expect(built.graph.nodes[1]).toMatchObject({
      bloom_target: 'understand',
      difficulty: 4,
      importance: 0.9,
    })
  })

  it('honours a custom threshold and leaves duplicates for the graph gates', () => {
    const built = buildGraph(
      {
        nodes: [
          { concept_id: 'c_a', bloom_target: 'apply', difficulty: 2, importance: 0.9 },
          { concept_id: 'c_a', bloom_target: 'apply', difficulty: 2, importance: 0.9 },
        ],
        edges: [],
      },
      concepts,
      { threshold: 0.1 },
    )
    expect(built.graph.nodes.map((node) => node.concept_id)).toEqual(['c_a', 'c_a', 'c_b', 'c_c'])
    expect(built.warnings[0]?.params.concept_ids).toEqual(['c_b', 'c_c'])
  })
})
