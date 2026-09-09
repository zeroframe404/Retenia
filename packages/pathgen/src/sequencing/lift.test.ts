import { describe, expect, it } from 'vitest'
import { NO_POSITION } from '../graph/order'
import {
  edge,
  lesson,
  moduleSpec,
  nodeAt,
  outline,
  PRIMARY,
  SECONDARY,
  section,
} from '../testing/graph-fixtures'
import type { ValidatedSynthesis } from '../validate/types'
import { keyOf, liftGraph } from './lift'

const validated: ValidatedSynthesis = {
  graph: {
    nodes: [
      nodeAt('a', 'c0', { importance: 0.9 }),
      nodeAt('b', 'c1', { importance: 0.4 }),
      nodeAt('c', 'c2', { importance: 0.6 }),
      nodeAt('d', 'c3', { importance: 0.5 }),
      nodeAt('e', 'c4', { importance: 0.7 }),
      nodeAt('f', 'c5', { importance: 0.3 }),
    ],
    edges: [
      edge('a', 'c', 0.9),
      edge('b', 'c', 0.4),
      edge('c', 'e', 0.8),
      edge('a', 'b', 0.9, 'RELATED_TO'),
      edge('d', 'e', 0.7),
    ],
  },
  outline: outline([
    section('S1', [moduleSpec('M1', [lesson('L1', ['a', 'b']), lesson('L2', ['c'])])]),
    section('S2', [moduleSpec('M2', [lesson('L3', ['d', 'e']), lesson('L4', ['f', 'ghost'])])]),
  ]),
  warnings: [],
  fatal: null,
}

describe('liftGraph()', () => {
  const lifted = liftGraph(validated, [PRIMARY, SECONDARY])

  it('keys every lesson by its outline position and anchors it at its earliest concept', () => {
    expect(lifted.lessons.map((ref) => ref.id)).toEqual(['0.0.0', '0.0.1', '1.0.0', '1.0.1'])
    expect(lifted.lessons.map((ref) => ref.outlineIndex)).toEqual([0, 1, 2, 3])
    expect(lifted.lessons[0]).toMatchObject({ anchor: [0, 0], importance: 0.9 })
    expect(lifted.lessons[2]).toMatchObject({ anchor: [0, 3], importance: 0.7 })
    expect(lifted.byId.get('0.0.1')?.lesson.title).toBe('L2')
    expect(keyOf({ s: 2, m: 1, l: 0 })).toBe('2.1.0')
  })

  it('homes every known concept and skips the ones the graph does not know', () => {
    expect([...lifted.homeOf.entries()]).toEqual([
      ['a', '0.0.0'],
      ['b', '0.0.0'],
      ['c', '0.0.1'],
      ['d', '1.0.0'],
      ['e', '1.0.0'],
      ['f', '1.0.1'],
    ])
    expect(lifted.nodes.size).toBe(6)
  })

  it('lifts prerequisite edges between lessons, merging parallels and dropping the rest', () => {
    expect(lifted.edges).toEqual([
      // a → c and b → c both run L1 → L2: one lifted edge, the strongest confidence, both via.
      {
        from: '0.0.0',
        to: '0.0.1',
        confidence: 0.9,
        via: [edge('a', 'c', 0.9), edge('b', 'c', 0.4)],
      },
      // c → e crosses sections; d → e stays inside L3 and RELATED_TO never lifts.
      { from: '0.0.1', to: '1.0.0', confidence: 0.8, via: [edge('c', 'e', 0.8)] },
    ])
  })

  it('anchors a lesson with no known concept at the end of the book', () => {
    const only = liftGraph(
      {
        ...validated,
        outline: outline([section('S', [moduleSpec('M', [lesson('L', ['ghost'])])])]),
      },
      [PRIMARY],
    )
    expect(only.lessons[0]).toMatchObject({ anchor: NO_POSITION, importance: 0 })
    expect(only.edges).toEqual([])
  })
})
