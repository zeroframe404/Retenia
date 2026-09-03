import { bench, describe } from 'vitest'
import { cardFixture } from '../testing/memory-fixtures'
import { createFsrsScheduler } from './fsrs-scheduler'
import { DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { DAY_MS } from './study-day'

/**
 * `pnpm --filter @retenia/core bench`. The budget of sub-phase 4.1 is 10,000 `apply`
 * calls under 200 ms (`fsrs-scheduler.test.ts` asserts it, best of three); this is the
 * finer picture: which state costs what, and what a real time zone adds.
 */

const now = new Date('2026-06-01T12:00:00Z')
const reviewCard = cardFixture({
  state: 2,
  stability: 12.3,
  difficulty: 5.2,
  reps: 6,
  lastReview: new Date(now.getTime() - 10 * DAY_MS),
  due: new Date(now.getTime() - DAY_MS),
})
const newCard = cardFixture()

describe('FsrsScheduler.apply', () => {
  const utc = createFsrsScheduler()
  const buenosAires = createFsrsScheduler({ timeZone: 'America/Argentina/Buenos_Aires' })
  const noFuzz = { ...DEFAULT_SCHEDULING_OPTIONS, fuzz: false }

  bench('Review card, Good, fuzz on (UTC)', () => {
    utc.apply(reviewCard, now, 3, DEFAULT_SCHEDULING_OPTIONS)
  })
  bench('Review card, Good, fuzz off (UTC)', () => {
    utc.apply(reviewCard, now, 3, noFuzz)
  })
  bench('New card, Good (UTC)', () => {
    utc.apply(newCard, now, 3, DEFAULT_SCHEDULING_OPTIONS)
  })
  bench('Review card, Good, fuzz on (Buenos Aires)', () => {
    buenosAires.apply(reviewCard, now, 3, DEFAULT_SCHEDULING_OPTIONS)
  })
  bench('preview, Review card (UTC)', () => {
    utc.preview(reviewCard, now, DEFAULT_SCHEDULING_OPTIONS)
  })
})
