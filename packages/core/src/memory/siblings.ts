import type { Card } from '../entities'
import {
  DAY_MS,
  type DayBoundary,
  resolveDayBoundary,
  studyDayNumber,
  studyDayStart,
} from './study-day'
import { CARD_STATE } from './types'

/**
 * Siblings (`docs/spec/02-memory-system.md` §4): the other cards of the same item — a
 * reverse, another cloze, another occlusion mask.
 *
 * Two mechanisms, and they are not the same thing:
 *
 * - **Bury.** Reviewing one card of an item hides its siblings until the next study day, so
 *   the answer to one does not give away another. `composeSession` proposes the burials and
 *   `startSession` applies them.
 * - **Disperse.** A one-off user action that spreads the siblings' *due dates* onto
 *   different days, so they stop colliding every time. This is §4's "disperse siblings"
 *   and it is what this module's `disperseSiblingDueDates` plans.
 *
 * Note the neighbouring `disperseSiblings` in `session.ts`, which only reorders positions
 * *within* one already-composed queue. Same word, different scope: that one changes the
 * order of today's session, this one changes when the cards come back at all.
 */

/**
 * When a card buried now comes back: the start of the next study day.
 *
 * Not `now + 24 h`, which is the bug this replaces. Burying at 23:00 with a 24-hour offset
 * hides the card until 23:00 *tomorrow* — past tomorrow's session, so the sibling silently
 * skips a whole day.
 */
export function siblingBurialUntil(now: Date, boundary: Partial<DayBoundary> = {}): Date {
  const resolved = resolveDayBoundary(boundary)
  return studyDayStart(new Date(now.getTime() + DAY_MS), resolved.dayStartHour, resolved.timeZone)
}

export interface SiblingDispersal {
  cardId: string
  from: Date
  to: Date
}

/** Cards are pushed at most this far from where they were, so dispersing never turns into
 *  a postpone of a card the user is actively learning. */
export const MAX_SIBLING_SPREAD_DAYS = 14

/**
 * Plan a dispersal for one item's cards.
 *
 * The earliest-due card keeps its date — dispersing should not delay the whole item — and
 * each later sibling that lands on an already-taken day moves to the next free one. Only
 * cards in `Review` are moved: a card still walking its learning steps has a due date
 * measured in minutes, and pushing it a day would drop it out of the steps entirely.
 *
 * Pure: the caller applies each move with `Scheduler.postpone`, which moves `due` without
 * touching S or D and writes a `rating: 0` log, so the optimizer never sees a dispersal as
 * an answer.
 */
export function disperseSiblingDueDates(input: {
  cards: readonly Card[]
  now: Date
  boundary?: Partial<DayBoundary>
  maxSpreadDays?: number
}): SiblingDispersal[] {
  const boundary = resolveDayBoundary(input.boundary ?? {})
  const maxSpread = input.maxSpreadDays ?? MAX_SIBLING_SPREAD_DAYS
  const dayOf = (at: Date): number => studyDayNumber(at, boundary.dayStartHour, boundary.timeZone)
  const today = dayOf(input.now)

  const movable = input.cards
    .filter(
      (card) => card.state === CARD_STATE.Review && !card.suspended && card.deletedAt === null,
    )
    .sort((a, b) => a.due.getTime() - b.due.getTime() || (a.id < b.id ? -1 : 1))

  const taken = new Set<number>()
  const moves: SiblingDispersal[] = []
  for (const card of movable) {
    const original = dayOf(card.due)
    // A card already overdue is dispersed from today, not from the day it was booked for.
    let day = Math.max(original, today)
    while (taken.has(day) && day - original < maxSpread) day += 1
    taken.add(day)
    if (day === original) continue
    moves.push({
      cardId: card.id,
      from: card.due,
      to: new Date(card.due.getTime() + (day - original) * DAY_MS),
    })
  }
  return moves
}
