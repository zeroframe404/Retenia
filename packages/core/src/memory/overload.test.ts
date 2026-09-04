import { describe, expect, it } from 'vitest'
import type { ImportanceLevel } from '../entities'
import { cardFixture } from '../testing/memory-fixtures'
import { POSTPONE_FACTOR } from './importance'
import { type PostponeCandidate, postponeDays, selectPostponements } from './overload'
import { DAY_MS } from './study-day'

/**
 * Overload protection — `docs/spec/02-memory-system.md` §7 rule 3:
 *
 * > if `due_today × median_time > capacity`, postpone with factor 1.1 starting with
 * > Mantenimiento and with the highest-S items (least damage); never Urgente.
 */

const NOW = new Date('2026-06-01T12:00:00Z')

let sequence = 0
function candidate(
  level: ImportanceLevel,
  stability: number,
  scheduledDays = 10,
): PostponeCandidate {
  sequence += 1
  return {
    level,
    card: cardFixture({
      id: `019a0000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
      state: 2,
      stability,
      scheduledDays,
      lastReview: new Date(NOW.getTime() - 12 * DAY_MS),
      due: new Date(NOW.getTime() - 2 * DAY_MS),
    }),
  }
}

/** 10 minutes at 60 s a card is a capacity of exactly 10. */
const BUDGET = { budgetMinutes: 10, medianSeconds: 60 }

function select(candidates: PostponeCandidate[], backlogDays = 5) {
  return selectPostponements({ candidates, now: NOW, backlogDays, ...BUDGET })
}

describe('when the day fits the budget', () => {
  it('postpones nothing and reports a completed share of 1', () => {
    const { proposals, summary } = select([candidate('normal', 10), candidate('maintenance', 10)])
    expect(proposals).toEqual([])
    expect(summary.overloaded).toBe(false)
    expect(summary.completedShare).toBe(1)
    expect(summary.postponedCards).toBe(0)
  })

  it('reports a completed share of 1, not NaN, for an empty day', () => {
    expect(select([]).summary.completedShare).toBe(1)
  })
})

describe('choosing what to sacrifice', () => {
  it('never postpones urgent, however deep the backlog', () => {
    const urgent = Array.from({ length: 30 }, () => candidate('urgent', 500))
    const { proposals, summary } = select(urgent, 99)
    expect(proposals).toEqual([])
    // §7: urgent "may exceed the daily limit (catch-up)" — the day stays over budget.
    expect(summary.overloaded).toBe(true)
    expect(summary.stillOverBudget).toBe(true)
  })

  it('never includes an urgent card in a mixed queue', () => {
    const urgent = Array.from({ length: 10 }, () => candidate('urgent', 500))
    const normal = Array.from({ length: 20 }, () => candidate('normal', 500))
    const { proposals } = select([...urgent, ...normal])
    const urgentIds = new Set(urgent.map((entry) => entry.card.id))
    expect(proposals).not.toHaveLength(0)
    expect(proposals.some((proposal) => urgentIds.has(proposal.cardId))).toBe(false)
    expect(proposals.every((proposal) => proposal.level === 'normal')).toBe(true)
  })

  it('takes maintenance before normal — SuperMemo’s Mercy', () => {
    const maintenance = Array.from({ length: 5 }, () => candidate('maintenance', 10))
    const normal = Array.from({ length: 15 }, () => candidate('normal', 10))
    const { proposals } = select([...normal, ...maintenance])
    expect(proposals).toHaveLength(10)
    expect(proposals.slice(0, 5).every((p) => p.level === 'maintenance')).toBe(true)
    expect(proposals.slice(5).every((p) => p.level === 'normal')).toBe(true)
  })

  it('takes the most stable cards first inside a level — least damage', () => {
    const cards = [
      candidate('normal', 5),
      candidate('normal', 400),
      candidate('normal', 50),
      ...Array.from({ length: 17 }, () => candidate('normal', 1)),
    ]
    const { proposals } = select(cards)
    expect(proposals.slice(0, 3).map((p) => p.stability)).toEqual([400, 50, 5])
  })

  it('leaves high alone until the backlog is more than two days deep', () => {
    const high = Array.from({ length: 30 }, () => candidate('high', 100))
    expect(select(high, 1.9).proposals).toHaveLength(0)
    expect(select(high, 2.1).proposals).not.toHaveLength(0)
  })

  it('stops as soon as what is left fits the budget', () => {
    // Capacity 10, 25 cards ⇒ 15 postponed, 10 kept.
    const { proposals, summary } = select(Array.from({ length: 25 }, () => candidate('normal', 10)))
    expect(proposals).toHaveLength(15)
    expect(summary.keptCards).toBe(10)
    expect(summary.stillOverBudget).toBe(false)
  })
})

describe('the new due date', () => {
  it('is today + ceil(scheduledDays × 0.1) — factor 1.1', () => {
    const { proposals } = select([...Array.from({ length: 20 }, () => candidate('normal', 10, 30))])
    const proposal = proposals[0]
    expect(proposal?.addedDays).toBe(3)
    expect(proposal?.newDue).toEqual(new Date(NOW.getTime() + 3 * DAY_MS))
  })

  it('never adds less than a day, so a postponed card is not proposed again at once', () => {
    expect(postponeDays(0, POSTPONE_FACTOR)).toBe(1)
    expect(postponeDays(1, POSTPONE_FACTOR)).toBe(1)
    expect(postponeDays(9, POSTPONE_FACTOR)).toBe(1)
    expect(postponeDays(365, POSTPONE_FACTOR)).toBe(37)
  })
})

describe('the summary', () => {
  it('is structured data the UI renders — "hoy hiciste 80 %, pospuse 40 …"', () => {
    const maintenance = Array.from({ length: 40 }, () => candidate('maintenance', 10))
    const normal = Array.from({ length: 10 }, () => candidate('normal', 10))
    const { summary } = selectPostponements({
      candidates: [...maintenance, ...normal],
      now: NOW,
      backlogDays: 5,
      medianSeconds: 60,
      // Capacity 10 of 50 planned ⇒ 40 postponed, all of them maintenance.
      budgetMinutes: 10,
    })
    expect(summary.plannedCards).toBe(50)
    expect(summary.keptCards).toBe(10)
    expect(summary.postponedCards).toBe(40)
    expect(summary.completedShare).toBeCloseTo(0.2, 10)
    expect(summary.byLevel).toEqual([{ level: 'maintenance', count: 40 }])
    expect(summary.estimatedMinutes).toBe(10)
    // No Spanish (or English) sentence anywhere: copy is i18n's, not core's.
    expect(JSON.stringify(summary)).not.toMatch(/pospuse|postponed \d/i)
  })

  it('lists only the levels that actually lost cards, in sacrifice order', () => {
    const { summary } = select([
      ...Array.from({ length: 5 }, () => candidate('maintenance', 10)),
      ...Array.from({ length: 15 }, () => candidate('normal', 10)),
      ...Array.from({ length: 3 }, () => candidate('urgent', 10)),
    ])
    expect(summary.byLevel.map((entry) => entry.level)).toEqual(['maintenance', 'normal'])
  })
})
