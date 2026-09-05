import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import type { Card, CardPresentation } from '../families/cards'
import { sampleCards } from '../testing/samples'
import { validateCards } from './cards'

const withCards = (
  cards: Card[],
  rest: Partial<Activity<'cards'>> = {},
  presentation: CardPresentation = 'grade',
): Activity<'cards'> => {
  const base = sampleCards()
  return { ...base, ...rest, payload: { family: 'cards', presentation, cards } }
}
const codes = (activity: Activity<'cards'>) => validateCards(activity).map((issue) => issue.code)

describe('validateCards()', () => {
  it('passes the sample: the prompt equals the front, and the back is not on it', () => {
    expect(codes(sampleCards())).toEqual([])
  })

  it('card-count: a basic or reverse flashcard is one card; dialog cards may be many', () => {
    const two = [
      { id: 'c1', front: 'a1', back: 'b1' },
      { id: 'c2', front: 'a2', back: 'b2' },
    ]
    expect(codes(withCards(two))).toEqual(['card-count'])
    expect(
      codes(withCards(two, { type: 'dialog_cards', prompt: 'Vocabulario' }, 'dialog')),
    ).toEqual([])
  })

  it('card-presentation-mismatch: flashcards grade, dialog_cards asks yes/no', () => {
    const one = [{ id: 'c1', front: 'a', back: 'b' }]
    expect(codes(withCards(one, {}, 'dialog'))).toEqual(['card-presentation-mismatch'])
    expect(codes(withCards(one, { type: 'dialog_cards' }, 'grade'))).toEqual([
      'card-presentation-mismatch',
    ])
    expect(codes(withCards(one, { type: 'dialog_cards' }, 'dialog'))).toEqual([])
  })

  it('card-sides-equal is an error; the back on the front is a warning', () => {
    expect(codes(withCards([{ id: 'c1', front: 'París', back: 'PARÍS' }]))).toEqual([
      'card-sides-equal',
    ])
    const issues = validateCards(
      withCards([{ id: 'c1', front: 'La capital es París', back: 'París' }]),
    )
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['answer-in-prompt', 'warning'],
    ])
  })
})
