import { describe, expect, it } from 'vitest'
import { node } from '../testing/graph-fixtures'
import { buildFinalExam } from './exam'
import { DEFAULT_SEQUENCING_LIMITS } from './types'

const limits = DEFAULT_SEQUENCING_LIMITS
const one = () => 1

function nodesWith(importances: Record<string, number>) {
  return new Map(
    Object.entries(importances).map(([id, importance]) => [id, node(id, { importance })]),
  )
}

const hundredths = (weights: readonly number[]) =>
  weights.reduce((sum, weight) => sum + Math.round(weight * 100), 0)

describe('buildFinalExam()', () => {
  it('weighs modules by their total importance and sums to exactly one', () => {
    const exam = buildFinalExam(
      [
        { id: 'M01', concept_ids: ['a'] },
        { id: 'M02', concept_ids: ['b'] },
        { id: 'M03', concept_ids: ['c', 'ghost'] },
      ],
      nodesWith({ a: 1, b: 0.5, c: 0.5 }),
      one,
      limits,
    )
    expect(exam).toEqual({
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: {
        topics: [
          { module_id: 'M01', weight: 0.5 },
          { module_id: 'M02', weight: 0.25 },
          { module_id: 'M03', weight: 0.25 },
        ],
        item_count: 20,
      },
      estimated_minutes: 30,
    })
  })

  it('gives the rounding remainder to the earlier module on a tie', () => {
    const exam = buildFinalExam(
      ['M01', 'M02', 'M03'].map((id, index) => ({ id, concept_ids: [`c${index}`] })),
      nodesWith({ c0: 0.6, c1: 0.6, c2: 0.6 }),
      one,
      limits,
    )
    expect(exam.blueprint.topics.map((topic) => topic.weight)).toEqual([0.34, 0.33, 0.33])
  })

  it('shares the exam equally when nothing has importance', () => {
    const exam = buildFinalExam(
      [
        { id: 'M01', concept_ids: ['a'] },
        { id: 'M02', concept_ids: [] },
      ],
      nodesWith({ a: 0 }),
      one,
      limits,
    )
    expect(exam.blueprint.topics.map((topic) => topic.weight)).toEqual([0.5, 0.5])
  })

  it('applies the coverage of each module, and never a negative one', () => {
    const exam = buildFinalExam(
      [
        { id: 'M01', concept_ids: ['a'] },
        { id: 'M02', concept_ids: ['b'] },
        { id: 'M03', concept_ids: ['c'] },
      ],
      nodesWith({ a: 1, b: 1, c: 1 }),
      (id) => ({ M01: 0.5, M02: 1, M03: -1 })[id] ?? 1,
      limits,
    )
    expect(exam.blueprint.topics.map((topic) => topic.weight)).toEqual([0.33, 0.67, 0])
  })

  it('always rounds to a whole hundred, whatever the shares', () => {
    for (const importances of [
      [0.1, 0.2, 0.7],
      [1, 1, 1, 1, 1, 1, 1],
      [0.05, 0.95],
      [0.3, 0.3, 0.3, 0.1],
    ]) {
      const exam = buildFinalExam(
        importances.map((_, index) => ({ id: `M${index}`, concept_ids: [`c${index}`] })),
        nodesWith(Object.fromEntries(importances.map((value, index) => [`c${index}`, value]))),
        one,
        limits,
      )
      expect(hundredths(exam.blueprint.topics.map((topic) => topic.weight))).toBe(100)
    }
  })

  it('sizes the exam from the module count within the band, and has none without modules', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({ id: `M${index}`, concept_ids: [] }))
    expect(buildFinalExam(twelve, nodesWith({}), one, limits).blueprint.item_count).toBe(40)
    expect(buildFinalExam([], nodesWith({}), one, limits)).toMatchObject({
      blueprint: { topics: [], item_count: 0 },
      estimated_minutes: 0,
    })
  })
})
