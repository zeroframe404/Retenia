import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import {
  IMPORTANCE_LEVELS,
  importanceMixSchema,
  rescheduleImpactSchema,
  URGENT_MODE_HOURS,
} from './memory'

const ID = '019213cd-0000-7000-8000-000000000001'
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `019213cd-0000-7000-8000-${String(i).padStart(12, '0')}`)

const impact = {
  affected: 1,
  skipped: { notInReview: 0, noMemoryState: 0, unchanged: 0 },
  dueInSevenDays: { before: 1, after: 0, delta: -1 },
  reviewsPerDay: { before: 0.033, after: 0.017, delta: -0.016 },
  byLevel: {
    urgent: { affected: 0, dueInSevenDaysDelta: 0 },
    high: { affected: 0, dueInSevenDaysDelta: 0 },
    normal: { affected: 1, dueInSevenDaysDelta: -1 },
    maintenance: { affected: 0, dueInSevenDaysDelta: 0 },
    paused: { affected: 0, dueInSevenDaysDelta: 0 },
  },
  changes: [
    {
      cardId: ID,
      level: 'normal' as const,
      currentDue: '2026-09-02T00:00:00.000Z',
      newDue: '2026-10-02T00:00:00.000Z',
      currentIntervalDays: 30,
      newIntervalDays: 60,
      deltaDays: 30,
      desiredRetention: 0.9,
    },
  ],
  computedAt: '2026-09-02T00:00:00.000Z',
}

describe('importance vocabulary', () => {
  /**
   * The five levels exist in three places — here, `packages/core`'s `IMPORTANCE_LEVELS`,
   * and the `CHECK` constraints `packages/db` builds on `knowledge_items.importance` and
   * `cards.importance_override` — because the architecture forbids this leaf package from
   * importing either of the others. This is the assertion that catches the drift.
   */
  it('matches the domain vocabulary the database enforces', () => {
    expect([...IMPORTANCE_LEVELS]).toEqual(['urgent', 'high', 'normal', 'maintenance', 'paused'])
  })

  it('offers only the two windows §7 rule 5 allows', () => {
    expect([...URGENT_MODE_HOURS]).toEqual([48, 72])
  })
})

describe('items.setImportance', () => {
  const { input, output } = contract['items.setImportance']

  it('takes a bounded list of ids and a level', () => {
    expect(input.parse({ ids: [ID], level: 'urgent' })).toEqual({ ids: [ID], level: 'urgent' })
    expect(output.parse({ updated: 3 })).toEqual({ updated: 3 })
  })

  it('rejects an empty list, which would silently mean "nothing"', () => {
    expect(input.safeParse({ ids: [], level: 'urgent' }).success).toBe(false)
  })

  it('caps the list so one call cannot turn into thousands of writes', () => {
    expect(input.safeParse({ ids: ids(500), level: 'normal' }).success).toBe(true)
    expect(input.safeParse({ ids: ids(501), level: 'normal' }).success).toBe(false)
  })

  it('rejects a level nobody has, and a null one — items always have a level', () => {
    expect(input.safeParse({ ids: [ID], level: 'critical' }).success).toBe(false)
    expect(input.safeParse({ ids: [ID], level: null }).success).toBe(false)
  })
})

describe('cards.overrideImportance', () => {
  const { input } = contract['cards.overrideImportance']

  it('takes a nullable level — null clears the override', () => {
    expect(input.parse({ ids: [ID], level: null })).toEqual({ ids: [ID], level: null })
  })

  it('takes an optional expiry, which is what makes it urgent mode', () => {
    expect(
      input.parse({ ids: [ID], level: 'urgent', expiresAt: '2026-09-04T00:00:00.000Z' }),
    ).toMatchObject({ expiresAt: '2026-09-04T00:00:00.000Z' })
    expect(input.safeParse({ ids: [ID], level: 'urgent', expiresAt: null }).success).toBe(true)
    expect(input.safeParse({ ids: [ID], level: 'urgent', expiresAt: 'tomorrow' }).success).toBe(
      false,
    )
  })
})

describe('memory.simulateReschedule byLevel', () => {
  it('requires every level, so no caller has to handle a missing bucket', () => {
    const { urgent: _urgent, ...missing } = impact.byLevel
    expect(rescheduleImpactSchema.safeParse({ ...impact, byLevel: missing }).success).toBe(false)
  })
})

describe('memory.importanceMix', () => {
  it('round-trips the guard §7 rule 4 asks for', () => {
    const mix = {
      entries: [{ level: 'urgent' as const, items: 3, cards: 6, share: 0.3 }],
      totalItems: 10,
      totalCards: 20,
      prioritizedShare: 0.3,
      threshold: 0.3,
      biasWarning: false,
      computedAt: '2026-09-02T00:00:00.000Z',
    }
    expect(contract['memory.importanceMix'].output.parse(mix)).toEqual(mix)
  })

  it('keeps every share a fraction, not a percentage', () => {
    expect(
      importanceMixSchema.safeParse({
        entries: [],
        totalItems: 0,
        totalCards: 0,
        prioritizedShare: 30,
        threshold: 0.3,
        biasWarning: true,
        computedAt: '2026-09-02T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })
})

describe('memory.simulateReschedule', () => {
  const { input, output } = contract['memory.simulateReschedule']

  it('takes no selection at all — that means every queued card', () => {
    expect(input.parse({})).toEqual({})
  })

  it('accepts each way of narrowing it', () => {
    expect(input.safeParse({ cardIds: [ID] }).success).toBe(true)
    expect(input.safeParse({ itemIds: [ID] }).success).toBe(true)
    expect(input.safeParse({ levels: ['urgent', 'high'] }).success).toBe(true)
    expect(input.safeParse({ limit: 20_000 }).success).toBe(true)
    expect(input.safeParse({ limit: 20_001 }).success).toBe(false)
    expect(input.safeParse({ levels: [] }).success).toBe(false)
  })

  it('round-trips an impact summary', () => {
    expect(output.parse(impact)).toEqual(impact)
  })

  it('requires real timestamps on every projected move', () => {
    expect(
      rescheduleImpactSchema.safeParse({
        ...impact,
        changes: [{ ...impact.changes[0], newDue: 'next month' }],
      }).success,
    ).toBe(false)
  })

  it('never books an interval shorter than a day', () => {
    expect(
      rescheduleImpactSchema.safeParse({
        ...impact,
        changes: [{ ...impact.changes[0], newIntervalDays: 0 }],
      }).success,
    ).toBe(false)
  })
})

describe('memory.rescheduleNow', () => {
  const { input } = contract['memory.rescheduleNow']

  /**
   * The confirmation lives in the schema, not the handler: an unconfirmed apply is rejected
   * at the bridge and never reaches main at all.
   */
  it('cannot be called without an explicit confirmation', () => {
    expect(input.safeParse({ cardIds: [ID] }).success).toBe(false)
    expect(input.safeParse({ cardIds: [ID], confirm: false }).success).toBe(false)
    expect(input.safeParse({ cardIds: [ID], confirm: 'yes' }).success).toBe(false)
    expect(input.safeParse({ cardIds: [ID], confirm: true }).success).toBe(true)
  })
})

describe('memory.startUrgentMode', () => {
  const { input, output } = contract['memory.startUrgentMode']

  it('defaults the window to the handler and accepts both §7 allows', () => {
    expect(input.parse({ itemIds: [ID] })).toEqual({ itemIds: [ID] })
    expect(input.safeParse({ itemIds: [ID], hours: 48 }).success).toBe(true)
    expect(input.safeParse({ itemIds: [ID], hours: 72 }).success).toBe(true)
  })

  it('refuses any other window', () => {
    expect(input.safeParse({ itemIds: [ID], hours: 24 }).success).toBe(false)
    expect(input.safeParse({ itemIds: [ID], hours: 168 }).success).toBe(false)
  })

  it('reports when the window closes', () => {
    expect(
      output.parse({ items: 1, cards: 2, expiresAt: '2026-09-04T00:00:00.000Z' }),
    ).toMatchObject({ cards: 2 })
    expect(output.safeParse({ items: 1, cards: 2, expiresAt: null }).success).toBe(false)
  })
})
