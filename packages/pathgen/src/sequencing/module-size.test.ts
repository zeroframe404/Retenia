import { describe, expect, it } from 'vitest'
import { lesson, moduleSpec, nodeAt, outline, PRIMARY, section } from '../testing/graph-fixtures'
import type { ModuleSpec, Outline, ValidatedSynthesis } from '../validate/types'
import { orderHierarchy } from './hierarchy'
import { liftGraph } from './lift'
import { fitModuleSizes } from './module-size'
import { DEFAULT_SEQUENCING_LIMITS } from './types'

const bounds = DEFAULT_SEQUENCING_LIMITS.lessonsPerModule

let counter = 0
/** A module of `count` lessons, each teaching one fresh concept. */
function moduleOf(title: string, count: number, objectives = 1): ModuleSpec {
  const lessons = Array.from({ length: count }, (_, index) => {
    counter += 1
    return lesson(`${title}-${index + 1}`, [`k${counter}`])
  })
  return moduleSpec(title, lessons, {
    objectives: Array.from({ length: objectives }, (_, index) => ({
      text: `${title} objetivo ${index + 1}`,
      bloom: 'understand' as const,
    })),
  })
}

function layoutOf(spec: Outline) {
  const nodes = spec.sections.flatMap((entry) =>
    entry.modules.flatMap((module) =>
      module.lesson_specs.flatMap((item) =>
        item.concept_ids.map((id) => nodeAt(id, `c${Number(id.slice(1))}`)),
      ),
    ),
  )
  const validated: ValidatedSynthesis = {
    graph: { nodes, edges: [] },
    outline: spec,
    warnings: [],
    fatal: null,
  }
  const hierarchy = orderHierarchy(liftGraph(validated, [PRIMARY]), spec)
  return fitModuleSizes(hierarchy.sections, spec, bounds, 3)
}

function shape(layout: ReturnType<typeof layoutOf>): Array<Array<[string, number]>> {
  return layout.sections.map((entry) =>
    entry.modules.map((module) => [module.title, module.lessons.length]),
  )
}

describe('fitModuleSizes()', () => {
  it('leaves modules of 3–7 lessons alone', () => {
    const layout = layoutOf(outline([section('S', [moduleOf('A', 3), moduleOf('B', 7)])]))
    expect(shape(layout)).toEqual([
      [
        ['A', 3],
        ['B', 7],
      ],
    ])
    expect(layout.warnings).toEqual([])
  })

  it('merges a short module into the one before it, keeping the receiver’s title', () => {
    const layout = layoutOf(outline([section('S', [moduleOf('A', 3, 2), moduleOf('B', 2, 2)])]))
    expect(shape(layout)).toEqual([[['A', 5]]])
    expect(layout.sections[0]?.modules[0]?.objectives.map((entry) => entry.text)).toEqual([
      'A objetivo 1',
      'A objetivo 2',
      'B objetivo 1',
    ])
    expect(layout.warnings).toEqual([
      { code: 'module_merged', stage: 'sequence', params: { module: 'B', into: 'A' } },
    ])
  })

  it('merges a short first module forward into the next', () => {
    const layout = layoutOf(outline([section('S', [moduleOf('A', 1), moduleOf('B', 3)])]))
    expect(shape(layout)).toEqual([[['B', 4]]])
    expect(layout.sections[0]?.modules[0]?.lessons.map((ref) => ref.lesson.title)).toEqual([
      'A-1',
      'B-1',
      'B-2',
      'B-3',
    ])
    expect(layout.warnings).toEqual([
      { code: 'module_merged', stage: 'sequence', params: { module: 'A', into: 'B' } },
    ])

    // The first module of the path goes forward across a section boundary when it must.
    const across = layoutOf(
      outline([section('S1', [moduleOf('A', 2)]), section('S2', [moduleOf('B', 4)])]),
    )
    expect(shape(across)).toEqual([[['B', 6]]])
    expect(across.warnings.map((entry) => entry.code)).toEqual(['module_merged', 'section_dropped'])
  })

  it('merges across a section boundary only when the section has no other module, and says so', () => {
    const layout = layoutOf(
      outline([section('S1', [moduleOf('A', 4)]), section('S2', [moduleOf('B', 2)])]),
    )
    expect(layout.sections).toHaveLength(1)
    expect(shape(layout)).toEqual([[['A', 6]]])
    expect(layout.warnings.map((entry) => entry.code)).toEqual(['module_merged', 'section_dropped'])
    expect(layout.warnings[1]?.params).toEqual({ section: 'S2' })

    // A short first module of a section goes forward into its own section, not back.
    const forward = layoutOf(
      outline([
        section('S1', [moduleOf('A', 4)]),
        section('S2', [moduleOf('B', 2), moduleOf('C', 3)]),
      ]),
    )
    expect(shape(forward)).toEqual([[['A', 4]], [['C', 5]]])
    expect(forward.warnings.map((entry) => entry.code)).toEqual(['module_merged'])
  })

  it('splits a long module evenly and labels the parts', () => {
    const layout = layoutOf(outline([section('S', [moduleOf('A', 9)])]))
    expect(shape(layout)).toEqual([
      [
        ['A (1/2)', 5],
        ['A (2/2)', 4],
      ],
    ])
    expect(layout.warnings).toEqual([
      { code: 'module_split', stage: 'sequence', params: { module: 'A', parts: 2 } },
    ])
  })

  it('splits again when a merge pushes a module over the ceiling', () => {
    const layout = layoutOf(outline([section('S', [moduleOf('A', 6), moduleOf('B', 2)])]))
    expect(shape(layout)).toEqual([
      [
        ['A (1/2)', 4],
        ['A (2/2)', 4],
      ],
    ])
    expect(layout.warnings.map((entry) => entry.code)).toEqual(['module_merged', 'module_split'])
  })

  it('leaves a path of fewer than three lessons as it is, and reports it', () => {
    const layout = layoutOf(outline([section('S', [moduleOf('A', 1), moduleOf('B', 1)])]))
    expect(shape(layout)).toEqual([
      [
        ['A', 1],
        ['B', 1],
      ],
    ])
    expect(layout.warnings).toEqual([
      { code: 'path_too_small', stage: 'sequence', params: { lessons: 2 } },
    ])
  })

  it('has nothing to say about an empty hierarchy', () => {
    const layout = fitModuleSizes([], outline([]), bounds, 3)
    expect(layout).toEqual({ sections: [], warnings: [] })
  })
})
