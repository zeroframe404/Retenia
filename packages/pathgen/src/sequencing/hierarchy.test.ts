import { describe, expect, it } from 'vitest'
import {
  edge,
  lesson,
  moduleSpec,
  nodeAt,
  outline,
  PRIMARY,
  section,
} from '../testing/graph-fixtures'
import type { ConceptEdge, ConceptNode, Outline, ValidatedSynthesis } from '../validate/types'
import { orderHierarchy } from './hierarchy'
import { liftGraph } from './lift'

function run(nodes: ConceptNode[], edges: ConceptEdge[], spec: Outline) {
  const validated: ValidatedSynthesis = {
    graph: { nodes, edges },
    outline: spec,
    warnings: [],
    fatal: null,
  }
  return orderHierarchy(liftGraph(validated, [PRIMARY]), spec)
}

/** The lesson titles of a hierarchy, in final order, grouped by section then module. */
function titles(result: ReturnType<typeof run>): string[][][] {
  return result.sections.map((entry) =>
    entry.modules.map((module) => module.lessons.map((ref) => ref.lesson.title)),
  )
}

describe('orderHierarchy()', () => {
  it('keeps the narrative when nothing forces a change', () => {
    const result = run(
      [nodeAt('a', 'c0'), nodeAt('b', 'c1'), nodeAt('c', 'c2')],
      [edge('a', 'b')],
      outline([
        section('S1', [moduleSpec('M1', [lesson('L1', ['a']), lesson('L2', ['b'])])]),
        section('S2', [moduleSpec('M2', [lesson('L3', ['c'])])]),
      ]),
    )
    expect(titles(result)).toEqual([[['L1', 'L2']], [['L3']]])
    expect(result.warnings).toEqual([])
    expect(result.edges).toHaveLength(1)
    expect(result.removedConceptEdges).toEqual([])
  })

  it('moves a section forward when a later one is a prerequisite, and says so', () => {
    const result = run(
      [nodeAt('x', 'c0'), nodeAt('w', 'c5')],
      [edge('w', 'x')],
      outline([
        section('S1', [moduleSpec('M1', [lesson('L1', ['x'])])]),
        section('S2', [moduleSpec('M2', [lesson('L2', ['w'])])]),
      ]),
    )
    expect(titles(result)).toEqual([[['L2']], [['L1']]])
    expect(result.warnings).toEqual([
      {
        code: 'narrative_reordered',
        stage: 'sequence',
        params: { level: 'section', title: 'S2', outline_index: 1, final_index: 0 },
      },
    ])
  })

  it('breaks a cycle between sections at the weaker edge and drops its concept edges', () => {
    const result = run(
      [nodeAt('a', 'c0'), nodeAt('b', 'c1')],
      [edge('a', 'b', 0.9), edge('b', 'a', 0.3)],
      outline([
        section('S1', [moduleSpec('M1', [lesson('L1', ['a'])])]),
        section('S2', [moduleSpec('M2', [lesson('L2', ['b'])])]),
      ]),
    )
    expect(titles(result)).toEqual([[['L1']], [['L2']]])
    expect(result.removedConceptEdges).toEqual([edge('b', 'a', 0.3)])
    expect(result.edges.map((entry) => [entry.from, entry.to])).toEqual([['0.0.0', '1.0.0']])
    expect(result.warnings).toEqual([
      {
        code: 'section_cycle_broken',
        stage: 'sequence',
        params: { from: 'S2', to: 'S1', edges: 1, confidence: 0.3 },
      },
    ])
  })

  it('orders and un-cycles modules inside a section the same way', () => {
    const result = run(
      [nodeAt('a', 'c0'), nodeAt('b', 'c1'), nodeAt('p', 'c7'), nodeAt('q', 'c8')],
      [edge('a', 'b', 0.9), edge('b', 'a', 0.2), edge('q', 'p')],
      outline([
        section('S1', [
          moduleSpec('M1', [lesson('L1', ['a'])]),
          moduleSpec('M2', [lesson('L2', ['b'])]),
          moduleSpec('M3', [lesson('L3', ['p'])]),
          moduleSpec('M4', [lesson('L4', ['q'])]),
        ]),
      ]),
    )
    expect(titles(result)).toEqual([[['L1'], ['L2'], ['L4'], ['L3']]])
    expect(result.warnings).toEqual([
      {
        code: 'module_cycle_broken',
        stage: 'sequence',
        params: { from: 'M2', to: 'M1', edges: 1, confidence: 0.2 },
      },
      {
        code: 'narrative_reordered',
        stage: 'sequence',
        params: { level: 'module', title: 'M4', outline_index: 3, final_index: 2 },
      },
    ])
  })

  it('breaks a tie on the book position by importance at the section and module levels', () => {
    // Both sections open on chunk c0; the more important one comes first, whatever the model
    // listed. The same rule inside a section, between two modules anchored on one chunk.
    const sections = run(
      [nodeAt('a', 'c0', { importance: 0.3 }), nodeAt('b', 'c0', { importance: 0.9 })],
      [],
      outline([
        section('S1', [moduleSpec('M1', [lesson('L1', ['a'])])]),
        section('S2', [moduleSpec('M2', [lesson('L2', ['b'])])]),
      ]),
    )
    expect(titles(sections)).toEqual([[['L2']], [['L1']]])
    expect(sections.warnings.map((entry) => entry.code)).toEqual(['narrative_reordered'])

    const modules = run(
      [nodeAt('a', 'c0', { importance: 0.3 }), nodeAt('b', 'c0', { importance: 0.9 })],
      [],
      outline([
        section('S', [
          moduleSpec('M1', [lesson('L1', ['a'])]),
          moduleSpec('M2', [lesson('L2', ['b'])]),
        ]),
      ]),
    )
    expect(titles(modules)).toEqual([[['L2'], ['L1']]])

    // Equal importance too: the outline's order is the last word.
    const tied = run(
      [nodeAt('a', 'c0', { importance: 0.5 }), nodeAt('b', 'c0', { importance: 0.5 })],
      [],
      outline([
        section('S1', [moduleSpec('M1', [lesson('L1', ['a'])])]),
        section('S2', [moduleSpec('M2', [lesson('L2', ['b'])])]),
      ]),
    )
    expect(titles(tied)).toEqual([[['L1']], [['L2']]])
    const tiedModules = run(
      [nodeAt('a', 'c0', { importance: 0.5 }), nodeAt('b', 'c0', { importance: 0.5 })],
      [],
      outline([
        section('S', [
          moduleSpec('M2', [lesson('L2', ['b'])]),
          moduleSpec('M1', [lesson('L1', ['a'])]),
        ]),
      ]),
    )
    expect(titles(tiedModules)).toEqual([[['L2'], ['L1']]])
  })

  it('orders lessons inside a module by the book, then importance, then the outline', () => {
    const result = run(
      [
        nodeAt('late', 'c9', { importance: 0.9 }),
        nodeAt('early', 'c1', { importance: 0.2 }),
        nodeAt('twin1', 'c5', { importance: 0.5 }),
        nodeAt('twin2', 'c5', { importance: 0.8 }),
        nodeAt('twin3', 'c5', { importance: 0.8 }),
      ],
      [],
      outline([
        section('S1', [
          moduleSpec('M1', [
            lesson('Late', ['late']),
            lesson('Twin1', ['twin1']),
            lesson('Twin3', ['twin3']),
            lesson('Twin2', ['twin2']),
            lesson('Early', ['early']),
          ]),
        ]),
      ]),
    )
    expect(titles(result)).toEqual([[['Early', 'Twin3', 'Twin2', 'Twin1', 'Late']]])
  })

  it('breaks a cycle between two lessons of one module and names the concepts', () => {
    const result = run(
      [nodeAt('a', 'c0'), nodeAt('b', 'c1'), nodeAt('c', 'c2')],
      [edge('a', 'b', 0.9), edge('b', 'a', 0.2), edge('c', 'a', 0.25)],
      outline([section('S1', [moduleSpec('M1', [lesson('L1', ['a']), lesson('L2', ['b', 'c'])])])]),
    )
    expect(titles(result)).toEqual([[['L1', 'L2']]])
    // Both b → a and c → a lift to L2 → L1; the strongest of them names the warning.
    expect(result.warnings).toEqual([
      {
        code: 'lesson_cycle_broken',
        stage: 'sequence',
        params: {
          from: 'L2',
          to: 'L1',
          concept_from: 'c',
          concept_to: 'a',
          confidence: 0.25,
          edges: 2,
        },
      },
    ])
    expect(result.removedConceptEdges).toEqual([edge('b', 'a', 0.2), edge('c', 'a', 0.25)])
  })

  it('honours a cross-section prerequisite through the section order alone', () => {
    // b (section 2) depends on a (section 1): nothing to reorder, the edge survives.
    const result = run(
      [nodeAt('a', 'c0'), nodeAt('b', 'c1')],
      [edge('a', 'b')],
      outline([
        section('S1', [moduleSpec('M1', [lesson('L1', ['a'])])]),
        section('S2', [moduleSpec('M2', [lesson('L2', ['b'])])]),
      ]),
    )
    expect(result.edges).toHaveLength(1)
    expect(result.warnings).toEqual([])
  })
})
