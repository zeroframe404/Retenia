import { describe, expect, it } from 'vitest'
import { sampleActivities, sampleChoice } from '../testing/samples'
import { checkActivity, validateActivity } from './index'

/** The two validation layers of `docs/spec/03-activities.md` §11 over raw JSON. */
describe('validateActivity()', () => {
  it('runs every MVP sample clean', () => {
    for (const sample of sampleActivities()) {
      expect(validateActivity(sample), sample.type).toEqual([])
    }
  })

  it('runs only the shared rules on a placeholder family', () => {
    const speech = {
      ...sampleChoice(),
      family: 'speech' as const,
      type: 'speak_repeat' as const,
      grading: { method: 'speech' as const },
      review: { eligible: true, ratingStrategy: 'speech' as const },
      payload: { family: 'speech' as const, targetText: 'x' },
    }
    expect(validateActivity(speech)).toEqual([])
    expect(validateActivity({ ...speech, skills: [] }).map((issue) => issue.code)).toEqual([
      'skills-required',
    ])
  })
})

describe('checkActivity()', () => {
  it('reports the schema layer with zod paths', () => {
    const result = checkActivity({ ...sampleChoice(), difficulty: 9 })
    expect(result.ok).toBe(false)
    if (result.ok || result.layer !== 'schema') throw new Error('expected a schema failure')
    expect(result.issues[0]).toMatchObject({
      code: 'schema',
      path: ['difficulty'],
      severity: 'error',
    })
  })

  it('reports the rules layer with the parsed activity, and warnings do not fail', () => {
    const base = sampleChoice()
    const twoCorrect = {
      ...base,
      payload: {
        ...base.payload,
        sets: [
          {
            ...base.payload.sets[0],
            options: base.payload.sets[0]?.options.map((o) => ({ ...o, correct: true })),
          },
        ],
      },
    }
    const failed = checkActivity(twoCorrect)
    if (failed.ok || failed.layer !== 'rules') throw new Error('expected a rules failure')
    expect(failed.activity.type).toBe('mcq_single')
    expect(failed.issues.map((issue) => issue.code)).toEqual([
      'choice-single-correct-count',
      'choice-all-correct',
    ])

    const warned = checkActivity({ ...base, prompt: 'París: ¿capital de Francia?' })
    expect(warned.ok).toBe(true)
    if (!warned.ok) throw new Error('expected ok')
    expect(warned.warnings.map((issue) => issue.code)).toEqual(['answer-in-prompt'])
  })
})
