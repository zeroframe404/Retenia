import { describe, expect, it } from 'vitest'
import {
  allLessons,
  context,
  edge,
  lesson,
  moduleSpec,
  nodeAt,
  outline,
  section,
} from '../testing/graph-fixtures'
import type { KnowledgeGraph } from './types'
import { validateSynthesis } from './validate'

const ctx = context()

const graph: KnowledgeGraph = {
  nodes: [
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => nodeAt(id, `c${index}`)),
    nodeAt('toc', 'f0', { canonical: 'Índice' }),
  ],
  edges: [edge('a', 'b', 0.9), edge('b', 'a', 0.3), edge('toc', 'c')],
}

describe('validateSynthesis()', () => {
  it('runs every gate in order and reports what each repaired', () => {
    const result = validateSynthesis(
      graph,
      outline(
        [
          section('S1', [
            moduleSpec('M1', [lesson('L1', ['a', 'b', 'toc']), lesson('L2', ['c', 'ghost', 'd'])]),
            moduleSpec('M2', []),
          ]),
          section('S2', []),
        ],
        {
          warnings: ['  capítulo 9 excluido: apéndice ', ''],
          misconceptions: [
            { concept_id: 'a', text: 'Error uno', why_wrong: ' porque ' },
            { concept_id: 'a', text: 'error uno', why_wrong: 'repetido' },
            { concept_id: 'toc', text: 'x', why_wrong: 'y' },
            { concept_id: 'ghost', text: 'x', why_wrong: 'y' },
            { concept_id: 'b', text: '   ', why_wrong: 'vacío' },
          ],
        },
      ),
      ctx,
    )

    expect(result.fatal).toBeNull()
    expect(result.graph.nodes.map((entry) => entry.concept_id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ])
    expect(result.graph.edges).toEqual([edge('a', 'b', 0.9)])
    expect(result.outline.sections).toHaveLength(1)
    expect(result.outline.sections[0]?.modules.map((entry) => entry.title)).toEqual(['M1'])
    // `e` and `f` are important and untaught: a catch-up lesson in the only module.
    expect(allLessons(result.outline.sections).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ])
    expect(result.outline.misconceptions).toEqual([
      { concept_id: 'a', text: 'Error uno', why_wrong: 'porque' },
    ])
    expect(result.outline.warnings).toEqual(['  capítulo 9 excluido: apéndice ', ''])
    expect(result.warnings.map((entry) => entry.code)).toEqual([
      'model_warning',
      'frontmatter_excluded',
      'cycle_broken',
      'unknown_concept',
      'coverage_gap',
      'module_empty',
      'section_empty',
      'misconception_dropped',
    ])
    expect(result.warnings[0]).toEqual({
      code: 'model_warning',
      stage: 'synthesize',
      params: { text: 'capítulo 9 excluido: apéndice' },
    })
  })

  it('is fatal when nothing survives to sequence', () => {
    const result = validateSynthesis(
      { nodes: [nodeAt('a', 'c0', { importance: 0.1 })], edges: [] },
      outline([section('S', [moduleSpec('M', [lesson('L', ['ghost'])])])]),
      ctx,
    )
    expect(result.fatal).toEqual({ code: 'outline_empty', stage: 'validate', params: {} })
    expect(result.warnings.map((entry) => entry.code)).toEqual([
      'unknown_concept',
      'lesson_empty',
      'module_empty',
      'section_empty',
      'outline_empty',
    ])
  })

  it('is idempotent and independent of the order nodes and edges arrive in', () => {
    const shuffledGraph: KnowledgeGraph = {
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    }
    const spec = outline([
      section('S1', [
        moduleSpec('M1', [lesson('L1', ['b', 'a', 'toc']), lesson('L2', ['d', 'c'])]),
      ]),
    ])
    const first = validateSynthesis(graph, spec, ctx)
    const second = validateSynthesis(shuffledGraph, spec, ctx)
    expect(second).toEqual(first)

    const again = validateSynthesis(first.graph, first.outline, ctx)
    expect(again.graph).toEqual(first.graph)
    expect(again.outline).toEqual(first.outline)
    expect(again.warnings.filter((entry) => entry.code !== 'model_warning')).toEqual([])
  })
})
