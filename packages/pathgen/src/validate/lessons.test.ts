import { describe, expect, it } from 'vitest'
import {
  allLessons,
  context,
  lesson,
  moduleSpec,
  nodeAt,
  outline,
  section,
} from '../testing/graph-fixtures'
import {
  clampObjectives,
  dedupeObjectives,
  highestBloom,
  lessonLabel,
  normalizeLessons,
  sortConceptIds,
  splitEvenly,
} from './lessons'
import type { KnowledgeGraph } from './types'

const ctx = context()
const none = new Set<string>()

/** `a`…`h` introduced in that order in the primary source. */
const graph: KnowledgeGraph = {
  nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, index) =>
    nodeAt(id, `c${index}`, { bloom_target: id === 'c' ? 'apply' : 'remember' }),
  ),
  edges: [],
}

describe('splitEvenly()', () => {
  it('cuts contiguous groups whose sizes differ by at most one, larger first', () => {
    expect(splitEvenly([1, 2, 3, 4, 5, 6], 2)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
    expect(splitEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 3)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11],
    ])
    expect(splitEvenly(['x'], 1)).toEqual([['x']])
  })
})

describe('normalizeLessons()', () => {
  it('resolves ids: unknown ones warn, front-matter ones vanish, repeats are dropped', () => {
    const { sections, warnings } = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [
            lesson('Uno', ['b', 'ghost', 'a', 'toc', 'a']),
            lesson('Dos', ['c', 'a', 'd']),
          ]),
        ]),
      ]),
      graph,
      new Set(['toc']),
      ctx,
    )
    expect(allLessons(sections).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(warnings).toEqual([
      {
        code: 'unknown_concept',
        stage: 'validate',
        params: { lesson: 'Uno', concept_id: 'ghost' },
      },
      {
        code: 'concept_repeated',
        stage: 'validate',
        params: { concept_id: 'a', first_lesson: 'Uno', lesson: 'Dos' },
      },
    ])
  })

  it('names untitled lessons, modules and sections after what they contain', () => {
    const { sections, warnings } = normalizeLessons(
      outline([section('  ', [moduleSpec('', [lesson(' ', ['b', 'a']), lesson('', [])])])]),
      graph,
      none,
      ctx,
    )
    expect(sections[0]?.title).toBe('A')
    expect(sections[0]?.modules[0]?.title).toBe('A')
    expect(allLessons(sections).map((entry) => entry.title)).toEqual(['A'])
    expect(warnings).toEqual([
      { code: 'title_missing', stage: 'validate', params: { level: 'lesson', replacement: 'A' } },
      { code: 'lesson_empty', stage: 'validate', params: { lesson: 'S1.M1.L2' } },
      { code: 'title_missing', stage: 'validate', params: { level: 'module', replacement: 'A' } },
      { code: 'title_missing', stage: 'validate', params: { level: 'section', replacement: 'A' } },
    ])
    expect(lessonLabel('', { section: 2, module: 0, lesson: 4 })).toBe('S3.M1.L5')
  })

  it('splits an oversized lesson evenly and labels the parts', () => {
    const { sections, warnings } = normalizeLessons(
      outline([
        section('S', [moduleSpec('M', [lesson('Grande', ['a', 'b', 'c', 'd', 'e', 'f'])])]),
      ]),
      graph,
      none,
      ctx,
    )
    expect(allLessons(sections)).toMatchObject([
      { title: 'Grande (1/2)', concept_ids: ['a', 'b', 'c'], origin: 'split' },
      { title: 'Grande (2/2)', concept_ids: ['d', 'e', 'f'], origin: 'split' },
    ])
    expect(warnings).toEqual([
      { code: 'lesson_split', stage: 'validate', params: { lesson: 'Grande', parts: 2 } },
    ])
  })

  it('merges a one-concept lesson into the previous lesson when it fits', () => {
    const { sections, warnings } = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [
            lesson('Uno', ['a', 'b'], { objectives: [{ text: 'o1', bloom: 'remember' }] }),
            lesson('Solo', ['c'], { objectives: [{ text: 'o2', bloom: 'apply' }] }),
          ]),
        ]),
      ]),
      graph,
      none,
      ctx,
    )
    expect(allLessons(sections)).toMatchObject([
      {
        title: 'Uno',
        concept_ids: ['a', 'b', 'c'],
        origin: 'merged',
        objectives: [
          { text: 'o1', bloom: 'remember' },
          { text: 'o2', bloom: 'apply' },
        ],
      },
    ])
    expect(warnings).toEqual([
      { code: 'lesson_merged', stage: 'validate', params: { lesson: 'Solo', into: 'Uno' } },
    ])
  })

  it('merges forward when the previous lesson is full', () => {
    const { sections, warnings } = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [
            lesson('Lleno', ['a', 'b', 'c', 'd', 'e']),
            lesson('Solo', ['f']),
            lesson('Sig', ['g', 'h']),
          ]),
        ]),
      ]),
      graph,
      none,
      ctx,
    )
    expect(allLessons(sections).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f', 'g', 'h'],
    ])
    expect(warnings).toEqual([
      { code: 'lesson_merged', stage: 'validate', params: { lesson: 'Solo', into: 'Sig' } },
    ])
  })

  it('borrows a concept from a full neighbour when nothing can merge', () => {
    const fromPrevious = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [
            lesson('Prev', ['a', 'b', 'c', 'd', 'e']),
            lesson('Solo', ['f']),
            lesson(
              'Next',
              ['g', 'h', 'a'].filter((id) => id !== 'a'),
            ),
          ]),
        ]),
      ]),
      graph,
      none,
      ctx,
    )
    // The next lesson has room, so the merge goes forward first; force the borrow by making
    // the next lesson full too.
    expect(fromPrevious.warnings[0]?.code).toBe('lesson_merged')

    const borrowed = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [
            lesson('Prev', ['a', 'b', 'c', 'd', 'e']),
            lesson('Solo', ['f']),
            lesson('Next', ['g', 'h', 'x', 'y', 'z']),
          ]),
        ]),
      ]),
      {
        nodes: [...graph.nodes, nodeAt('x', 'c8'), nodeAt('y', 'c9'), nodeAt('z', 'c9')],
        edges: [],
      },
      none,
      ctx,
    )
    expect(allLessons(borrowed.sections).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f'],
      ['g', 'h', 'x', 'y', 'z'],
    ])
    expect(borrowed.warnings).toEqual([
      {
        code: 'lesson_rebalanced',
        stage: 'validate',
        params: { lesson: 'Solo', from: 'Prev', concept_id: 'e' },
      },
    ])
  })

  it('borrows from the next lesson when it is the first in its module', () => {
    const { sections, warnings } = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [lesson('Solo', ['a']), lesson('Next', ['b', 'c', 'd', 'e', 'f'])]),
        ]),
      ]),
      graph,
      none,
      ctx,
    )
    expect(allLessons(sections).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e', 'f'],
    ])
    expect(warnings).toEqual([
      {
        code: 'lesson_rebalanced',
        stage: 'validate',
        params: { lesson: 'Solo', from: 'Next', concept_id: 'b' },
      },
    ])
  })

  it('keeps a lone one-concept lesson and reports it', () => {
    const { sections, warnings } = normalizeLessons(
      outline([section('S', [moduleSpec('M', [lesson('Solo', ['a'])])])]),
      graph,
      none,
      ctx,
    )
    expect(allLessons(sections).map((entry) => entry.concept_ids)).toEqual([['a']])
    expect(warnings).toEqual([
      { code: 'lesson_too_small', stage: 'validate', params: { lesson: 'Solo', concepts: 1 } },
    ])
  })

  it('does not merge into a next lesson that is empty', () => {
    const { sections, warnings } = normalizeLessons(
      outline([
        section('S', [
          moduleSpec('M', [
            lesson('Full', ['a', 'b', 'c', 'd', 'e']),
            lesson('Solo', ['f']),
            lesson('Empty', []),
          ]),
        ]),
      ]),
      graph,
      none,
      ctx,
    )
    expect(allLessons(sections).map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f'],
    ])
    expect(warnings.map((entry) => entry.code)).toEqual(['lesson_rebalanced', 'lesson_empty'])
  })
})

describe('objectives', () => {
  it('dedupes by text, drops empties and defaults an unknown bloom', () => {
    expect(
      dedupeObjectives([
        { text: ' Explicar ', bloom: 'apply' },
        { text: 'explicar', bloom: 'remember' },
        { text: '', bloom: 'apply' },
        { text: 'Otro', bloom: 'nope' as never },
      ]),
    ).toEqual([
      { text: 'Explicar', bloom: 'apply' },
      { text: 'Otro', bloom: 'understand' },
    ])
  })

  it('finds the highest Bloom level of a set of concepts', () => {
    expect(highestBloom(graph, ['a', 'c'])).toBe('apply')
    expect(highestBloom(graph, ['a', 'ghost'])).toBe('remember')
    expect(highestBloom(graph, [])).toBe('understand')
  })

  it('trims lesson and module objectives to the limit and pads the missing ones', () => {
    const many = ['o1', 'o2', 'o3', 'o4'].map((text) => ({ text, bloom: 'apply' as const }))
    const { sections, warnings } = clampObjectives(
      [
        section('S', [
          moduleSpec(
            'Con',
            [
              lesson('L1', ['a', 'b'], { objectives: many }),
              lesson('L2', ['c'], { objectives: [] }),
            ],
            {
              objectives: many,
            },
          ),
          moduleSpec('Sin', [lesson('L3', ['a', 'c'], { objectives: [] }), lesson('L4', ['d'])], {
            objectives: [],
          }),
        ]),
      ],
      graph,
      ctx,
    )
    const lessons = allLessons(sections)
    expect(lessons[0]?.objectives).toEqual(many.slice(0, 3))
    expect(lessons[1]?.objectives).toEqual([{ text: 'o1', bloom: 'apply' }])
    expect(lessons[2]?.objectives).toEqual([{ text: 'A, C', bloom: 'apply' }])
    expect(sections[0]?.modules[0]?.objectives).toEqual(many.slice(0, 3))
    expect(sections[0]?.modules[1]?.objectives).toEqual([
      { text: 'A, C', bloom: 'apply' },
      { text: 'Explicar L4', bloom: 'understand' },
    ])
    expect(warnings).toEqual([
      {
        code: 'objectives_trimmed',
        stage: 'validate',
        params: { level: 'lesson', title: 'L1', dropped: 1 },
      },
      { code: 'objectives_padded', stage: 'validate', params: { level: 'lesson', title: 'L2' } },
      {
        code: 'objectives_trimmed',
        stage: 'validate',
        params: { level: 'module', title: 'Con', dropped: 1 },
      },
      { code: 'objectives_padded', stage: 'validate', params: { level: 'lesson', title: 'L3' } },
      { code: 'objectives_padded', stage: 'validate', params: { level: 'module', title: 'Sin' } },
    ])
  })

  it('leaves an empty module without lessons alone for the structure gate', () => {
    const { sections, warnings } = clampObjectives(
      [section('S', [moduleSpec('Vacío', [], { objectives: [] })])],
      graph,
      ctx,
    )
    expect(sections[0]?.modules[0]?.objectives).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('sortConceptIds()', () => {
  it('orders by book position and falls back to the id for unknown concepts', () => {
    expect(sortConceptIds(['d', 'zz', 'a', 'aa'], graph, ctx.sourceIds)).toEqual([
      'a',
      'd',
      'aa',
      'zz',
    ])
  })
})
