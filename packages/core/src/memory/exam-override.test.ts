import { describe, expect, it } from 'vitest'
import { cardFixture, examFixture } from '../testing/memory-fixtures'
import {
  createExamOverrides,
  daysUntilExam,
  examDesiredRetention,
  examOverrideFor,
  NO_EXAM_OVERRIDES,
} from './exam-override'
import { URGENT_EXAM_WINDOW_DAYS, URGENT_MODE_RETENTION } from './importance'
import { resolveDayBoundary } from './study-day'

const BOUNDARY = resolveDayBoundary({})
const EXAM = examFixture({ date: '2026-01-19' })
const CARD = cardFixture({ examId: EXAM.id })
/** Fourteen days before the exam. */
const FAR = new Date('2026-01-05T08:00:00.000Z')
/** Five days before it — inside §7's last week. */
const NEAR = new Date('2026-01-14T08:00:00.000Z')

describe('examDesiredRetention', () => {
  it("uses the exam's own target outside the last week", () => {
    expect(examDesiredRetention(14, EXAM)).toBe(0.95)
    expect(examDesiredRetention(URGENT_EXAM_WINDOW_DAYS + 1, EXAM)).toBe(0.95)
  })

  it('rises to 0.97 inside it (§7, urgent row)', () => {
    expect(examDesiredRetention(URGENT_EXAM_WINDOW_DAYS, EXAM)).toBe(URGENT_MODE_RETENTION)
    expect(examDesiredRetention(0, EXAM)).toBe(URGENT_MODE_RETENTION)
  })

  it('never drops below an exam that already asks for more', () => {
    expect(examDesiredRetention(2, { targetRetention: 0.99, finalWindowDays: 3 })).toBe(0.99)
  })

  it('clamps a target the schema would not have accepted', () => {
    expect(examDesiredRetention(30, { targetRetention: 0.2, finalWindowDays: 3 })).toBe(0.7)
    expect(examDesiredRetention(30, { targetRetention: 2, finalWindowDays: 3 })).toBe(0.99)
    expect(examDesiredRetention(30, { targetRetention: Number.NaN, finalWindowDays: 3 })).toBe(0.99)
  })
})

describe('daysUntilExam', () => {
  it('counts whole days to the exam date', () => {
    expect(daysUntilExam(EXAM, FAR, BOUNDARY)).toBe(14)
    expect(daysUntilExam(EXAM, NEAR, BOUNDARY)).toBe(5)
  })

  it('is null for an undated exam and for a date SQLite would have rejected', () => {
    expect(daysUntilExam(examFixture({ date: null }), FAR, BOUNDARY)).toBeNull()
    expect(daysUntilExam(examFixture({ date: 'someday' }), FAR, BOUNDARY)).toBeNull()
  })
})

describe('examOverrideFor', () => {
  it('caps the interval at the start of the final review window (§8 phase 2)', () => {
    // 14 days out, 3-day final window: nothing may be scheduled past day 11.
    expect(examOverrideFor(CARD, EXAM, FAR, BOUNDARY)).toEqual({
      examId: EXAM.id,
      desiredRetention: 0.95,
      maxIntervalDays: 11,
      daysUntilExam: 14,
    })
  })

  it('raises the retention inside the last week', () => {
    expect(examOverrideFor(CARD, EXAM, NEAR, BOUNDARY)?.desiredRetention).toBe(
      URGENT_MODE_RETENTION,
    )
  })

  it('never asks for less than a day, even on the eve', () => {
    const eve = new Date('2026-01-18T08:00:00.000Z')
    expect(examOverrideFor(CARD, EXAM, eve, BOUNDARY)?.maxIntervalDays).toBe(1)
  })

  it('tolerates a negative final window', () => {
    const exam = examFixture({ finalWindowDays: -5 })
    expect(examOverrideFor(CARD, exam, FAR, BOUNDARY)?.maxIntervalDays).toBe(14)
  })

  it.each([
    ['the card is attached to another exam', cardFixture({ examId: 'other' }), EXAM],
    ['the exam was soft-deleted', CARD, examFixture({ deletedAt: new Date() })],
    ['it is a mock exam, not a dated one', CARD, examFixture({ kind: 'mock' })],
    ['the exam is already over', CARD, examFixture({ status: 'completed' })],
    ['the exam was archived', CARD, examFixture({ status: 'archived' })],
    ['it has no date', CARD, examFixture({ date: null })],
    ['the date has passed', CARD, examFixture({ date: '2026-01-01' })],
  ])('asks for nothing when %s', (_why, card, exam) => {
    expect(examOverrideFor(card, exam, FAR, BOUNDARY)).toBeNull()
  })

  it('still applies on the exam day itself', () => {
    const day = new Date('2026-01-19T08:00:00.000Z')
    expect(examOverrideFor(CARD, EXAM, day, BOUNDARY)?.daysUntilExam).toBe(0)
  })
})

describe('createExamOverrides', () => {
  it('looks the card’s exam up by id', () => {
    const source = createExamOverrides([EXAM])
    expect(source.forCard(CARD, FAR)?.examId).toBe(EXAM.id)
  })

  it('asks for nothing when the card names no exam, or one it was not given', () => {
    const source = createExamOverrides([EXAM])
    expect(source.forCard(cardFixture(), FAR)).toBeNull()
    expect(source.forCard(cardFixture({ examId: 'missing' }), FAR)).toBeNull()
  })

  it('measures the date against the boundary it was built with', () => {
    const source = createExamOverrides([EXAM], {
      dayBoundary: { timeZone: 'America/Argentina/Buenos_Aires' },
    })
    expect(source.forCard(CARD, FAR)?.daysUntilExam).toBe(14)
  })
})

describe('NO_EXAM_OVERRIDES', () => {
  it('is the no-exam-layer default', () => {
    expect(NO_EXAM_OVERRIDES.forCard(CARD, FAR)).toBeNull()
  })
})
