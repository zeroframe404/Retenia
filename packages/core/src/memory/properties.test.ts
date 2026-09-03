import { describe, expect, it } from 'vitest'
import { cardFixture } from '../testing/memory-fixtures'
import { nextMemoryState, STABILITY_MAX, STABILITY_MIN } from './formulas'
import { createFsrsScheduler } from './fsrs-scheduler'
import { DEFAULT_FSRS_W, DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { mulberry32 } from './prng'
import { DAY_MS } from './study-day'
import { GRADES } from './types'

/**
 * Property tests over random memory states (`docs/spec/02-memory-system.md` §3.2 (e), (f)):
 * with at least a day between reviews, Again never increases S and Good/Easy never
 * decrease it. Checked both on the closed forms and through the scheduler, so the wrapper
 * cannot break what the formulas guarantee.
 */

const CASES = 2000
const random = mulberry32(0x5eed)

/** Log-uniform in [S_MIN, S_MAX): every order of magnitude gets the same attention. */
function randomStability(): number {
  const lo = Math.log(STABILITY_MIN)
  const hi = Math.log(STABILITY_MAX)
  return Math.exp(lo + random() * (hi - lo))
}

function randomDifficulty(): number {
  return 1 + random() * 9
}

function randomElapsedDays(): number {
  return 1 + Math.floor(random() * 3650)
}

describe('stability monotonicity', () => {
  it('holds for the closed forms', () => {
    for (let i = 0; i < CASES; i++) {
      const state = { stability: randomStability(), difficulty: randomDifficulty() }
      const elapsed = randomElapsedDays()
      const again = nextMemoryState(DEFAULT_FSRS_W, state, elapsed, 1)
      expect(again.stability).toBeLessThanOrEqual(state.stability)
      for (const grade of [3, 4] as const) {
        const next = nextMemoryState(DEFAULT_FSRS_W, state, elapsed, grade)
        expect(next.stability).toBeGreaterThanOrEqual(Math.min(state.stability, STABILITY_MAX))
        expect(next.difficulty).toBeGreaterThanOrEqual(1)
        expect(next.difficulty).toBeLessThanOrEqual(10)
      }
      // Hard is not in the spec's statement, but it is a success too.
      expect(nextMemoryState(DEFAULT_FSRS_W, state, elapsed, 2).stability).toBeGreaterThanOrEqual(
        Math.min(state.stability, STABILITY_MAX),
      )
      // Easy is never worse than Good, Hard never better than Good.
      const hard = nextMemoryState(DEFAULT_FSRS_W, state, elapsed, 2).stability
      const good = nextMemoryState(DEFAULT_FSRS_W, state, elapsed, 3).stability
      const easy = nextMemoryState(DEFAULT_FSRS_W, state, elapsed, 4).stability
      expect(hard).toBeLessThanOrEqual(good)
      expect(good).toBeLessThanOrEqual(easy)
    }
  })

  it('holds through the scheduler for cards in Review', () => {
    const scheduler = createFsrsScheduler()
    const options = { ...DEFAULT_SCHEDULING_OPTIONS, fuzz: false }
    const now = new Date('2026-06-01T12:00:00Z')
    for (let i = 0; i < CASES; i++) {
      const elapsed = randomElapsedDays()
      const stability = Math.min(randomStability(), 30000)
      const card = cardFixture({
        state: 2,
        stability,
        difficulty: randomDifficulty(),
        reps: 1 + Math.floor(random() * 50),
        lastReview: new Date(now.getTime() - elapsed * DAY_MS),
        due: new Date(now.getTime() - random() * elapsed * DAY_MS),
      })
      const preview = scheduler.preview(card, now, options)
      expect(preview[1].card.stability).toBeLessThanOrEqual(stability)
      expect(preview[1].card.lapses).toBe(card.lapses + 1)
      expect(preview[1].card.state).toBe(3)
      for (const grade of [3, 4] as const) {
        expect(preview[grade].card.stability).toBeGreaterThanOrEqual(stability)
        expect(preview[grade].card.state).toBe(2)
        expect(preview[grade].card.due.getTime()).toBeGreaterThan(now.getTime())
      }
      for (const grade of GRADES) {
        const { card: after } = preview[grade]
        expect(after.difficulty).toBeGreaterThanOrEqual(1)
        expect(after.difficulty).toBeLessThanOrEqual(10)
        expect(after.stability).toBeGreaterThanOrEqual(STABILITY_MIN)
        expect(after.reps).toBe(card.reps + 1)
        expect(after.lastReview?.getTime()).toBe(now.getTime())
      }
      expect(preview[2].card.scheduledDays).toBeLessThan(preview[3].card.scheduledDays)
      expect(preview[3].card.scheduledDays).toBeLessThan(preview[4].card.scheduledDays)
      const r = scheduler.retrievability(card, now)
      expect(r).toBeGreaterThan(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })
})
