import type { Activity } from '@retenia/activity-schema'
import { sampleActivities, sampleChoice } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { GraderUnsupportedError } from './errors'
import { gradeActivity } from './grade-activity'

const META = { timeMs: 3000, attempts: 1, hintsUsed: 0 }
const RESPONSES: Record<string, unknown> = {
  choice: { sets: [{ selected: ['a'] }] },
  text_input: { value: 'París' },
  cloze: { gaps: { g1: 'París' } },
  long_text: { text: 'luz solar, dióxido de carbono, glucosa' },
  pairs: {
    matches: [
      { left: 'p1', right: 'p1' },
      { left: 'p2', right: 'p2' },
      { left: 'p3', right: 'p3' },
    ],
  },
  ordering: { order: ['i1', 'i2', 'i3', 'i4'] },
  categorize: { placements: { i1: ['c1'], i2: ['c2'], i3: ['c1'] } },
  text_mark: { markedIds: ['t3', 't5'] },
  cards: { rating: 4 },
  disclosure: { openedIds: ['n1', 'n2'] },
}

describe('gradeActivity()', () => {
  it('dispatches every MVP family to its grader', () => {
    for (const activity of sampleActivities()) {
      const graded = gradeActivity(activity, RESPONSES[activity.family], META)
      expect(graded.score, activity.family).toBe(1)
      expect(graded.correct).toBe(true)
    }
  })

  it('throws for a placeholder family and for a malformed response', () => {
    const speech = {
      ...sampleChoice(),
      family: 'speech',
      type: 'speak_repeat',
      payload: { family: 'speech' },
    } as unknown as Activity
    expect(() => gradeActivity(speech, {}, META)).toThrow(GraderUnsupportedError)
    expect(() => gradeActivity(speech, {}, META)).toThrow('No pure grader for family "speech"')
    expect(() => gradeActivity(sampleChoice(), { value: 'a' }, META)).toThrow(
      expect.objectContaining({ name: 'ZodError' }),
    )
  })
})
