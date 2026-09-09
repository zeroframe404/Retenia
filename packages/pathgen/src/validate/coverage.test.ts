import { describe, expect, it } from 'vitest'
import { allLessons, context, lesson, moduleSpec, nodeAt, section } from '../testing/graph-fixtures'
import { fillCoverageGaps } from './coverage'
import type { KnowledgeGraph } from './types'

const ctx = context()

/** `a`…`h` at chunks c0…c7; `low` is unimportant and sits at c8. */
const graph: KnowledgeGraph = {
  nodes: [
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, index) =>
      nodeAt(id, `c${index}`, { canonical: id.toUpperCase(), bloom_target: 'apply' }),
    ),
    nodeAt('low', 'c8', { importance: 0.2 }),
  ],
  edges: [],
}

describe('fillCoverageGaps()', () => {
  it('leaves an outline alone when every important concept is taught', () => {
    const sections = [
      section('S', [
        moduleSpec('M', [lesson('L1', ['a', 'b', 'c', 'd']), lesson('L2', ['e', 'f', 'g', 'h'])]),
      ]),
    ]
    const { sections: out, warnings } = fillCoverageGaps(sections, graph, ctx)
    expect(out).toEqual(sections)
    expect(warnings).toEqual([])
  })

  it('homes a gap in the section of the nearest taught concept before it', () => {
    const sections = [
      section('S1', [moduleSpec('M1', [lesson('L1', ['a', 'b'])])]),
      section('S2', [
        moduleSpec('M2', [lesson('L2', ['c', 'd'])]),
        moduleSpec('M3', [lesson('L3', ['g', 'h'])]),
      ]),
    ]
    // `e` and `f` sit between `d` and `g` in the book, so they belong to section 2, and go to
    // its last module.
    const { sections: out, warnings } = fillCoverageGaps(sections, graph, ctx)
    expect(out[0]).toEqual(sections[0])
    expect(out[1]?.modules[1]?.lesson_specs).toMatchObject([
      { title: 'L3' },
      {
        title: 'E · F',
        concept_ids: ['e', 'f'],
        objectives: [{ text: 'E, F', bloom: 'apply' }],
        estimated_minutes: null,
        origin: 'catch_up',
      },
    ])
    expect(warnings).toEqual([
      {
        code: 'coverage_gap',
        stage: 'validate',
        params: { concept_ids: ['e', 'f'], lesson: 'E · F' },
      },
    ])
  })

  it('homes a gap that precedes every taught concept in the first section', () => {
    const sections = [
      section('S1', [moduleSpec('M1', [lesson('L1', ['c', 'd', 'e', 'f', 'g'])])]),
      section('S2', [moduleSpec('M2', [lesson('L2', ['h'])])]),
    ]
    const { sections: out } = fillCoverageGaps(sections, graph, ctx)
    expect(allLessons(out).map((entry) => entry.concept_ids)).toEqual([
      ['c', 'd', 'e', 'f', 'g'],
      ['a', 'b'],
      ['h'],
    ])
  })

  it('splits many gaps into even lessons of at most five, then fits the module', () => {
    const sections = [section('S', [moduleSpec('M', [lesson('L', ['h'])])])]
    const { sections: out, warnings } = fillCoverageGaps(sections, graph, ctx)
    // The one-concept lesson the model left merges forward into the first catch-up lesson.
    expect(allLessons(out).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd', 'h'],
      ['e', 'f', 'g'],
    ])
    expect(warnings.map((entry) => entry.code)).toEqual([
      'coverage_gap',
      'coverage_gap',
      'lesson_merged',
    ])
  })

  it('merges a single gap into the last lesson when it has room', () => {
    const sections = [
      section('S', [
        moduleSpec('M', [lesson('L', ['a', 'b', 'c', 'd', 'e']), lesson('Last', ['f', 'g'])]),
      ]),
    ]
    const { sections: out, warnings } = fillCoverageGaps(sections, graph, ctx)
    expect(allLessons(out).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f', 'g', 'h'],
    ])
    expect(warnings).toEqual([
      { code: 'coverage_gap', stage: 'validate', params: { concept_ids: ['h'], lesson: 'H' } },
      { code: 'lesson_merged', stage: 'validate', params: { lesson: 'H', into: 'Last' } },
    ])
  })

  it('borrows from a full last lesson so a single gap reaches the floor', () => {
    const sections = [
      section('S', [
        moduleSpec('M', [
          lesson('L', ['a', 'b', 'c', 'd', 'e']),
          lesson('Full', ['f', 'g', 'x', 'y', 'z']),
        ]),
      ]),
    ]
    const wider: KnowledgeGraph = {
      nodes: [...graph.nodes, nodeAt('x', 'c9'), nodeAt('y', 'c9'), nodeAt('z', 'c9')],
      edges: [],
    }
    const { sections: out, warnings } = fillCoverageGaps(sections, wider, ctx)
    expect(allLessons(out).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f', 'g', 'x', 'y'],
      ['h', 'z'],
    ])
    expect(warnings).toEqual([
      { code: 'coverage_gap', stage: 'validate', params: { concept_ids: ['h'], lesson: 'H' } },
      {
        code: 'lesson_rebalanced',
        stage: 'validate',
        params: { lesson: 'H', from: 'Full', concept_id: 'z' },
      },
    ])
  })

  it('honours a custom importance threshold', () => {
    const sections = [
      section('S', [
        moduleSpec('M', [lesson('L1', ['a', 'b', 'c', 'd']), lesson('L2', ['e', 'f', 'g', 'h'])]),
      ]),
    ]
    const { sections: out } = fillCoverageGaps(sections, graph, {
      ...ctx,
      importanceThreshold: 0.1,
    })
    expect(allLessons(out).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h', 'low'],
    ])
  })

  it('creates a section and a module when the outline has none to home a gap in', () => {
    const { sections: out, warnings } = fillCoverageGaps(
      [],
      { nodes: [graph.nodes[0] as never], edges: [] },
      ctx,
    )
    expect(out).toMatchObject([
      { title: 'A', modules: [{ title: 'A', lesson_specs: [{ title: 'A', concept_ids: ['a'] }] }] },
    ])
    expect(warnings.map((entry) => entry.code)).toEqual(['coverage_gap', 'lesson_too_small'])

    const { sections: filled } = fillCoverageGaps(
      [section('Vacía', [])],
      { nodes: [graph.nodes[0] as never], edges: [] },
      ctx,
    )
    expect(filled).toMatchObject([{ title: 'Vacía', modules: [{ title: 'A' }] }])
  })

  it('appends to the last module that has lessons, not to an empty one', () => {
    const sections = [
      section('S', [moduleSpec('Con', [lesson('L', ['a', 'b'])]), moduleSpec('Vacío', [])]),
    ]
    const { sections: out } = fillCoverageGaps(sections, graph, ctx)
    expect(out[0]?.modules.map((module) => module.lesson_specs.length)).toEqual([3, 0])
  })

  it('truncates a very long catch-up title', () => {
    const long: KnowledgeGraph = {
      nodes: ['p', 'q', 'r'].map((id, index) =>
        nodeAt(id, `c${index}`, { canonical: `${id.repeat(40)}` }),
      ),
      edges: [],
    }
    const { sections: out } = fillCoverageGaps(
      [section('S', [moduleSpec('M', [lesson('L', ['p'])])])],
      long,
      ctx,
    )
    // The model's one-concept lesson merges into the catch-up lesson, which keeps its title.
    const title = allLessons(out)[0]?.title ?? ''
    expect(title.length).toBe(80)
    expect(title.endsWith('…')).toBe(true)
  })
})
