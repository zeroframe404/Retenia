import { lintStrictJsonSchema, MVP_FAMILIES } from '@retenia/activity-schema'
import { toStrictJsonSchema } from '@retenia/ai'
import { describe, expect, it } from 'vitest'
import { authorableTypes } from './author'
import { MAX_CANDIDATES_PER_CALL, makeActivitiesOutputSchema } from './schema'

/**
 * The guard that ties the two halves of the strict-mode contract together.
 *
 * `@retenia/ai` decides what a provider actually receives (`toStrictJsonSchema`);
 * `@retenia/activity-schema` knows what Claude's strict mode accepts
 * (`lintStrictJsonSchema`, from `docs/spec/04-path-generation.md` §8). Neither package can
 * see the other, so nothing checked that the schema one produces is one the other would
 * accept — and it was not: zod emits `oneOf` for a discriminated union, which strict mode
 * rejects, and `cloze`'s segments are exactly that. This is the test that fails if the fold
 * in `relaxJsonSchema` is ever removed.
 */
describe('makeActivitiesOutputSchema()', () => {
  for (const family of MVP_FAMILIES) {
    it(`is strict-mode clean for ${family}`, () => {
      const types = authorableTypes(family)
      const wire = toStrictJsonSchema(makeActivitiesOutputSchema(family, types))
      expect(lintStrictJsonSchema(wire as never)).toEqual([])
    })

    it(`narrows the type enum to ${family}'s MVP types`, () => {
      const types = authorableTypes(family)
      const parsed = makeActivitiesOutputSchema(family, types).safeParse({
        candidates: [],
        notes: [],
      })
      // An empty pool is a schema failure, not a rule failure: the prompt asks for 2–3× the
      // wanted count and a call that produced nothing has not answered.
      expect(parsed.success).toBe(false)
      expect(types.length).toBeGreaterThan(0)
    })
  }

  it('caps the pool so a model that ignores `wanted` cannot bill for a hundred exercises', () => {
    expect(MAX_CANDIDATES_PER_CALL).toBe(24)
  })
})
