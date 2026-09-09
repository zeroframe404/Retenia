import { describe, expect, it } from 'vitest'
import { consolidatedImportance, FREQUENCY_BOOST, SOURCE_BONUS } from './importance'
import { dot } from './vector'

describe('consolidatedImportance()', () => {
  it('boosts a rating by how many chunks mention the concept, logarithmically', () => {
    expect(consolidatedImportance(0.5, 1, 1)).toBeCloseTo(0.5)
    expect(consolidatedImportance(0.5, 2, 1)).toBeCloseTo(0.5 * (1 + FREQUENCY_BOOST * Math.log(2)))
    expect(consolidatedImportance(0.5, 10, 1)).toBeCloseTo(0.5 * 1.345, 2)
  })

  it('adds a flat bonus per extra source and never exceeds one or drops below zero', () => {
    expect(consolidatedImportance(0.5, 1, 2)).toBeCloseTo(0.5 + SOURCE_BONUS)
    expect(consolidatedImportance(0.9, 50, 3)).toBe(1)
    expect(consolidatedImportance(-1, 0, 0)).toBe(0)
  })
})

describe('dot()', () => {
  it('is the cosine of two unit vectors, over their common length', () => {
    expect(dot(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1)
    expect(dot(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0)
    expect(dot(new Float32Array([0.6, 0.8, 5]), new Float32Array([0.6, 0.8]))).toBeCloseTo(1)
  })
})
