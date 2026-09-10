import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { relaxJsonSchema, toStrictJsonSchema } from './json-schema'

/** Every `oneOf`/`anyOf` key anywhere in a schema, in traversal order. */
function unionKeys(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(unionKeys)
  if (node === null || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'oneOf' || key === 'anyOf' ? [key, ...unionKeys(value)] : unionKeys(value),
  )
}

describe('relaxJsonSchema()', () => {
  it('folds oneOf into anyOf, at every depth', () => {
    const relaxed = relaxJsonSchema({
      type: 'object',
      properties: {
        segment: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'text' } } },
            { type: 'object', properties: { gap: { oneOf: [{ type: 'string' }] } } },
          ],
        },
      },
    })
    expect(unionKeys(relaxed)).toEqual(['anyOf', 'anyOf'])
  })

  it('leaves a schema with no union untouched', () => {
    const input = { type: 'object', properties: { a: { type: 'string' } } }
    expect(relaxJsonSchema(structuredClone(input))).toEqual(input)
  })
})

describe('toStrictJsonSchema()', () => {
  /**
   * The regression this exists for: zod emits `oneOf` for a discriminated union, Claude's
   * strict mode accepts only `anyOf` (`docs/spec/04-path-generation.md` §8), and
   * `packages/activity-schema`'s `cloze` payload — the segments of a cloze passage — is the
   * first schema in the repo to contain one. Sub-phase 8.3 sends it on every P4 call.
   */
  it('emits anyOf for a discriminated union', () => {
    const schema = z.object({
      segments: z.array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('text'), text: z.string() }),
          z.object({ kind: z.literal('gap'), id: z.string() }),
        ]),
      ),
    })
    expect(unionKeys(toStrictJsonSchema(schema))).toEqual(['anyOf'])
  })
})
