import type { Card, ImportanceLevel, JsonObject } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import {
  type BoostState,
  EMPTY_BOOST,
  isOurOverride,
  onBoostedReview,
  planBoost,
  readBoost,
  writeBoost,
} from './boost'

const NOW = new Date('2026-09-11T12:00:00Z')
const DAY_MS = 86_400_000

type PlanCard = Pick<
  Card,
  'id' | 'itemId' | 'suspended' | 'importanceOverride' | 'importanceOverrideExpiresAt'
>

function card(overrides: Partial<PlanCard> & { id: string }): PlanCard {
  return {
    itemId: overrides.id,
    suspended: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    ...overrides,
  }
}

describe('planBoost()', () => {
  it('excludes suspended cards', () => {
    const plan = planBoost([card({ id: 'c1', suspended: true })], new Map(), NOW)
    expect(plan.cardIds).toEqual([])
  })

  it('excludes cards with a permanent override (expiresAt null)', () => {
    const plan = planBoost(
      [card({ id: 'c1', importanceOverride: 'urgent', importanceOverrideExpiresAt: null })],
      new Map(),
      NOW,
    )
    expect(plan.cardIds).toEqual([])
  })

  it('excludes cards with an unexpired override', () => {
    const plan = planBoost(
      [
        card({
          id: 'c1',
          importanceOverride: 'urgent',
          importanceOverrideExpiresAt: new Date(NOW.getTime() + DAY_MS),
        }),
      ],
      new Map(),
      NOW,
    )
    expect(plan.cardIds).toEqual([])
  })

  it('includes a card whose override already expired', () => {
    const plan = planBoost(
      [
        card({
          id: 'c1',
          importanceOverride: 'urgent',
          importanceOverrideExpiresAt: new Date(NOW.getTime() - DAY_MS),
        }),
      ],
      new Map(),
      NOW,
    )
    expect(plan.cardIds).toEqual(['c1'])
  })

  it('excludes items whose importance is urgent, high or paused', () => {
    const importance = new Map<string, ImportanceLevel>([
      ['i-urgent', 'urgent'],
      ['i-high', 'high'],
      ['i-paused', 'paused'],
      ['i-normal', 'normal'],
      ['i-maintenance', 'maintenance'],
    ])
    const cards = [
      card({ id: 'c-urgent', itemId: 'i-urgent' }),
      card({ id: 'c-high', itemId: 'i-high' }),
      card({ id: 'c-paused', itemId: 'i-paused' }),
      card({ id: 'c-normal', itemId: 'i-normal' }),
      card({ id: 'c-maintenance', itemId: 'i-maintenance' }),
      card({ id: 'c-unknown', itemId: 'i-unknown' }),
    ]
    const plan = planBoost(cards, importance, NOW)
    expect(plan.cardIds).toEqual(['c-normal', 'c-maintenance', 'c-unknown'])
  })

  it('sets expiresAt to now + 14 days', () => {
    const plan = planBoost([], new Map(), NOW)
    expect(plan.expiresAt.getTime()).toBe(NOW.getTime() + 14 * DAY_MS)
  })
})

function state(overrides: Partial<BoostState> = {}): BoostState {
  return {
    cardIds: ['c1'],
    expiresAt: NOW.toISOString(),
    clean: {},
    cleared: [],
    ...overrides,
  }
}

describe('onBoostedReview()', () => {
  it('increments the clean count on rating 3 or 4', () => {
    const first = onBoostedReview(state(), 'c1', 3)
    expect(first.state.clean.c1).toBe(1)
    expect(first.release).toBe(false)

    const second = onBoostedReview(state({ clean: { c1: 1 } }), 'c1', 4)
    expect(second.state.clean.c1).toBe(2)
  })

  it('resets the clean count to 0 on rating 1 or 2', () => {
    const afterAgain = onBoostedReview(state({ clean: { c1: 1 } }), 'c1', 1)
    expect(afterAgain.state.clean.c1).toBe(0)
    expect(afterAgain.release).toBe(false)

    const afterHard = onBoostedReview(state({ clean: { c1: 1 } }), 'c1', 2)
    expect(afterHard.state.clean.c1).toBe(0)
  })

  it('sets release exactly once, on the review that reaches the policy count, and adds to cleared', () => {
    const reaching = onBoostedReview(state({ clean: { c1: 1 } }), 'c1', 3)
    expect(reaching.release).toBe(true)
    expect(reaching.state.cleared).toEqual(['c1'])

    // A further clean review on the same (now cleared) card never releases again.
    const again = onBoostedReview(reaching.state, 'c1', 3)
    expect(again.release).toBe(false)
    expect(again.state).toBe(reaching.state)
  })

  it('ignores a card not in cardIds', () => {
    const original = state()
    const result = onBoostedReview(original, 'unknown-card', 4)
    expect(result.release).toBe(false)
    expect(result.state).toBe(original)
  })

  it('ignores an already-cleared card', () => {
    const original = state({ cleared: ['c1'] })
    const result = onBoostedReview(original, 'c1', 4)
    expect(result.release).toBe(false)
    expect(result.state).toBe(original)
  })

  it('ignores rating 0 (a postpone) and returns the same state object', () => {
    const original = state()
    const result = onBoostedReview(original, 'c1', 0)
    expect(result.release).toBe(false)
    expect(result.state).toBe(original)
  })
})

describe('isOurOverride()', () => {
  const expiry = new Date('2026-09-25T12:00:00Z')
  const boosted = state({ expiresAt: expiry.toISOString() })

  it('is true for importanceOverride "high" with the same ISO expiry', () => {
    expect(
      isOurOverride({ importanceOverride: 'high', importanceOverrideExpiresAt: expiry }, boosted),
    ).toBe(true)
  })

  it('is false for "urgent", even with the same expiry', () => {
    expect(
      isOurOverride({ importanceOverride: 'urgent', importanceOverrideExpiresAt: expiry }, boosted),
    ).toBe(false)
  })

  it('is false for a different expiry', () => {
    expect(
      isOurOverride(
        {
          importanceOverride: 'high',
          importanceOverrideExpiresAt: new Date(expiry.getTime() + DAY_MS),
        },
        boosted,
      ),
    ).toBe(false)
  })

  it('is false when the card carries no expiry at all', () => {
    expect(
      isOurOverride({ importanceOverride: 'high', importanceOverrideExpiresAt: null }, boosted),
    ).toBe(false)
  })

  it('is false when state.expiresAt is null', () => {
    expect(
      isOurOverride(
        { importanceOverride: 'high', importanceOverrideExpiresAt: expiry },
        state({ expiresAt: null }),
      ),
    ).toBe(false)
  })
})

describe('readBoost() / writeBoost()', () => {
  it('round-trips a state through JSON', () => {
    const original = state({
      cardIds: ['c1', 'c2'],
      clean: { c1: 1, c2: 0 },
      cleared: ['c3'],
    })
    expect(readBoost(writeBoost(original))).toEqual(original)
  })

  it('round-trips the empty state', () => {
    expect(readBoost(writeBoost(EMPTY_BOOST))).toEqual(EMPTY_BOOST)
  })

  it('tolerates junk input', () => {
    const junk: JsonObject = { card_ids: 'x', clean: [1], cleared: [2, 'c'] }
    expect(readBoost(junk)).toEqual({
      cardIds: [],
      expiresAt: null,
      clean: {},
      cleared: ['c'],
    })
  })
})
