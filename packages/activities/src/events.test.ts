import { describe, expect, it } from 'vitest'
import { ACTIVITY_VERBS, type ActivityEventContext, activityEvent, isoDuration } from './events'

const OBJECT = { id: 'act-1', type: 'mcq_single', family: 'choice' } as const
const CONTEXT: ActivityEventContext = {
  skills: ['capital-francia'],
  mode: 'study',
  attempt: 1,
  hintsUsed: 0,
  seed: 'session-1',
}
const TIMESTAMP = '2026-09-04T10:00:00.000Z'

describe('isoDuration', () => {
  it('renders milliseconds as an ISO-8601 duration', () => {
    expect(isoDuration(0)).toBe('PT0S')
    expect(isoDuration(1_500)).toBe('PT1.5S')
    expect(isoDuration(12_340)).toBe('PT12.34S')
  })

  it('rounds to the two decimals xAPI recommends', () => {
    expect(isoDuration(1_234)).toBe('PT1.23S')
  })

  it('clamps a negative duration to zero', () => {
    expect(isoDuration(-5)).toBe('PT0S')
  })
})

describe('activityEvent', () => {
  it('names the event after the verb and carries the object and context', () => {
    const event = activityEvent({
      verb: 'presented',
      object: OBJECT,
      context: CONTEXT,
      elapsedMs: 0,
      timestamp: TIMESTAMP,
    })
    expect(event).toEqual({
      name: 'activity.presented',
      verb: 'presented',
      object: OBJECT,
      context: CONTEXT,
      timestamp: TIMESTAMP,
    })
  })

  it('adds result.score / success / duration when a grade is passed', () => {
    const event = activityEvent({
      verb: 'graded',
      object: OBJECT,
      context: CONTEXT,
      elapsedMs: 8_200,
      timestamp: TIMESTAMP,
      result: {
        score: 0.75,
        correct: false,
        feedback: '',
        rating: 2,
        meta: { timeMs: 8_200, attempts: 1, hintsUsed: 0 },
      },
    })
    expect(event.result).toEqual({ score: 0.75, success: false, duration: 'PT8.2S' })
  })

  it('omits result entirely when there is no grade — a presented event has no score', () => {
    const event = activityEvent({
      verb: 'skipped',
      object: OBJECT,
      context: CONTEXT,
      result: null,
      elapsedMs: 1_000,
      timestamp: TIMESTAMP,
    })
    expect(event).not.toHaveProperty('result')
  })

  it('covers the five verbs of §9', () => {
    expect(ACTIVITY_VERBS).toEqual(['presented', 'answered', 'graded', 'completed', 'skipped'])
    for (const verb of ACTIVITY_VERBS) {
      expect(
        activityEvent({
          verb,
          object: OBJECT,
          context: CONTEXT,
          elapsedMs: 0,
          timestamp: TIMESTAMP,
        }).name,
      ).toBe(`activity.${verb}`)
    }
  })
})
