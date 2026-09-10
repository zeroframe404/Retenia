import { describe, expect, it } from 'vitest'
import { BASE_FAMILIES, familiesFor, MAX_FAMILIES_PER_LESSON } from './families'

describe('familiesFor()', () => {
  it('always offers the base set, whatever the material is', () => {
    // Without these the variety rules are unsatisfiable: `composeLessonPractice` wants three
    // distinct families, a production tail and one apply-level item from the same pool.
    expect(familiesFor([])).toEqual(BASE_FAMILIES)
    expect(familiesFor(['misconception'])).toEqual(BASE_FAMILIES)
  })

  it('adds ordering only when the lesson teaches a procedure', () => {
    expect(familiesFor(['fact'])).not.toContain('ordering')
    expect(familiesFor(['procedure'])).toContain('ordering')
  })

  it('adds the sorting families for concepts and principles', () => {
    expect(familiesFor(['concept'])).toEqual(expect.arrayContaining(['pairs', 'categorize']))
    expect(familiesFor(['principle'])).toContain('categorize')
  })

  it('never asks for the same family twice', () => {
    const families = familiesFor(['concept', 'concept', 'principle', 'example'])
    expect(new Set(families).size).toBe(families.length)
  })

  it('caps the fan-out: one call per family is one request', () => {
    const families = familiesFor(['concept', 'procedure', 'fact', 'principle', 'example'])
    expect(families.length).toBeLessThanOrEqual(MAX_FAMILIES_PER_LESSON)
  })
})
