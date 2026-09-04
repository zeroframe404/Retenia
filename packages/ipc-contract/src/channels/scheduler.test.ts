import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import { LEECH_ACTIONS, schedulerProfileSchema, stepSchema } from './scheduler'

const JOB_ID = '019213cd-0000-7000-8000-000000000001'

const profile = {
  scope: 'global',
  algorithm: 'fsrs6',
  w: Array.from({ length: 21 }, () => 0.5),
  decay: 0.1542,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  enableFuzz: true,
  enableShortTerm: true,
  maximumInterval: 36500,
  dayStartHour: 4,
  trainedAt: null,
  nReviews: null,
  logLoss: null,
  rmse: null,
}

describe('scheduler vocabulary', () => {
  /**
   * `LEECH_ACTIONS` exists in three places — here, `packages/core`'s `entities/enums.ts`,
   * and the `CHECK` on `importance_levels.leech_action` — because this leaf package may
   * import neither of the others (`tooling/scripts/check-deps.mjs`). This is the assertion
   * that catches the drift.
   */
  it('matches the leech actions the database enforces', () => {
    expect([...LEECH_ACTIONS]).toEqual(['warn', 'warn_rewrite', 'edit', 'suspend', 'none'])
  })

  /** §4: short steps, and never one of a day or more with FSRS. */
  it('accepts minute and hour steps, and rejects days', () => {
    expect(stepSchema.safeParse('10m').success).toBe(true)
    expect(stepSchema.safeParse('1h').success).toBe(true)
    expect(stepSchema.safeParse('1d').success).toBe(false)
    expect(stepSchema.safeParse('10').success).toBe(false)
  })

  it('requires all 21 FSRS parameters', () => {
    expect(schedulerProfileSchema.safeParse(profile).success).toBe(true)
    expect(
      schedulerProfileSchema.safeParse({ ...profile, w: profile.w.slice(0, 20) }).success,
    ).toBe(false)
  })
})

describe('scheduler.status', () => {
  const { input, output } = contract['scheduler.status']

  it('takes nothing and returns the model, the history size and the offer', () => {
    expect(input.safeParse(undefined).success).toBe(true)
    expect(
      output.safeParse({
        profile,
        nReviews: 600,
        offer: { offered: true, reason: 'first', nextThresholdReviews: 512 },
      }).success,
    ).toBe(true)
  })

  it('allows a null reason, for "not yet time to retrain"', () => {
    expect(
      output.safeParse({
        profile,
        nReviews: 10,
        offer: { offered: false, reason: null, nextThresholdReviews: 512 },
      }).success,
    ).toBe(true)
  })
})

describe('scheduler.applyOptimization', () => {
  const { input } = contract['scheduler.applyOptimization']

  /** §16: the user sees the before/after numbers and decides. The confirmation is in the
   *  schema, so an unconfirmed apply cannot reach the handler at all. */
  it('refuses an unconfirmed apply', () => {
    expect(input.safeParse({ jobId: JOB_ID, confirm: true }).success).toBe(true)
    expect(input.safeParse({ jobId: JOB_ID, confirm: false }).success).toBe(false)
    expect(input.safeParse({ jobId: JOB_ID }).success).toBe(false)
  })
})

describe('scheduler.updateProfile', () => {
  const { input } = contract['scheduler.updateProfile']

  it('takes a partial patch but not an empty one', () => {
    expect(input.safeParse({ enableFuzz: false }).success).toBe(true)
    expect(input.safeParse({ learningSteps: ['1m', '10m'] }).success).toBe(true)
    expect(input.safeParse({}).success).toBe(false)
  })

  it('bounds the interval cap at §4’s 36,500 days', () => {
    expect(input.safeParse({ maximumInterval: 36500 }).success).toBe(true)
    expect(input.safeParse({ maximumInterval: 36501 }).success).toBe(false)
    expect(input.safeParse({ maximumInterval: 0 }).success).toBe(false)
  })
})

describe('scheduler.setLevel', () => {
  const { input } = contract['scheduler.setLevel']

  /** §6: 0.70–0.99 is what the algorithm allows; 0.80–0.95 is only what it recommends, and
   *  the screen shows the simulated cost rather than forbidding the extremes. */
  it('accepts the full retention range the algorithm allows', () => {
    expect(input.safeParse({ level: 'urgent', desiredRetention: 0.97 }).success).toBe(true)
    expect(input.safeParse({ level: 'normal', desiredRetention: 0.7 }).success).toBe(true)
    expect(input.safeParse({ level: 'normal', desiredRetention: 0.99 }).success).toBe(true)
    expect(input.safeParse({ level: 'normal', desiredRetention: 0.69 }).success).toBe(false)
    expect(input.safeParse({ level: 'normal', desiredRetention: 1 }).success).toBe(false)
  })

  /** `paused` has no retention and no cap: it is out of the queue entirely (§7). */
  it('allows clearing the retention and the cap', () => {
    expect(
      input.safeParse({ level: 'paused', desiredRetention: null, maxIntervalDays: null }).success,
    ).toBe(true)
  })

  it('rejects a patch that names a level and changes nothing', () => {
    expect(input.safeParse({ level: 'normal' }).success).toBe(false)
  })
})

describe('cards.disperseSiblings', () => {
  const { input, output } = contract['cards.disperseSiblings']

  it('is confirmed, and reports how many cards moved', () => {
    expect(input.safeParse({ itemId: JOB_ID, confirm: true }).success).toBe(true)
    expect(input.safeParse({ itemId: JOB_ID, confirm: false }).success).toBe(false)
    expect(output.safeParse({ moved: 3 }).success).toBe(true)
    expect(output.safeParse({ moved: -1 }).success).toBe(false)
  })
})
