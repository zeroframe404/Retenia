import { describe, expect, it } from 'vitest'
import { lesson, node, PRIMARY, ref, SECONDARY } from '../testing/graph-fixtures'
import { assignIds, positional, prerequisitesOf, sourceRefsOf } from './ids'
import type { LessonRef } from './lift'
import type { SizedLayout } from './module-size'

function refOf(id: string, outlineIndex: number): LessonRef {
  const [s, m, l] = id.split('.').map(Number) as [number, number, number]
  return {
    key: { s, m, l },
    id,
    lesson: lesson(id, ['x']),
    anchor: [0, outlineIndex],
    importance: 0.5,
    outlineIndex,
  }
}

describe('positional()', () => {
  it('pads to two digits and keeps going past 99', () => {
    expect(positional('L', 0)).toBe('L01')
    expect(positional('M', 9)).toBe('M10')
    expect(positional('L', 99)).toBe('L100')
  })
})

describe('assignIds()', () => {
  it('numbers sections, modules and lessons in final order across the whole path', () => {
    const layout: SizedLayout = {
      sections: [
        {
          s: 1,
          modules: [
            { s: 1, title: 'A', objectives: [], lessons: [refOf('1.0.1', 0), refOf('1.0.0', 1)] },
            { s: 1, title: 'B', objectives: [], lessons: [refOf('1.1.0', 2)] },
          ],
        },
        { s: 0, modules: [{ s: 0, title: 'C', objectives: [], lessons: [refOf('0.0.0', 3)] }] },
      ],
      warnings: [],
    }
    const numbered = assignIds(layout)
    expect(numbered.sectionIds).toEqual(['S01', 'S02'])
    expect(numbered.moduleIds).toEqual(['M01', 'M02', 'M03'])
    expect([...numbered.lessonIds.entries()]).toEqual([
      ['1.0.1', 'L01'],
      ['1.0.0', 'L02'],
      ['1.1.0', 'L03'],
      ['0.0.0', 'L04'],
    ])
  })
})

describe('prerequisitesOf()', () => {
  it('maps the direct prerequisites to their final ids, sorted and unique', () => {
    const lessonIds = new Map([
      ['0.0.0', 'L03'],
      ['0.0.1', 'L02'],
      ['0.0.2', 'L01'],
    ])
    const edges = [
      { from: '0.0.0', to: '0.0.1', confidence: 0.9, via: [] },
      { from: '0.0.2', to: '0.0.1', confidence: 0.5, via: [] },
      { from: '0.0.0', to: '0.0.1', confidence: 0.1, via: [] },
      { from: 'gone', to: '0.0.1', confidence: 0.1, via: [] },
      { from: '0.0.1', to: '0.0.2', confidence: 0.1, via: [] },
    ]
    expect(prerequisitesOf('0.0.1', edges, lessonIds)).toEqual(['L01', 'L03'])
    expect(prerequisitesOf('0.0.0', edges, lessonIds)).toEqual([])
  })
})

describe('sourceRefsOf()', () => {
  it('unions the refs of the concepts, one per chunk, primary source first, in book order', () => {
    const nodes = new Map([
      [
        'a',
        node('a', {
          source_refs: [
            ref('s1', { source_id: SECONDARY, ordinal: 1 }),
            ref('c4', { ordinal: 4, block_ids: ['b1'] }),
          ],
        }),
      ],
      ['b', node('b', { source_refs: [ref('c4', { ordinal: 4 }), ref('c2', { ordinal: 2 })] })],
    ])
    const refs = sourceRefsOf(['b', 'a', 'ghost'], nodes, [PRIMARY, SECONDARY])
    expect(refs.map((entry) => entry.chunk_id)).toEqual(['c2', 'c4', 's1'])
    // The first concept to name a chunk wins, and its block ids are copied, not shared.
    expect(refs[1]?.block_ids).toEqual([])
    const original = nodes.get('a')?.source_refs[1]?.block_ids
    expect(sourceRefsOf(['a'], nodes, [PRIMARY])[0]?.block_ids).not.toBe(original)
  })

  describe('sourceRefsOf() tie-breaks', () => {
    it('orders two chunks at the same position of one source by chunk id', () => {
      const nodes = new Map([
        ['a', node('a', { source_refs: [ref('z9', { ordinal: 4 }), ref('c4', { ordinal: 4 })] })],
      ])
      expect(sourceRefsOf(['a'], nodes, [PRIMARY]).map((entry) => entry.chunk_id)).toEqual([
        'c4',
        'z9',
      ])
    })
  })
})
