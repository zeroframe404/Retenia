import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgressThrottle } from './progress-throttle'

describe('progress throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = (intervalMs = 100) => {
    const emit = vi.fn<(payload: string) => void>()
    return { emit, throttle: createProgressThrottle({ emit, intervalMs, now: () => Date.now() }) }
  }

  it('emits the first update immediately — a bar that waits looks broken', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    expect(emit).toHaveBeenCalledExactlyOnceWith('first')
  })

  it('coalesces a burst into one trailing emit carrying the newest value', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    emit.mockClear()

    throttle.push('a', 'second')
    throttle.push('a', 'third')
    throttle.push('a', 'fourth')
    expect(emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(emit).toHaveBeenCalledExactlyOnceWith('fourth')
  })

  it('does not push the trailing emit further out as updates keep arriving', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    emit.mockClear()

    // A job reporting every 10 ms would starve a throttle that re-armed its timer on each
    // push: the trailing emit is due 100 ms after the first one inside the window, and must
    // still land there however many updates arrive in between.
    for (let tick = 0; tick < 10; tick += 1) {
      throttle.push('a', `update-${tick}`)
      vi.advanceTimersByTime(10)
    }
    expect(emit).toHaveBeenCalledOnce()
  })

  it('settles at ~10 Hz for a job reporting continuously', () => {
    const { emit, throttle } = setup()
    for (let ms = 0; ms < 1000; ms += 5) {
      throttle.push('a', `at-${ms}`)
      vi.advanceTimersByTime(5)
    }
    // 1 s at 100 ms apart: 10 or 11 depending on where the leading edge lands.
    expect(emit.mock.calls.length).toBeGreaterThanOrEqual(10)
    expect(emit.mock.calls.length).toBeLessThanOrEqual(11)
  })

  it('throttles each job independently', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'a1')
    throttle.push('b', 'b1')
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('flushes the pending value at once, so a terminal event is never stale', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    emit.mockClear()

    throttle.push('a', 'last')
    throttle.flush('a')
    expect(emit).toHaveBeenCalledExactlyOnceWith('last')

    // The timer must not fire a second copy afterwards.
    vi.advanceTimersByTime(500)
    expect(emit).toHaveBeenCalledOnce()
  })

  it('flushing with nothing pending emits nothing', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    emit.mockClear()
    throttle.flush('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('treats a job as new again after a flush, so its next run leads', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    throttle.flush('a')
    emit.mockClear()

    throttle.push('a', 'second')
    expect(emit).toHaveBeenCalledExactlyOnceWith('second')
  })

  it('leaves no timer behind on dispose', () => {
    const { emit, throttle } = setup()
    throttle.push('a', 'first')
    throttle.push('a', 'pending')
    emit.mockClear()

    throttle.dispose()
    vi.advanceTimersByTime(500)
    expect(emit).not.toHaveBeenCalled()
  })
})
