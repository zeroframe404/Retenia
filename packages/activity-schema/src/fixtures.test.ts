import { describe, expect, it } from 'vitest'
import { toActivityDraft } from './envelope'
import { activityJsonSchema } from './json-schema'
import { familyOf, MVP_TYPES } from './registry'
import { compileStrictSchema } from './testing/ajv'
import { loadFixtures } from './testing/fixtures'
import { checkActivity, validateActivity } from './validate'

/**
 * The fixtures are the contract: every MVP type has at least three valid and two invalid
 * files, the valid ones pass both validation layers and the exported JSON Schema, and the
 * invalid ones fail exactly where they say they do.
 */
const fixtures = loadFixtures()

describe('fixtures/', () => {
  it('covers every MVP type with ≥ 3 valid and ≥ 2 invalid files', () => {
    for (const type of MVP_TYPES) {
      expect(fixtures.valid.filter((f) => f.type === type).length, type).toBeGreaterThanOrEqual(3)
      expect(fixtures.invalid.filter((f) => f.type === type).length, type).toBeGreaterThanOrEqual(2)
    }
    expect(fixtures.valid.length).toBeGreaterThanOrEqual(63)
  })

  describe.each(fixtures.valid)('$type/$name', ({ type, data }) => {
    it('parses, validates without errors and raises only the declared warnings', () => {
      const result = checkActivity(data.activity)
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) return
      expect(result.activity.type).toBe(type)
      expect(result.warnings.map((issue) => issue.code)).toEqual(data.warnings ?? [])
      expect(
        validateActivity(result.activity).filter((issue) => issue.severity === 'error'),
      ).toEqual([])
    })

    it('satisfies the strict JSON Schema exported for its family', () => {
      const result = checkActivity(data.activity)
      if (!result.ok) throw new Error('unreachable: checked above')
      const family = familyOf(type)
      const schema = activityJsonSchema(family, { types: [type] as never })
      const validate = compileStrictSchema(schema)
      const outcome = validate(toActivityDraft(result.activity))
      expect(outcome.errors).toEqual([])
      expect(outcome.ok).toBe(true)
    })
  })

  describe.each(fixtures.invalid)('$type/$name', ({ data }) => {
    it(`fails at the ${data.expect.layer} layer with the declared codes`, () => {
      const result = checkActivity(data.activity)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.layer).toBe(data.expect.layer)
      for (const code of data.expect.codes) {
        expect(result.issues.map((issue) => issue.code)).toContain(code)
      }
    })
  })
})
