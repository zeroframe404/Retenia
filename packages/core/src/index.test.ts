import { describe, expect, it } from 'vitest'
import type { Clock, IdGenerator } from './index'
import { systemClock } from './index'

describe('@retenia/core ports', () => {
  it('systemClock.now() returns a real Date close to the wall clock', () => {
    const before = Date.now()
    const now = systemClock.now()
    const after = Date.now()

    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(after)
  })

  it('Clock and IdGenerator are structural ports any implementation can satisfy', () => {
    const fixedClock: Clock = { now: () => new Date(0) }
    const counter: IdGenerator = { next: () => '0000-fake-id' }

    expect(fixedClock.now().getTime()).toBe(0)
    expect(counter.next()).toBe('0000-fake-id')
  })
})
