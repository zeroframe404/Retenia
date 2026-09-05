import type { Activity } from '@retenia/activity-schema'
import { sampleEssayRubric, sampleLongText } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { aiGradeInputFor, gradingSourcesOf } from './input'

describe('gradingSourcesOf()', () => {
  it('keeps the quoted refs, labels a string span, and drops a ref with no quote', () => {
    const activity: Activity<'long_text'> = {
      ...sampleLongText(),
      sources: [
        { docId: 'doc-1', span: 'p. 112', quote: 'La luz solar entra por la hoja.' },
        { docId: 'doc-1', span: { start: 10, end: 40 }, quote: 'Se produce glucosa.' },
        { docId: 'doc-2' },
      ],
    }
    expect(gradingSourcesOf(activity)).toEqual([
      { id: 'doc-1#0', quote: 'La luz solar entra por la hoja.', locator: 'p. 112' },
      { id: 'doc-1#1', quote: 'Se produce glucosa.' },
    ])
  })

  it('is empty for an activity with no sources at all', () => {
    expect(gradingSourcesOf(sampleLongText())).toEqual([])
  })
})

describe('aiGradeInputFor()', () => {
  it('carries only the fields the activity actually has', () => {
    const input = aiGradeInputFor(sampleLongText(), 'la luz solar produce glucosa')
    expect(input).toEqual({
      activity: {
        id: sampleLongText().id,
        type: 'free_recall',
        lang: 'es-AR',
        prompt: 'Explicá con tus palabras qué es la fotosíntesis.',
      },
      answer: 'la luz solar produce glucosa',
      keyPoints: sampleLongText().payload.keyPoints,
    })
  })

  it('maps a full essay: rubric, model answer, word range, instructions and the signal', () => {
    const controller = new AbortController()
    const input = aiGradeInputFor(sampleEssayRubric(), 'un ensayo', controller.signal)
    expect(input.rubric).toHaveLength(2)
    expect(input.reference).toContain('práctica espaciada')
    expect(input).toMatchObject({ minWords: 40, maxWords: 120 })
    expect(input.activity.instructions).toBe('Entre 40 y 120 palabras. Podés usar Markdown.')
    expect(input.signal).toBe(controller.signal)
  })

  it('omits the key points when the activity authored none', () => {
    const noPoints: Activity<'long_text'> = {
      ...sampleLongText(),
      payload: { family: 'long_text', modelAnswer: 'La planta usa luz solar.' },
    }
    const input = aiGradeInputFor(noPoints, 'un texto')
    expect(input.keyPoints).toBeUndefined()
    expect(input.reference).toBe('La planta usa luz solar.')
  })

  it('passes the source quotes through', () => {
    const activity: Activity<'long_text'> = {
      ...sampleEssayRubric(),
      sources: [{ docId: 'doc-1', quote: 'Cepeda 2006' }],
    }
    expect(aiGradeInputFor(activity, 'x').sources).toEqual([
      { id: 'doc-1#0', quote: 'Cepeda 2006' },
    ])
  })
})
