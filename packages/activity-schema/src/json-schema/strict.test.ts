import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type JsonSchema, lintStrictJsonSchema, strictOverride, strictSchemaStats } from './strict'

/** Claude strict mode's JSON Schema subset (`docs/spec/04-path-generation.md` §8). */

const toStrict = (schema: z.ZodType): JsonSchema =>
  JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input', override: strictOverride })))

describe('strictOverride()', () => {
  it('moves numeric and string constraints into the description', () => {
    const schema = toStrict(
      z.object({ n: z.int().min(1).max(5), s: z.string().min(1).regex(/^a+$/) }),
    )
    const props = schema.properties as Record<string, JsonSchema>
    expect(props.n).toEqual({ type: 'integer', description: 'Constraints: minimum 1; maximum 5.' })
    expect(props.s).toEqual({
      type: 'string',
      description: 'Constraints: non-empty; matches ^a+$.',
    })
  })

  it('appends to an existing description', () => {
    const schema = toStrict(z.string().min(2).describe('A name.'))
    expect(schema.description).toBe('A name. Constraints: at least 2 characters.')
  })

  it('keeps minItems 0 or 1 and demotes larger values; strips maxItems', () => {
    const one = toStrict(z.array(z.string()).min(1))
    expect(one.minItems).toBe(1)
    const two = toStrict(z.array(z.string()).min(2).max(4))
    expect(two.minItems).toBeUndefined()
    expect(two.description).toBe('Constraints: at most 4 items; at least 2 items.')
  })

  it('renames oneOf to anyOf and forces additionalProperties: false on every object', () => {
    const schema = toStrict(
      z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('b') })]),
    )
    expect(schema.oneOf).toBeUndefined()
    expect(Array.isArray(schema.anyOf)).toBe(true)
    for (const branch of schema.anyOf as JsonSchema[])
      expect(branch.additionalProperties).toBe(false)
  })

  it('keeps supported formats and strips the rest', () => {
    const kept = toStrict(z.iso.datetime())
    expect(kept.format).toBe('date-time')
    const stripped = toStrict(z.string().regex(/x/).describe('x'))
    expect(stripped.format).toBeUndefined()
    strictOverride({ jsonSchema: stripped })
    expect(stripped.description).toBe('x Constraints: matches x.')
    const custom: JsonSchema = { type: 'string', format: 'phone' }
    strictOverride({ jsonSchema: custom })
    expect(custom).toEqual({ type: 'string', description: 'Constraints: format phone.' })
  })

  it('is idempotent', () => {
    const schema = toStrict(z.object({ a: z.string().min(1) }))
    const before = JSON.stringify(schema)
    strictOverride({ jsonSchema: schema })
    expect(JSON.stringify(schema)).toBe(before)
  })
})

describe('lintStrictJsonSchema()', () => {
  const object = (extra: JsonSchema = {}): JsonSchema => ({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
    additionalProperties: false,
    ...extra,
  })

  it('passes a clean schema', () => {
    expect(lintStrictJsonSchema(object())).toEqual([])
  })

  it('unsupported-keyword, min-items-too-large, one-of, unsupported-format', () => {
    const codes = (schema: JsonSchema) =>
      lintStrictJsonSchema(schema).map((issue) => `${issue.code}@${issue.path.join('.')}`)
    expect(codes(object({ properties: { a: { type: 'string', minLength: 1 } } }))).toEqual([
      'unsupported-keyword@properties.a.minLength',
    ])
    expect(codes(object({ properties: { a: { type: 'number', minimum: 0 } }, not: {} }))).toEqual([
      'unsupported-keyword@not',
      'unsupported-keyword@properties.a.minimum',
    ])
    expect(
      codes(
        object({ properties: { a: { type: 'array', items: { type: 'string' }, minItems: 2 } } }),
      ),
    ).toEqual(['min-items-too-large@properties.a.minItems'])
    expect(
      codes(
        object({ properties: { a: { type: 'array', items: { type: 'string' }, minItems: 1 } } }),
      ),
    ).toEqual([])
    expect(codes(object({ properties: { a: { oneOf: [{ type: 'string' }] } } }))).toEqual([
      'one-of@properties.a.oneOf',
    ])
    expect(codes(object({ properties: { a: { type: 'string', format: 'phone' } } }))).toEqual([
      'unsupported-format@properties.a.format',
    ])
    expect(codes(object({ properties: { a: { type: 'string', format: 'email' } } }))).toEqual([])
  })

  it('additional-properties: absent, true or a schema all fail', () => {
    for (const additionalProperties of [undefined, true, { type: 'string' }]) {
      const schema: JsonSchema = {
        type: 'object',
        properties: {},
        ...(additionalProperties === undefined ? {} : { additionalProperties }),
      }
      expect(lintStrictJsonSchema(schema).map((issue) => issue.code)).toEqual([
        'additional-properties',
      ])
    }
  })

  it('external-ref, recursive-ref and all-of-ref', () => {
    const external = object({ properties: { a: { $ref: 'https://example.com/x.json' } } })
    expect(lintStrictJsonSchema(external).map((issue) => issue.code)).toEqual(['external-ref'])
    const recursive: JsonSchema = {
      $defs: {
        node: {
          type: 'object',
          properties: { next: { $ref: '#/$defs/node' } },
          additionalProperties: false,
        },
      },
      ...object({ properties: { root: { $ref: '#/$defs/node' } } }),
    }
    expect(lintStrictJsonSchema(recursive).map((issue) => issue.code)).toEqual(['recursive-ref'])
    const local: JsonSchema = {
      $defs: { leaf: { type: 'string' } },
      ...object({ properties: { a: { $ref: '#/$defs/leaf' }, b: { $ref: '#/$defs/leaf' } } }),
    }
    expect(lintStrictJsonSchema(local)).toEqual([])
    const allOf = object({
      properties: { a: { allOf: [{ $ref: '#/$defs/leaf' }] } },
      $defs: { leaf: { type: 'string' } },
    })
    expect(lintStrictJsonSchema(allOf).map((issue) => issue.code)).toEqual(['all-of-ref'])
  })

  it('enum-complex, too-many-unions and too-many-optional-properties', () => {
    expect(
      lintStrictJsonSchema(object({ properties: { a: { enum: [{ x: 1 }] } } })).map(
        (issue) => issue.code,
      ),
    ).toEqual(['enum-complex'])
    const unions = object({
      properties: {
        a: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        b: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    })
    expect(lintStrictJsonSchema(unions, { maxUnions: 1 }).map((issue) => issue.code)).toEqual([
      'too-many-unions',
    ])
    expect(lintStrictJsonSchema(unions)).toEqual([])
    const optional = object({
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      required: [],
    })
    expect(
      lintStrictJsonSchema(optional, { maxOptionalProperties: 2 }).map((issue) => issue.code),
    ).toEqual(['too-many-optional-properties'])
  })

  it('walks items, prefixItems, allOf and $defs, visiting a shared subschema once', () => {
    const shared: JsonSchema = { type: 'object', properties: {}, additionalProperties: true }
    const schema = object({
      properties: {
        a: { type: 'array', items: shared },
        b: { type: 'array', prefixItems: [shared] },
        c: { allOf: [shared] },
      },
    })
    expect(lintStrictJsonSchema(schema).map((issue) => issue.path.join('.'))).toEqual([
      'properties.a.items.additionalProperties',
    ])
  })
})

describe('strictSchemaStats()', () => {
  it('counts objects, unions, optional properties and depth', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: {
          type: 'object',
          properties: {
            c: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            d: { type: 'string' },
            e: { type: 'string' },
          },
          required: ['c'],
          additionalProperties: false,
        },
      },
      required: ['b'],
      additionalProperties: false,
    }
    expect(strictSchemaStats(schema)).toEqual({
      objects: 2,
      unions: 1,
      optionalTotal: 3,
      maxOptionalPerObject: 2,
      depth: 3,
    })
  })
})
