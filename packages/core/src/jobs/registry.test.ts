import { describe, expect, it } from 'vitest'
import { registerJob } from './definition'
import { createJobRegistry } from './registry'

const sleep = registerJob({
  type: 'sleep',
  parseInput: (payload) => {
    const ms = payload.ms
    if (typeof ms !== 'number') throw new Error('sleep needs a numeric "ms"')
    return { ms }
  },
  run: async ({ ms }) => ({ slept: ms }),
})

describe('job registry', () => {
  it('finds a definition by type', () => {
    const registry = createJobRegistry([sleep])
    expect(registry.get('sleep')).toBe(sleep)
    expect(registry.has('sleep')).toBe(true)
    expect(registry.get('nope')).toBeUndefined()
  })

  it('lists its types sorted, which is what a worker passes to claim', () => {
    const other = registerJob({ type: 'hashFile', parseInput: (p) => p, run: async () => null })
    expect(createJobRegistry([sleep, other]).types()).toEqual(['hashFile', 'sleep'])
  })

  it('refuses two definitions claiming the same type', () => {
    expect(() => createJobRegistry([sleep, sleep])).toThrow(/both claim the type "sleep"/)
  })
})

describe('registerJob', () => {
  it('parses the persisted payload before running', async () => {
    const ctx = {
      jobId: 'j1',
      progress: () => {},
      signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    }
    await expect(sleep.run({ ms: 5 }, ctx)).resolves.toEqual({ slept: 5 })
  })

  it('rejects — never throws synchronously — on a payload it does not recognise', async () => {
    const ctx = {
      jobId: 'j1',
      progress: () => {},
      signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    }
    await expect(sleep.run({ ms: 'soon' }, ctx)).rejects.toThrow(/numeric "ms"/)
  })
})
