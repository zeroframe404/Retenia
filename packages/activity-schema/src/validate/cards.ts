import type { Activity } from '../envelope'
import { normalizeText } from '../normalize'
import { leakIssues, normalizedIncludes } from './common'
import { type Issue, type IssuePath, issue } from './types'

export function validateCards(activity: Activity<'cards'>): Issue[] {
  const issues: Issue[] = []
  const { cards } = activity.payload

  if (
    (activity.type === 'flashcard_basic' || activity.type === 'flashcard_reverse') &&
    cards.length !== 1
  ) {
    issues.push(
      issue(
        'card-count',
        ['payload', 'cards'],
        `"${activity.type}" is one card, got ${cards.length}`,
      ),
    )
  }
  cards.forEach((card, index) => {
    const path: IssuePath = ['payload', 'cards', index]
    if (normalizeText(card.front) === normalizeText(card.back)) {
      issues.push(
        issue('card-sides-equal', path, `card "${card.id}" has the same text on both sides`),
      )
    } else if (normalizedIncludes(card.front, card.back)) {
      issues.push(
        issue(
          'answer-in-prompt',
          [...path, 'back'],
          `the back of card "${card.id}" appears on its front`,
          'warning',
        ),
      )
    }
  })
  // The back is the answer; the prompt of a flashcard is usually its front, so this catches the same leak there.
  issues.push(
    ...leakIssues(
      activity,
      cards.map((card, index) => ({ text: card.back, path: ['payload', 'cards', index, 'back'] })),
    ),
  )
  return issues
}
