import { describe, expect, it } from 'vitest'
import { runPool } from './pool'

describe('runPool()', () => {
  it('runs every item once, at most `concurrency` at a time, in order of start', async () => {
    const started: number[] = []
    let inFlight = 0
    let peak = 0
    await runPool([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
      started.push(item)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
    })
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(peak).toBe(3)
  })

  it('stops handing out work once asked to, and never starts more workers than items', async () => {
    const seen: number[] = []
    let stop = false
    await runPool(
      [1, 2, 3, 4],
      10,
      async (item) => {
        seen.push(item)
        stop = true
      },
      () => stop,
    )
    // The first worker runs to its first await before the second starts, and by then the
    // flag is up: the other three workers see it and take nothing.
    expect(seen).toEqual([1])

    const none: number[] = []
    await runPool([], 3, async (item: number) => {
      none.push(item)
    })
    expect(none).toEqual([])
  })

  it('propagates a worker that throws', async () => {
    await expect(
      runPool([1], 1, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})
