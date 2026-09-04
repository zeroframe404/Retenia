import { bench, describe } from 'vitest'
import type { ImportanceLevel } from '../entities'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { createFsrsScheduler } from './fsrs-scheduler'
import { DEFAULT_IMPORTANCE_CATALOG } from './importance'
import { selectPostponements } from './overload'
import { resolveImportance } from './scheduling-policy'
import { composeSession, resolveSessionSettings, type SessionCandidate } from './session'
import { DAY_MS } from './study-day'

/**
 * `pnpm --filter @retenia/core bench`. The budget of sub-phase 4.3 is a 2,000-card backlog
 * composed under 100 ms (`session.test.ts` asserts it, best of three); this is the finer
 * picture: how composition scales, and what the sibling dispersion and the overload sweep
 * each cost.
 *
 * There are deliberately **no assertions** here, as in `hybrid-search.bench.ts`: a threshold
 * that fails on a busy CI runner teaches nothing. The numbers are read, recorded in the PR
 * and compared over time.
 */

const NOW = new Date('2026-06-01T12:00:00Z')
const scheduler = createFsrsScheduler({ dayStartHour: 0 })
const LEVELS = ['urgent', 'high', 'normal', 'maintenance'] as const

function backlog(size: number, cardsPerItem: number): SessionCandidate[] {
  return Array.from({ length: size }, (_, i) => {
    const level = LEVELS[i % LEVELS.length] as ImportanceLevel
    const itemId = `019a0000-0000-7000-8000-item${String(Math.floor(i / cardsPerItem)).padStart(8, '0')}`
    const item = knowledgeItemFixture({ id: itemId, importance: level })
    const card = cardFixture({
      id: `019a0000-0000-7000-8000-card${String(i).padStart(8, '0')}`,
      itemId,
      state: 2,
      stability: 5 + (i % 300),
      difficulty: 5,
      scheduledDays: 1 + (i % 20),
      reps: 4,
      lastReview: new Date(NOW.getTime() - (5 + (i % 40)) * DAY_MS),
      due: new Date(NOW.getTime() - (1 + (i % 10)) * DAY_MS),
    })
    return { card, item, resolution: resolveImportance({ card, item, now: NOW }) }
  })
}

const settings = resolveSessionSettings({ budgetMinutes: 600 })
const tight = resolveSessionSettings({ budgetMinutes: 5 })

function run(due: SessionCandidate[], useSettings = settings): void {
  composeSession({
    now: NOW,
    settings: useSettings,
    due,
    newCards: [],
    scheduler,
    catalog: DEFAULT_IMPORTANCE_CATALOG,
    dayBoundary: { dayStartHour: 0 },
  })
}

describe('composeSession', () => {
  const small = backlog(200, 2)
  const target = backlog(2_000, 2)
  const large = backlog(10_000, 2)
  const noSiblings = backlog(2_000, 1)
  const heavySiblings = backlog(2_000, 8)

  bench('200 cards', () => run(small))
  bench('2,000 cards (the sub-phase budget)', () => run(target))
  bench('10,000 cards (the read cap)', () => run(large))
  bench('2,000 cards, no siblings', () => run(noSiblings))
  bench('2,000 cards, 8 cards per item', () => run(heavySiblings))
  bench('2,000 cards, overloaded (5-minute budget)', () => run(target, tight))
})

describe('selectPostponements', () => {
  const candidates = backlog(2_000, 2).map(({ card, resolution }) => ({
    card,
    level: resolution.level,
  }))

  bench('2,000 candidates, day fits the budget', () => {
    selectPostponements({
      candidates,
      now: NOW,
      medianSeconds: 8,
      budgetMinutes: 600,
      backlogDays: 0.1,
    })
  })
  bench('2,000 candidates, deep backlog', () => {
    selectPostponements({
      candidates,
      now: NOW,
      medianSeconds: 8,
      budgetMinutes: 5,
      backlogDays: 6,
    })
  })
})
