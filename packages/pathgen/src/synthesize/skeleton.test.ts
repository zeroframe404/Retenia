import { describe, expect, it } from 'vitest'
import { nodeAt, PRIMARY, SECONDARY } from '../testing/graph-fixtures'
import type { KnowledgeGraph } from '../validate/types'
import { fixSkeleton } from './skeleton'

const sourceIds = [PRIMARY, SECONDARY]

/** `a` … `f` at chunks c0 … c5 of the primary source; `s` in the secondary source. */
const graph: KnowledgeGraph = {
  nodes: [
    nodeAt('a', 'c0', { importance: 0.9 }),
    nodeAt('b', 'c1', { importance: 0.9 }),
    nodeAt('c', 'c2', { importance: 0.9 }),
    nodeAt('d', 'c3', { importance: 0.3 }),
    nodeAt('e', 'c4', { importance: 0.9 }),
    nodeAt('f', 'c5', { importance: 0.9 }),
    nodeAt('s', 's0', { importance: 0.9 }),
  ],
  edges: [],
}

const objective = { text: 'Explicar', bloom: 'understand' as const }

describe('fixSkeleton()', () => {
  it('keeps a consistent skeleton as it is', () => {
    const skeleton = fixSkeleton(
      [
        {
          title: 'S1',
          modules: [
            { title: 'M1', objectives: [objective], concept_ids: ['a', 'b'] },
            { title: 'M2', objectives: [], concept_ids: ['c', 'd', 'e', 'f', 's'] },
          ],
        },
      ],
      graph,
      { sourceIds },
    )
    expect(skeleton.warnings).toEqual([])
    expect(skeleton.sections).toEqual([
      {
        title: 'S1',
        modules: [
          {
            sectionIndex: 0,
            moduleIndex: 0,
            title: 'M1',
            objectives: [objective],
            conceptIds: ['a', 'b'],
          },
          {
            sectionIndex: 0,
            moduleIndex: 1,
            title: 'M2',
            objectives: [],
            conceptIds: ['c', 'd', 'e', 'f', 's'],
          },
        ],
      },
    ])
    expect(skeleton.sections[0]?.modules[0]?.objectives[0]).not.toBe(objective)
  })

  it('drops unknown and repeated ids, empty modules and sections, and reports each', () => {
    const skeleton = fixSkeleton(
      [
        {
          title: 'S1',
          modules: [
            { title: 'M1', objectives: [], concept_ids: ['a', 'ghost', 'a', 'b'] },
            { title: 'M2', objectives: [], concept_ids: ['b', 'ghost2'] },
          ],
        },
        { title: 'S2', modules: [{ title: 'M3', objectives: [], concept_ids: ['nope'] }] },
        {
          title: 'S3',
          modules: [{ title: 'M4', objectives: [], concept_ids: ['c', 'd', 'e', 'f', 's'] }],
        },
      ],
      graph,
      { sourceIds },
    )
    expect(skeleton.warnings).toEqual([
      { code: 'unknown_concept', stage: 'validate', params: { concept_id: 'ghost', module: 'M1' } },
      { code: 'concept_repeated', stage: 'validate', params: { concept_id: 'b', module: 'M2' } },
      {
        code: 'unknown_concept',
        stage: 'validate',
        params: { concept_id: 'ghost2', module: 'M2' },
      },
      { code: 'module_empty', stage: 'validate', params: { module: 'M2' } },
      { code: 'unknown_concept', stage: 'validate', params: { concept_id: 'nope', module: 'M3' } },
      { code: 'module_empty', stage: 'validate', params: { module: 'M3' } },
      { code: 'section_empty', stage: 'validate', params: { section: 'S2' } },
    ])
    expect(skeleton.sections.map((section) => section.title)).toEqual(['S1', 'S3'])
    expect(skeleton.sections[0]?.modules.map((module) => module.conceptIds)).toEqual([['a', 'b']])
  })

  it('homes an important concept nobody claimed in the module the book reaches just before it', () => {
    const skeleton = fixSkeleton(
      [
        {
          title: 'S1',
          modules: [
            // Anchored at c2 and c0: `a` (c0) and `b` (c1) are unclaimed.
            { title: 'M-late', objectives: [], concept_ids: ['c', 'e'] },
            { title: 'M-early', objectives: [], concept_ids: ['d'] },
          ],
        },
      ],
      {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.concept_id === 'd' ? { ...node, importance: 0.9 } : node,
        ),
      },
      { sourceIds },
    )
    // `a` and `b` come before every anchor → the first module by anchor is not "before" them,
    // so they fall back to the first module in outline order; `f` (c5) goes after `M-early`?
    // No: `M-late` is anchored at c2, `M-early` at c3, so `f` at c5 lands in `M-early`, and
    // `s` (secondary source, after everything) lands there too.
    expect(skeleton.sections[0]?.modules.map((module) => module.conceptIds)).toEqual([
      ['c', 'e', 'a', 'b'],
      ['d', 'f', 's'],
    ])
    expect(skeleton.warnings).toEqual([
      {
        code: 'coverage_gap',
        stage: 'validate',
        params: { concept_ids: ['a', 'b'], module: 'M-late' },
      },
      {
        code: 'coverage_gap',
        stage: 'validate',
        params: { concept_ids: ['f', 's'], module: 'M-early' },
      },
    ])
  })

  it('reports nothing to home when no module survived', () => {
    const skeleton = fixSkeleton(
      [{ title: 'S1', modules: [{ title: 'M1', objectives: [], concept_ids: ['ghost'] }] }],
      graph,
      { sourceIds },
    )
    expect(skeleton.sections).toEqual([])
    expect(skeleton.warnings.map((entry) => entry.code)).toEqual([
      'unknown_concept',
      'module_empty',
      'section_empty',
    ])
  })

  it('honours a custom importance threshold for the coverage pass', () => {
    const skeleton = fixSkeleton(
      [{ title: 'S1', modules: [{ title: 'M1', objectives: [], concept_ids: ['a'] }] }],
      { nodes: graph.nodes.slice(0, 4), edges: [] },
      { sourceIds, threshold: 0.2 },
    )
    expect(skeleton.sections[0]?.modules[0]?.conceptIds).toEqual(['a', 'b', 'c', 'd'])
  })
})
