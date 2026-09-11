import type { LessonStatus } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { warning } from '../schemas/warnings'
import {
  type CoverageLesson,
  type CoverageTree,
  coreLessonsSettled,
  coverageWeightedTopics,
  moduleCoverage,
} from './coverage'

/** Stage 9's coverage read-back (sub-phase 8.5): §3 stage 5's "importance × coverage". */

function lesson(
  conceptIds: readonly string[],
  status: LessonStatus = 'ready',
  uncovered: readonly string[] = [],
  kind: CoverageLesson['kind'] = 'core',
): CoverageLesson {
  return {
    kind,
    status,
    conceptIds,
    qa:
      uncovered.length === 0
        ? { warnings: [] }
        : {
            warnings: [
              warning('concept_uncovered', { lesson: 'L01', concept_ids: [...uncovered] }),
            ],
          },
  }
}

function treeOf(...modules: readonly (readonly CoverageLesson[])[]): CoverageTree {
  return { sections: [{ modules: modules.map((lessons) => ({ lessons })) }] }
}

describe('coreLessonsSettled()', () => {
  it('is true once every core lesson is ready or failed, whatever the other kinds do', () => {
    expect(coreLessonsSettled(treeOf([lesson(['a']), lesson(['b'], 'failed')]))).toBe(true)
    expect(
      coreLessonsSettled(treeOf([lesson(['a']), lesson(['r'], 'generating', [], 'remediation')])),
    ).toBe(true)
  })

  it('is false while a core lesson is pending, generating or in QA', () => {
    for (const status of ['pending', 'generating', 'qa'] as const) {
      expect(coreLessonsSettled(treeOf([lesson(['a']), lesson(['b'], status)]))).toBe(false)
    }
  })

  it('is false for a tree with no core lesson at all', () => {
    expect(coreLessonsSettled(treeOf([]))).toBe(false)
  })
})

describe('moduleCoverage()', () => {
  const importance: Record<string, number> = { a: 0.9, b: 0.3, c: 0.6 }
  const importanceOf = (id: string) => importance[id] ?? 0

  it('weighs a concept the gate flagged uncovered out, by importance', () => {
    const tree = treeOf([lesson(['a', 'b'], 'ready', ['b'])])
    const coverage = moduleCoverage(tree, [{ id: 'M01', concept_ids: ['a', 'b'] }], importanceOf)
    expect(coverage.get('M01')).toBeCloseTo(0.9 / 1.2, 10)
  })

  it('counts every concept of a failed lesson as missing', () => {
    const tree = treeOf([lesson(['a']), lesson(['c'], 'failed')])
    const coverage = moduleCoverage(tree, [{ id: 'M01', concept_ids: ['a', 'c'] }], importanceOf)
    expect(coverage.get('M01')).toBeCloseTo(0.9 / 1.5, 10)
  })

  it('keeps a concept one lesson missed when another lesson taught it', () => {
    const tree = treeOf([lesson(['a'], 'ready', ['a']), lesson(['a'])])
    expect(moduleCoverage(tree, [{ id: 'M01', concept_ids: ['a'] }], importanceOf).get('M01')).toBe(
      1,
    )
  })

  it('reads a lesson without a parseable QA record, and a concept no lesson claims, as covered', () => {
    const tree = treeOf([{ kind: 'core', status: 'ready', conceptIds: ['a'], qa: null }])
    const coverage = moduleCoverage(
      tree,
      [
        { id: 'M01', concept_ids: ['a', 'c'] },
        { id: 'M02', concept_ids: [] },
      ],
      importanceOf,
    )
    expect(coverage.get('M01')).toBe(1)
    expect(coverage.get('M02')).toBe(1)
  })

  it('falls back to a share of the concepts when none of them has any importance', () => {
    const tree = treeOf([lesson(['x', 'y'], 'ready', ['y'])])
    expect(moduleCoverage(tree, [{ id: 'M01', concept_ids: ['x', 'y'] }], () => 0).get('M01')).toBe(
      0.5,
    )
  })
})

describe('coverageWeightedTopics()', () => {
  it('scales each topic by its coverage and renormalises to one', () => {
    const topics = coverageWeightedTopics(
      [
        { module_id: 'M01', weight: 0.6 },
        { module_id: 'M02', weight: 0.4 },
      ],
      new Map([
        ['M01', 0.5],
        ['M02', 1],
      ]),
    )
    expect(topics).toEqual([
      { module_id: 'M01', weight: 0.4286, coverage: 0.5 },
      { module_id: 'M02', weight: 0.5714, coverage: 1 },
    ])
  })

  it('keeps a topic with no measurement at full coverage, and all-zero at zero', () => {
    expect(coverageWeightedTopics([{ module_id: 'M09', weight: 1 }], new Map())).toEqual([
      { module_id: 'M09', weight: 1, coverage: 1 },
    ])
    expect(
      coverageWeightedTopics([{ module_id: 'M01', weight: 1 }], new Map([['M01', 0]])),
    ).toEqual([{ module_id: 'M01', weight: 0, coverage: 0 }])
  })
})
