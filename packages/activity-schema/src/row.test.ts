import type { Activity as ActivityRow } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { type Activity, parseActivity, toActivityDraft } from './envelope'
import { fromActivityRow, toActivityRow } from './row'
import { loadFixtures } from './testing/fixtures'
import { sampleChoice } from './testing/samples'

/**
 * The mapping nothing in the repo had until sub-phase 8.3 needed it. What it has to be is a
 * round trip: `packages/db` stores the promoted columns beside a `config` blob, and a lesson
 * player that read back something other than what the generator wrote would be a bug nobody
 * could see until a learner met it.
 */

const AUDIT = {
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  deviceId: 'test',
  version: 1,
}

function asRow(activity: Activity): ActivityRow {
  return {
    ...toActivityRow(toActivityDraft(activity), { bloom: 'apply', misconceptionIds: ['X001'] }),
    id: activity.id,
    lessonId: 'lesson-1',
    ordinal: 0,
    ...AUDIT,
  }
}

describe('toActivityRow()', () => {
  it('promotes to columns everything a query filters on', () => {
    const activity = sampleChoice()
    const row = toActivityRow(toActivityDraft(activity), { bloom: 'apply' })
    expect(row.type).toBe(activity.type)
    expect(row.family).toBe('choice')
    expect(row.lang).toBe(activity.lang)
    expect(row.difficulty).toBe(activity.difficulty)
    expect(row.conceptIds).toEqual(activity.skills)
    expect(row.grading).toEqual(activity.grading)
    expect(row.bloom).toBe('apply')
  })

  it('keeps `grading` out of `config`, because the grader reads it without the rest', () => {
    const row = toActivityRow(toActivityDraft(sampleChoice()))
    expect(row.config).not.toHaveProperty('grading')
    expect(row.config).toHaveProperty('payload')
    expect(row.config).toHaveProperty('review')
  })

  it('defaults to a `ready` activity with no misconceptions', () => {
    const row = toActivityRow(toActivityDraft(sampleChoice()))
    expect(row.status).toBe('ready')
    expect(row.misconceptionIds).toEqual([])
    expect(row.bloom).toBeNull()
  })
})

describe('fromActivityRow()', () => {
  it('round-trips every committed fixture', () => {
    const fixtures = loadFixtures()
    expect(fixtures.valid.length).toBeGreaterThanOrEqual(63)
    for (const fixture of fixtures.valid) {
      const activity = parseActivity(fixture.data.activity)
      expect(fromActivityRow(asRow(activity)), fixture.name).toEqual(activity)
    }
  })

  it('derives the family from the type rather than trusting the column', () => {
    const row = { ...asRow(sampleChoice()), family: 'cloze' as const }
    expect(fromActivityRow(row).family).toBe('choice')
  })

  it('refuses a row whose type is not one of the 98', () => {
    const row = { ...asRow(sampleChoice()), type: 'not_a_type' }
    expect(() => fromActivityRow(row)).toThrow(/not one of the 98/)
  })
})
