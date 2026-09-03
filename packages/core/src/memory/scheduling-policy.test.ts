import { describe, expect, it } from 'vitest'
import { cardFixture } from '../testing/memory-fixtures'
import { DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { createDefaultSchedulingPolicy } from './scheduling-policy'

describe('createDefaultSchedulingPolicy', () => {
  it('hands every card the same options, the spec defaults unless told otherwise', async () => {
    const policy = createDefaultSchedulingPolicy()
    const input = { card: cardFixture(), item: null, now: new Date() }
    expect(await policy.optionsFor(input)).toBe(DEFAULT_SCHEDULING_OPTIONS)
    const custom = createDefaultSchedulingPolicy({
      ...DEFAULT_SCHEDULING_OPTIONS,
      desiredRetention: 0.85,
    })
    expect((await custom.optionsFor(input)).desiredRetention).toBe(0.85)
  })

  it('refuses invalid options up front', () => {
    expect(() =>
      createDefaultSchedulingPolicy({ ...DEFAULT_SCHEDULING_OPTIONS, maxIntervalDays: 0 }),
    ).toThrow(RangeError)
  })
})
