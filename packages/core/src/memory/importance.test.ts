import { describe, expect, it } from 'vitest'
import type { ImportanceLevelConfig } from '../entities'
import { IMPORTANCE_LEVELS } from '../entities'
import {
  createImportanceCatalog,
  DEFAULT_IMPORTANCE_CATALOG,
  DEFAULT_IMPORTANCE_LEVELS,
  IMPORTANCE_POLICIES,
  MAINTENANCE_RETENTION_MAX,
  MAINTENANCE_RETENTION_MIN,
  POSTPONE_FACTOR,
} from './importance'

function row(overrides: Partial<ImportanceLevelConfig>): ImportanceLevelConfig {
  const at = new Date('2026-09-02T00:00:00.000Z')
  return {
    id: '019a0000-0000-7000-8000-00000000f001',
    name: 'normal',
    ...DEFAULT_IMPORTANCE_LEVELS.normal,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deviceId: 'test-device',
    version: 1,
    ...overrides,
  }
}

describe('DEFAULT_IMPORTANCE_LEVELS', () => {
  /**
   * §7's table, and the five rows migration `0001` seeds. `packages/core` cannot reach a
   * database, so this is the copy the scheduler actually runs on and this test is what
   * keeps it honest; `packages/db`'s `schema.test.ts` asserts the seeded rows against the
   * same numbers from the other side.
   */
  it('carries the numbers of docs/spec/02-memory-system.md §7', () => {
    expect(DEFAULT_IMPORTANCE_LEVELS).toEqual({
      urgent: {
        desiredRetention: 0.95,
        maxIntervalDays: 180,
        orderRank: 1,
        postponeAllowed: false,
        newPerDay: null,
        leechThreshold: 8,
        leechAction: 'warn',
      },
      high: {
        desiredRetention: 0.92,
        maxIntervalDays: 365,
        orderRank: 2,
        postponeAllowed: true,
        newPerDay: 20,
        leechThreshold: 8,
        leechAction: 'warn_rewrite',
      },
      normal: {
        desiredRetention: 0.9,
        maxIntervalDays: 1825,
        orderRank: 3,
        postponeAllowed: true,
        newPerDay: 15,
        leechThreshold: 8,
        leechAction: 'edit',
      },
      maintenance: {
        desiredRetention: 0.85,
        maxIntervalDays: 3650,
        orderRank: 4,
        postponeAllowed: true,
        newPerDay: 0,
        leechThreshold: 8,
        leechAction: 'suspend',
      },
      paused: {
        desiredRetention: null,
        maxIntervalDays: null,
        orderRank: 5,
        postponeAllowed: false,
        newPerDay: 0,
        leechThreshold: 8,
        leechAction: 'none',
      },
    })
  })

  it('gives every level a policy', () => {
    expect(Object.keys(IMPORTANCE_POLICIES).sort()).toEqual([...IMPORTANCE_LEVELS].sort())
  })
})

describe('IMPORTANCE_POLICIES', () => {
  it('spells out §7’s "Under overload" column', () => {
    expect(IMPORTANCE_POLICIES.urgent.postpone).toBe('never')
    expect(IMPORTANCE_POLICIES.urgent.backlogDaysBeforePostpone).toBe(Number.POSITIVE_INFINITY)
    expect(IMPORTANCE_POLICIES.high.postpone).toBe('backlog_only')
    expect(IMPORTANCE_POLICIES.high.backlogDaysBeforePostpone).toBe(2)
    expect(IMPORTANCE_POLICIES.normal.postpone).toBe('standard')
    expect(IMPORTANCE_POLICIES.normal.postponeFactor).toBe(POSTPONE_FACTOR)
    expect(IMPORTANCE_POLICIES.maintenance.postpone).toBe('first')
    expect(IMPORTANCE_POLICIES.paused.postpone).toBe('not_queued')
  })

  it('spells out §7’s "New/day" column', () => {
    expect(IMPORTANCE_POLICIES.urgent.newItems).toBe('unlimited')
    expect(IMPORTANCE_POLICIES.high.newItems).toBe('priority')
    expect(IMPORTANCE_POLICIES.normal.newItems).toBe('quota')
    expect(IMPORTANCE_POLICIES.maintenance.newItems).toBe('none')
    expect(IMPORTANCE_POLICIES.paused.newItems).toBe('none')
  })

  it('takes only `paused` out of the queue', () => {
    expect(IMPORTANCE_LEVELS.filter((level) => !IMPORTANCE_POLICIES[level].queued)).toEqual([
      'paused',
    ])
  })
})

describe('createImportanceCatalog', () => {
  it('falls back to the spec for every level nobody supplied', () => {
    const catalog = createImportanceCatalog()
    expect(catalog.get('normal').desiredRetention).toBe(0.9)
    expect(catalog.get('paused').desiredRetention).toBeNull()
    expect(catalog.ordered().map((entry) => entry.level)).toEqual([
      'urgent',
      'high',
      'normal',
      'maintenance',
      'paused',
    ])
  })

  it('lets a stored row win', () => {
    const catalog = createImportanceCatalog([row({ name: 'normal', desiredRetention: 0.93 })])
    expect(catalog.get('normal').desiredRetention).toBe(0.93)
    // The untouched levels keep the spec's numbers.
    expect(catalog.get('high').desiredRetention).toBe(0.92)
  })

  it('ignores a soft-deleted row rather than leaving the level unschedulable', () => {
    const catalog = createImportanceCatalog([
      row({ name: 'normal', desiredRetention: 0.93, deletedAt: new Date() }),
    ])
    expect(catalog.get('normal').desiredRetention).toBe(0.9)
  })

  it('clamps maintenance into §7’s 0.80–0.85 band', () => {
    expect(
      createImportanceCatalog([row({ name: 'maintenance', desiredRetention: 0.95 })]).get(
        'maintenance',
      ).desiredRetention,
    ).toBe(MAINTENANCE_RETENTION_MAX)
    expect(
      createImportanceCatalog([row({ name: 'maintenance', desiredRetention: 0.5 })]).get(
        'maintenance',
      ).desiredRetention,
    ).toBe(MAINTENANCE_RETENTION_MIN)
  })

  it('clamps every other level into the 0.70–0.99 the schema and ts-fsrs allow', () => {
    expect(
      createImportanceCatalog([row({ name: 'urgent', desiredRetention: 1.5 })]).get('urgent')
        .desiredRetention,
    ).toBe(0.99)
    expect(
      createImportanceCatalog([row({ name: 'urgent', desiredRetention: 0.1 })]).get('urgent')
        .desiredRetention,
    ).toBe(0.7)
  })

  /** `assertSchedulingOptions` requires an integer ≥ 1, so a fractional or zero cap in the
   *  database must not reach it. */
  it('floors the cap to an integer of at least a day', () => {
    expect(
      createImportanceCatalog([row({ name: 'normal', maxIntervalDays: 12.7 })]).get('normal')
        .maxIntervalDays,
    ).toBe(12)
    expect(
      createImportanceCatalog([row({ name: 'normal', maxIntervalDays: 0 })]).get('normal')
        .maxIntervalDays,
    ).toBe(1)
  })

  it('treats a non-finite stored number as absent', () => {
    const catalog = createImportanceCatalog([
      row({
        name: 'normal',
        desiredRetention: Number.NaN,
        maxIntervalDays: Number.NaN,
        newPerDay: Number.NaN,
        orderRank: Number.NaN,
        leechThreshold: Number.NaN,
      }),
    ])
    const normal = catalog.get('normal')
    expect(normal.desiredRetention).toBeNull()
    expect(normal.maxIntervalDays).toBeNull()
    expect(normal.newPerDay).toBeNull()
    expect(normal.orderRank).toBe(3)
    expect(normal.leechThreshold).toBe(8)
  })

  it('normalizes the counts a hand-edited row could carry', () => {
    const normal = createImportanceCatalog([
      row({ name: 'normal', newPerDay: -4, orderRank: 2.6, leechThreshold: 0 }),
    ]).get('normal')
    expect(normal.newPerDay).toBe(0)
    expect(normal.orderRank).toBe(2)
    expect(normal.leechThreshold).toBe(1)
  })

  it('ignores a row for a level that does not exist', () => {
    const catalog = createImportanceCatalog([
      row({ name: 'invented' as never, desiredRetention: 0.71 }),
    ])
    expect(catalog.ordered()).toHaveLength(5)
  })

  it('orders by rank, and `compare` sorts a queue the same way', () => {
    // Two levels sharing a rank still sort deterministically, by name.
    const catalog = createImportanceCatalog([
      row({ name: 'high', orderRank: 3 }),
      row({ name: 'normal', orderRank: 3 }),
    ])
    expect(catalog.ordered().map((entry) => entry.level)).toEqual([
      'urgent',
      'high',
      'normal',
      'maintenance',
      'paused',
    ])
    expect(catalog.compare('urgent', 'maintenance')).toBeLessThan(0)
    expect(catalog.compare('paused', 'urgent')).toBeGreaterThan(0)
    expect(catalog.compare('normal', 'normal')).toBe(0)
    expect(
      ['paused', 'normal', 'urgent'].sort((a, b) => catalog.compare(a as never, b as never)),
    ).toEqual(['urgent', 'normal', 'paused'])
  })
})

describe('DEFAULT_IMPORTANCE_CATALOG', () => {
  it('is the spec catalog, ready to use with no database', () => {
    expect(DEFAULT_IMPORTANCE_CATALOG.get('urgent').maxIntervalDays).toBe(180)
  })
})
