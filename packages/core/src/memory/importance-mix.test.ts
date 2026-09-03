import { describe, expect, it, vi } from 'vitest'
import type { ImportanceLevel } from '../entities'
import { fakeClock } from '../testing/in-memory-job-repository'
import { PRIORITY_BIAS_THRESHOLD } from './importance'
import { createImportanceMix, queuedTotal } from './importance-mix'

const NOW = new Date('2026-01-05T08:00:00.000Z')

type Counts = Record<ImportanceLevel, number>
const counts = (partial: Partial<Counts> = {}): Counts => ({
  urgent: 0,
  high: 0,
  normal: 0,
  maintenance: 0,
  paused: 0,
  ...partial,
})

function mixOver(items: Partial<Counts>, cards: Partial<Counts> = items) {
  return createImportanceMix({
    repos: {
      knowledgeItems: { countByImportance: vi.fn(async () => counts(items)) },
      cards: { countByImportance: vi.fn(async () => counts(cards)) },
    },
    clock: fakeClock(NOW.getTime()),
  })()
}

describe('queuedTotal', () => {
  it('sums every level but `paused` — a parked item is not competing for the day', () => {
    expect(queuedTotal(counts({ urgent: 2, normal: 8, paused: 100 }))).toBe(10)
  })
})

describe('createImportanceMix', () => {
  it('falls back to the spec catalog and the system clock when given neither', async () => {
    const before = Date.now()
    const mix = await createImportanceMix({
      repos: {
        knowledgeItems: { countByImportance: vi.fn(async () => counts({ normal: 1 })) },
        cards: { countByImportance: vi.fn(async () => counts({ normal: 2 })) },
      },
    })()
    expect(mix.entries.map((entry) => entry.level)[0]).toBe('urgent')
    expect(mix.computedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('reports every level in review order, with items and cards side by side', async () => {
    const mix = await mixOver({ urgent: 1, normal: 3 }, { urgent: 2, normal: 6 })
    expect(mix.entries.map((entry) => entry.level)).toEqual([
      'urgent',
      'high',
      'normal',
      'maintenance',
      'paused',
    ])
    expect(mix.entries[0]).toEqual({ level: 'urgent', items: 1, cards: 2, share: 0.25 })
    expect(mix.totalItems).toBe(4)
    expect(mix.totalCards).toBe(8)
    expect(mix.computedAt).toEqual(NOW)
  })

  it('has the shares of the queued levels sum to 1', async () => {
    const mix = await mixOver({ urgent: 1, high: 2, normal: 5, maintenance: 2, paused: 40 })
    const total = mix.entries.reduce((sum, entry) => sum + entry.share, 0)
    expect(total).toBeCloseTo(1, 12)
    // `paused` is counted, but contributes no share.
    expect(mix.entries[4]).toMatchObject({ level: 'paused', items: 40, share: 0 })
  })

  it('returns zeroes rather than NaN for an empty collection', async () => {
    const mix = await mixOver({})
    expect(mix.entries.every((entry) => entry.share === 0)).toBe(true)
    expect(mix.totalItems).toBe(0)
    expect(mix.prioritizedShare).toBe(0)
    expect(mix.biasWarning).toBe(false)
  })

  /** §7 rule 4: "limit Urgente + Alta to ~30 % — if everything is urgent, nothing is." */
  it('warns strictly above 30 %, not at it', async () => {
    const exactly = await mixOver({ urgent: 2, high: 1, normal: 7 })
    expect(exactly.prioritizedShare).toBeCloseTo(PRIORITY_BIAS_THRESHOLD, 12)
    expect(exactly.biasWarning).toBe(false)

    const over = await mixOver({ urgent: 3, high: 1, normal: 6 })
    expect(over.prioritizedShare).toBeCloseTo(0.4, 12)
    expect(over.biasWarning).toBe(true)
    expect(over.threshold).toBe(PRIORITY_BIAS_THRESHOLD)
  })

  it('measures the bias on items, so parking material cannot mask it', async () => {
    // 4 of 10 queued items are urgent or high; 900 paused items do not dilute that.
    const mix = await mixOver({ urgent: 4, normal: 6, paused: 900 })
    expect(mix.biasWarning).toBe(true)
  })

  it('reports card counts independently, so an override shows up in the load', async () => {
    const mix = await mixOver({ normal: 10 }, { urgent: 5, normal: 15 })
    expect(mix.biasWarning).toBe(false)
    expect(mix.entries[0]).toMatchObject({ level: 'urgent', items: 0, cards: 5 })
    expect(mix.totalCards).toBe(20)
  })
})
