import type { Activity } from '@retenia/activity-schema'
import { sampleLongText } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { coversPhrase, gradeLongText } from './long-text'

const META = { timeMs: 60000, attempts: 1, hintsUsed: 0 }

describe('coversPhrase()', () => {
  it('finds the phrase verbatim, as a fuzzy token window, or not at all', () => {
    expect(coversPhrase('La LUZ solar entra por la hoja.', 'luz solar')).toBe(true)
    expect(coversPhrase('el dioxido de carbono entra', 'dióxido de carbono')).toBe(true)
    expect(coversPhrase('produce glucosa y oxigeno', 'glucosas')).toBe(true)
    expect(coversPhrase('hay condensacion en nubes', 'condensación')).toBe(true)
    expect(coversPhrase('el agua se evapora', 'evaporación')).toBe(false)
    expect(coversPhrase('nada que ver', 'fotosíntesis')).toBe(false)
    expect(coversPhrase('texto', '   ')).toBe(false)
    expect(coversPhrase('', 'luz')).toBe(false)
  })
})

describe('gradeLongText()', () => {
  it('weights key points and reports coverage', () => {
    const graded = gradeLongText(
      sampleLongText(),
      { text: 'Con luz solar y CO2 sale glucosa.' },
      META,
    )
    expect(graded).toMatchObject({
      score: 1,
      correct: true,
      feedback: 'Covered 3 of 3 key points.',
      meta: { engine: 'keypoints' },
    })
    expect(graded.perItem).toEqual([
      { id: 'k1', correct: true, expected: 'luz solar' },
      { id: 'k2', correct: true, expected: 'dióxido de carbono' },
      { id: 'k3', correct: true, expected: 'glucosa' },
    ])
    const weighted: Activity<'long_text'> = {
      ...sampleLongText(),
      payload: {
        family: 'long_text',
        keyPoints: [
          { id: 'a', text: 'uno', weight: 3 },
          { id: 'b', text: 'dos' },
        ],
      },
    }
    expect(gradeLongText(weighted, { text: 'solo el uno' }, META).score).toBe(0.75)
    expect(gradeLongText(weighted, { text: 'solo el dos' }, META).score).toBe(0.25)
  })

  it('has nothing to score without key points', () => {
    const none: Activity<'long_text'> = {
      ...sampleLongText(),
      payload: { family: 'long_text', modelAnswer: 'x' },
    }
    expect(gradeLongText(none, { text: 'cualquier cosa' }, META)).toMatchObject({
      score: 0,
      correct: false,
      perItem: [],
      feedback: 'No key points to grade.',
      meta: { engine: 'keypoints' },
    })
  })
})
