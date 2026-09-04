import { describe, expect, it } from 'vitest'
import { toActivityDraft } from '../envelope'
import { familyOf, MVP_FAMILIES, MVP_TYPES, typesOfFamily } from '../registry'
import { sampleActivities } from '../testing/samples'
import { activityJsonSchema } from './index'
import { type JsonSchema, lintStrictJsonSchema } from './strict'

/** `docs/spec/03-activities.md` §7: one family schema per LLM call with `type` reduced to the allowed types. */
describe('activityJsonSchema()', () => {
  it('lints clean for every MVP family with its MVP types', () => {
    for (const family of MVP_FAMILIES) {
      const types = MVP_TYPES.filter((type) => familyOf(type) === family)
      const schema = activityJsonSchema(family, { types })
      expect(lintStrictJsonSchema(schema), family).toEqual([])
      expect(schema.$schema).toBeUndefined()
      expect(schema.$defs).toBeUndefined()
      const properties = schema.properties as Record<string, JsonSchema>
      expect(properties.type?.enum).toEqual(types)
      expect(properties.id).toBeUndefined()
      expect(properties.family?.const).toBe(family)
      expect(schema.additionalProperties).toBe(false)
    }
  })

  it('defaults `type` to every type of the family', () => {
    const schema = activityJsonSchema('choice')
    expect((schema.properties as Record<string, JsonSchema>).type?.enum).toEqual(
      typesOfFamily('choice'),
    )
  })

  it('demotes the envelope constraints to descriptions', () => {
    const schema = activityJsonSchema('choice')
    const properties = schema.properties as Record<string, JsonSchema>
    expect(properties.lang?.pattern).toBeUndefined()
    expect(String(properties.lang?.description)).toContain('Constraints: matches')
    expect(properties.difficulty?.enum).toEqual([1, 2, 3, 4, 5])
    expect(properties.schemaVersion?.const).toBe(1)
  })

  it('throws on a placeholder family, an empty allow-list or a foreign type', () => {
    expect(() => activityJsonSchema('speech')).toThrow(RangeError)
    expect(() => activityJsonSchema('choice', { types: [] })).toThrow(RangeError)
    // @ts-expect-error — a type of another family
    expect(() => activityJsonSchema('choice', { types: ['cloze_typed'] })).toThrow(RangeError)
  })

  it('describes a draft that every sample activity satisfies structurally', () => {
    for (const sample of sampleActivities()) {
      const schema = activityJsonSchema(sample.family, { types: [sample.type] as never })
      const draft = toActivityDraft(sample)
      const required = schema.required as string[]
      for (const key of required) expect(draft, `${sample.type}.${key}`).toHaveProperty(key)
    }
  })
})
