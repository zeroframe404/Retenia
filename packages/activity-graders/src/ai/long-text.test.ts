import type { Activity } from '@retenia/activity-schema'
import { sampleEssayRubric, sampleLongText } from '@retenia/activity-schema/testing'
import type { AiGradeResult, AiGrader } from '@retenia/core'
import { describe, expect, it, vi } from 'vitest'
import { createFakeAiGrader } from './fake-grader'
import { aiGradeToGradeResult, createLongTextAiGrader } from './long-text'

const META = { timeMs: 90_000, attempts: 1, hintsUsed: 0 }

const GRADED: AiGradeResult = {
  perCriterion: [
    {
      id: 'c1',
      criterion: 'Explica el mecanismo del espaciado',
      score: 1,
      weight: 2,
      level: 'Explica por qué el intervalo ayuda.',
    },
    { id: 'c2', criterion: 'Contrasta con el estudio masivo', score: 0.5, weight: 1 },
  ],
  score: 0.8333,
  rating: 3,
  feedback: 'Explicás bien el mecanismo; falta el contraste.',
  uncertain: false,
  evidence: [{ quote: 'los repasos distribuidos', criterionId: 'c1' }],
  engine: 'ai',
  injectionSuspected: false,
  model: 'claude-sonnet-5',
}

const ANSWER =
  'Con repasos distribuidos aparece la recuperación activa y la huella se refuerza cada vez.'

describe('aiGradeToGradeResult()', () => {
  it('keeps the rubric on meta.ai and reports key-point coverage as perItem', () => {
    const result = aiGradeToGradeResult(GRADED, sampleEssayRubric(), ANSWER, META)
    expect(result).toMatchObject({
      score: 0.8333,
      correct: true,
      feedback: 'Explicás bien el mecanismo; falta el contraste.',
      rating: 3,
    })
    expect(result.perItem).toEqual([
      { id: 'k1', correct: true, expected: 'repasos distribuidos' },
      { id: 'k2', correct: true, expected: 'recuperación activa' },
    ])
    expect(result.meta.engine).toBe('ai')
    expect(result.meta.ai).toEqual({
      perCriterion: GRADED.perCriterion,
      evidence: GRADED.evidence,
      model: 'claude-sonnet-5',
    })
    expect(result.meta.uncertain).toBeUndefined()
  })

  it('reports an uncertain grade with no rating, so nothing is scheduled', () => {
    const result = aiGradeToGradeResult(
      { ...GRADED, uncertain: true, rating: null },
      sampleEssayRubric(),
      ANSWER,
      META,
    )
    expect(result.rating).toBeNull()
    expect(result.meta.uncertain).toBe(true)
  })

  it('carries the injection flag through to the panel', () => {
    const result = aiGradeToGradeResult(
      { ...GRADED, injectionSuspected: true },
      sampleEssayRubric(),
      ANSWER,
      META,
    )
    expect(result.meta.ai?.injectionSuspected).toBe(true)
  })

  it('applies §9’s exam clamp but never re-derives the rubric’s rating', () => {
    // Easy is not available in an exam; the rubric's 4 is clamped to Good rather than recomputed.
    expect(
      aiGradeToGradeResult({ ...GRADED, rating: 4 }, sampleEssayRubric(), ANSWER, META, {
        context: 'exam_sim',
      }).rating,
    ).toBe(3)
    expect(
      aiGradeToGradeResult({ ...GRADED, rating: 4 }, sampleEssayRubric(), ANSWER, META).rating,
    ).toBe(4)
  })

  it('marks a low score incorrect and leaves perItem empty without key points', () => {
    const noPoints: Activity<'long_text'> = {
      ...sampleEssayRubric(),
      payload: { ...sampleEssayRubric().payload, keyPoints: undefined },
    }
    const result = aiGradeToGradeResult({ ...GRADED, score: 0.3 }, noPoints, ANSWER, META)
    expect(result.correct).toBe(false)
    expect(result.perItem).toEqual([])
  })
})

describe('createLongTextAiGrader()', () => {
  it('hands the activity and the answer to the port and returns a GradeResult', async () => {
    const grader = vi.fn<AiGrader>(async () => GRADED)
    const grade = createLongTextAiGrader(grader)
    const result = await grade(sampleEssayRubric(), { text: ANSWER }, META)

    expect(grader).toHaveBeenCalledTimes(1)
    expect(grader.mock.calls[0]?.[0]).toMatchObject({ answer: ANSWER, minWords: 40 })
    expect(result.rating).toBe(3)
  })

  it('runs end to end over the fake grader, offline', async () => {
    const grade = createLongTextAiGrader(createFakeAiGrader())
    const result = await grade(
      sampleLongText(),
      { text: 'Con luz solar y CO2 se produce glucosa.' },
      META,
    )
    expect(result).toMatchObject({ score: 1, correct: true, rating: 4, meta: { engine: 'fake' } })
  })

  it('rejects a response that is not a long_text answer', async () => {
    const grade = createLongTextAiGrader(createFakeAiGrader())
    await expect(grade(sampleLongText(), { value: 'nope' }, META)).rejects.toThrow()
  })

  it('passes an abort signal down to the port', async () => {
    const controller = new AbortController()
    const grader = vi.fn<AiGrader>(async () => GRADED)
    await createLongTextAiGrader(grader)(
      sampleEssayRubric(),
      { text: ANSWER },
      META,
      controller.signal,
    )
    expect(grader.mock.calls[0]?.[0].signal).toBe(controller.signal)
  })
})
