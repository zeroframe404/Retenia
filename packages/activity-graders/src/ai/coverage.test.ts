import type { GradingKeyPoint } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { keyPointCoverage, NO_COVERAGE } from './coverage'

const POINTS: GradingKeyPoint[] = [
  { id: 'k1', text: 'luz solar', weight: 3, aliases: ['energía lumínica'] },
  { id: 'k2', text: 'glucosa' },
]

describe('keyPointCoverage()', () => {
  it('says nothing when there are no key points', () => {
    expect(keyPointCoverage('lo que sea', undefined)).toBe(NO_COVERAGE)
    expect(keyPointCoverage('lo que sea', [])).toBe(NO_COVERAGE)
  })

  it('weights the points it finds and lists both sides', () => {
    expect(keyPointCoverage('con energía lumínica alcanza', POINTS)).toEqual({
      score: 0.75,
      covered: ['k1'],
      missed: ['k2'],
      total: 2,
    })
    expect(keyPointCoverage('produce glucosa', POINTS)).toMatchObject({
      score: 0.25,
      covered: ['k2'],
      missed: ['k1'],
    })
    expect(keyPointCoverage('la luz solar produce glucosa', POINTS).score).toBe(1)
    expect(keyPointCoverage('nada de nada', POINTS).score).toBe(0)
  })

  it('treats an absent or non-positive weight as 1', () => {
    const odd: GradingKeyPoint[] = [
      { id: 'a', text: 'uno', weight: 0 },
      { id: 'b', text: 'dos' },
    ]
    expect(keyPointCoverage('solo el uno', odd).score).toBe(0.5)
  })
})
