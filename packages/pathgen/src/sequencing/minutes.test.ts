import { describe, expect, it } from 'vitest'
import { lessonMinutes, weeksAvailable, weeksEstimate } from './minutes'
import { DEFAULT_SEQUENCING_LIMITS } from './types'

const limits = DEFAULT_SEQUENCING_LIMITS.lessonMinutes

describe('lessonMinutes()', () => {
  it('rounds and clamps the estimate to the band, defaulting when there is none', () => {
    expect(lessonMinutes(null, limits)).toBe(12)
    expect(lessonMinutes(Number.NaN, limits)).toBe(12)
    expect(lessonMinutes(3, limits)).toBe(7)
    expect(lessonMinutes(30, limits)).toBe(20)
    expect(lessonMinutes(9.6, limits)).toBe(10)
  })
})

describe('weeksEstimate()', () => {
  it('rounds the total up to whole weeks at the pace, or has no answer without a pace', () => {
    expect(weeksEstimate(600, 3)).toBe(4)
    expect(weeksEstimate(540, 3)).toBe(3)
    expect(weeksEstimate(0, 3)).toBe(0)
    expect(weeksEstimate(600, 0)).toBeNull()
    expect(weeksEstimate(600, -2)).toBeNull()
  })
})

describe('weeksAvailable()', () => {
  const now = new Date('2026-09-09T15:00:00Z')

  it('counts weeks from today to the date, to one decimal, negative when it has passed', () => {
    expect(weeksAvailable(now, '2026-10-07')).toBe(4)
    expect(weeksAvailable(now, '2026-09-12')).toBe(0.4)
    expect(weeksAvailable(now, '2026-09-09')).toBe(0)
    expect(weeksAvailable(now, '2026-09-01')).toBe(-1.1)
  })

  it('has no answer for a date that is not ISO', () => {
    expect(weeksAvailable(now, '15/12/2026')).toBeNull()
    expect(weeksAvailable(now, '')).toBeNull()
  })
})
