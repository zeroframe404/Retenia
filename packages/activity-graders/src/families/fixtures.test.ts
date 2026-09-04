import { parseActivity } from '@retenia/activity-schema'
import { loadFixtures, scoreMatches } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { gradeActivity } from '../grade-activity'

/**
 * Every valid fixture, every answer: the fixtures carry hand-computed expectations, so this is
 * the contract of every grader at once (`docs/spec/03-activities.md` §10: "pure and testable
 * with fixtures").
 */
const META = { timeMs: 0, attempts: 1, hintsUsed: 0 }
const cases = loadFixtures().valid.flatMap((fixture) =>
  fixture.data.answers.map((answer) => ({
    label: `${fixture.type}/${fixture.name} · ${answer.name}`,
    fixture,
    answer,
  })),
)

describe.each(cases)('$label', ({ fixture, answer }) => {
  it('grades as the fixture says', () => {
    const activity = parseActivity(fixture.data.activity)
    const result = gradeActivity(activity, answer.response, { ...META, ...answer.meta })
    expect(scoreMatches(result.score, answer.expect.score), `score ${result.score}`).toBe(true)
    expect(result.correct).toBe(answer.expect.correct)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.meta.attempts).toBe(answer.meta?.attempts ?? 1)
    if (answer.expect.perItem !== undefined) {
      for (const expected of answer.expect.perItem) {
        expect(result.perItem?.find((item) => item.id === expected.id)).toMatchObject(expected)
      }
    }
    if (answer.expect.signals !== undefined)
      expect(result.meta.signals).toEqual(answer.expect.signals)
    if (answer.expect.engine !== undefined) expect(result.meta.engine).toBe(answer.expect.engine)
    if (activity.family === 'cards')
      expect(result.rating).toBe((answer.response as { rating: number }).rating)
    else expect(result.rating).toBeNull()
  })
})
