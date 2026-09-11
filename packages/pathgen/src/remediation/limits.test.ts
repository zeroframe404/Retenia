import { describe, expect, it } from 'vitest'
import { checkLimits, type LimitRow } from './limits'

const NOW = new Date('2026-09-01T12:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

function row(overrides: Partial<LimitRow>): LimitRow {
  return {
    conceptId: 'c1',
    moduleId: 'm1',
    status: 'active',
    createdAt: daysAgo(1),
    ...overrides,
  }
}

describe('checkLimits()', () => {
  it('inserts on a clean history', () => {
    expect(
      checkLimits({
        conceptId: 'c1',
        moduleId: 'm1',
        version: [],
        recent: [],
        now: NOW,
      }),
    ).toEqual({ kind: 'insert' })
  })

  it('refuses duplicate_concept when the concept already has an active remediation', () => {
    const verdict = checkLimits({
      conceptId: 'c1',
      moduleId: 'm1',
      version: [row({ conceptId: 'c1', status: 'active' })],
      recent: [],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'refuse', refusal: 'duplicate_concept' })
  })

  it('refuses revisit_core on the third remediation of a concept and carries the teaching lesson', () => {
    const verdict = checkLimits({
      conceptId: 'c1',
      moduleId: 'm1',
      version: [
        row({ conceptId: 'c1', status: 'completed' }),
        row({ conceptId: 'c1', status: 'dismissed' }),
      ],
      recent: [],
      now: NOW,
      teachingLessonId: 'L03',
    })
    expect(verdict).toEqual({
      kind: 'refuse',
      refusal: 'revisit_core',
      revisitLessonId: 'L03',
    })
  })

  it('does not count refused or failed rows toward revisit_core', () => {
    const verdict = checkLimits({
      conceptId: 'c1',
      moduleId: 'm1',
      version: [
        row({ conceptId: 'c1', status: 'refused' }),
        row({ conceptId: 'c1', status: 'failed' }),
      ],
      recent: [],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'insert' })
  })

  it('refuses module_active when another concept in the module has an active remediation', () => {
    const verdict = checkLimits({
      conceptId: 'c2',
      moduleId: 'm1',
      version: [row({ conceptId: 'c1', moduleId: 'm1', status: 'active' })],
      recent: [],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'refuse', refusal: 'module_active' })
  })

  it('a completed remediation in the module does not block module_active', () => {
    const verdict = checkLimits({
      conceptId: 'c2',
      moduleId: 'm1',
      version: [row({ conceptId: 'c1', moduleId: 'm1', status: 'completed' })],
      recent: [],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'insert' })
  })

  it('refuses weekly_limit on the 4th inserted remediation within the last 7 days', () => {
    const verdict = checkLimits({
      conceptId: 'c9',
      moduleId: 'm9',
      version: [],
      recent: [
        { status: 'active', createdAt: daysAgo(1) },
        { status: 'completed', createdAt: daysAgo(2) },
        { status: 'dismissed', createdAt: daysAgo(6) },
      ],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'refuse', refusal: 'weekly_limit' })
  })

  it('a row exactly 7 days old, or older, does not count toward the weekly limit', () => {
    const verdict = checkLimits({
      conceptId: 'c9',
      moduleId: 'm9',
      version: [],
      recent: [
        { status: 'active', createdAt: daysAgo(1) },
        { status: 'completed', createdAt: daysAgo(2) },
        { status: 'dismissed', createdAt: new Date(NOW.getTime() - 7 * DAY_MS) },
      ],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'insert' })
  })

  it('refused rows in `recent` do not count toward the weekly limit', () => {
    const verdict = checkLimits({
      conceptId: 'c9',
      moduleId: 'm9',
      version: [],
      recent: [
        { status: 'active', createdAt: daysAgo(1) },
        { status: 'completed', createdAt: daysAgo(2) },
        { status: 'refused', createdAt: daysAgo(3) },
        { status: 'refused', createdAt: daysAgo(4) },
      ],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'insert' })
  })

  it('a failed detour counts toward the weekly limit — its P11 call was paid for', () => {
    const verdict = checkLimits({
      conceptId: 'c9',
      moduleId: 'm9',
      version: [],
      recent: [
        { status: 'active', createdAt: daysAgo(1) },
        { status: 'completed', createdAt: daysAgo(2) },
        { status: 'failed', createdAt: daysAgo(4) },
      ],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'refuse', refusal: 'weekly_limit' })
  })

  it('precedence: duplicate_concept wins over revisit_core', () => {
    const verdict = checkLimits({
      conceptId: 'c1',
      moduleId: 'm1',
      version: [
        row({ conceptId: 'c1', status: 'active' }),
        row({ conceptId: 'c1', status: 'completed' }),
        row({ conceptId: 'c1', status: 'dismissed' }),
      ],
      recent: [],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'refuse', refusal: 'duplicate_concept' })
  })

  it('precedence: revisit_core wins over module_active', () => {
    const verdict = checkLimits({
      conceptId: 'c1',
      moduleId: 'm1',
      version: [
        row({ conceptId: 'c1', status: 'completed' }),
        row({ conceptId: 'c1', status: 'dismissed' }),
        row({ conceptId: 'c2', moduleId: 'm1', status: 'active' }),
      ],
      recent: [],
      now: NOW,
    })
    expect(verdict.kind).toBe('refuse')
    expect((verdict as { refusal: string }).refusal).toBe('revisit_core')
  })

  it('precedence: module_active wins over weekly_limit', () => {
    const verdict = checkLimits({
      conceptId: 'c2',
      moduleId: 'm1',
      version: [row({ conceptId: 'c1', moduleId: 'm1', status: 'active' })],
      recent: [
        { status: 'active', createdAt: daysAgo(1) },
        { status: 'completed', createdAt: daysAgo(2) },
        { status: 'dismissed', createdAt: daysAgo(3) },
      ],
      now: NOW,
    })
    expect(verdict).toEqual({ kind: 'refuse', refusal: 'module_active' })
  })
})
