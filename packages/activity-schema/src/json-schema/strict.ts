/**
 * Claude strict mode (`docs/spec/04-path-generation.md` §8: "it does not accept min/max,
 * pattern or recursive references") over a JSON Schema produced by `z.toJSONSchema`.
 *
 * Supported there: the basic types, `enum`, `const`, `anyOf`, `allOf`, `$ref`/`$defs`, a
 * handful of string formats, `additionalProperties: false` (required on every object) and
 * `minItems` of 0 or 1. Everything else is demoted to a sentence in `description` by
 * `strictOverride` — zod still enforces it at parse time — and `lintStrictJsonSchema` is the
 * gate that says a schema is ready for `output_config.format`.
 */

export type JsonSchema = Record<string, unknown>

/** String formats strict mode understands. Any other `format` is stripped. */
export const STRICT_FORMATS: ReadonlySet<string> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
])

/** Keywords strict mode rejects outright; each becomes a description note. */
export const STRIPPED_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'uniqueItems',
  'contains',
  'minContains',
  'maxContains',
  'propertyNames',
  'patternProperties',
] as const

/** Keywords the linter rejects on top of `STRIPPED_KEYWORDS` (never produced by our zod, listed for completeness). */
const LINT_ONLY_KEYWORDS = [
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedProperties',
  'unevaluatedItems',
] as const

function isSchemaObject(value: unknown): value is JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function looksLikeObject(schema: JsonSchema): boolean {
  return schema.type === 'object' || 'properties' in schema
}

function describe(keyword: string, value: unknown): string {
  switch (keyword) {
    case 'minLength':
      return value === 1 ? 'non-empty' : `at least ${String(value)} characters`
    case 'maxLength':
      return `at most ${String(value)} characters`
    case 'minItems':
      return `at least ${String(value)} items`
    case 'maxItems':
      return `at most ${String(value)} items`
    case 'pattern':
      return `matches ${String(value)}`
    case 'format':
      return `format ${String(value)}`
    case 'uniqueItems':
      return 'unique items'
    default:
      return `${keyword} ${JSON.stringify(value)}`
  }
}

/**
 * The `override` hook for `z.toJSONSchema`: called once per node with the JSON Schema zod
 * produced, which it edits in place. Idempotent, so it can also run over a finished schema.
 */
export function strictOverride(ctx: { jsonSchema: JsonSchema }): void {
  const schema = ctx.jsonSchema
  const notes: string[] = []

  if (looksLikeObject(schema)) schema.additionalProperties = false

  if (Array.isArray(schema.oneOf)) {
    schema.anyOf = schema.oneOf
    delete schema.oneOf
  }

  for (const keyword of STRIPPED_KEYWORDS) {
    if (keyword in schema) {
      notes.push(describe(keyword, schema[keyword]))
      delete schema[keyword]
    }
  }
  if (typeof schema.minItems === 'number' && schema.minItems > 1) {
    notes.push(describe('minItems', schema.minItems))
    delete schema.minItems
  }
  if (typeof schema.format === 'string' && !STRICT_FORMATS.has(schema.format)) {
    notes.push(describe('format', schema.format))
    delete schema.format
  }

  if (notes.length > 0) {
    const constraints = `Constraints: ${notes.join('; ')}.`
    schema.description =
      typeof schema.description === 'string' && schema.description.length > 0
        ? `${schema.description} ${constraints}`
        : constraints
  }
}

export interface StrictIssue {
  code:
    | 'unsupported-keyword'
    | 'min-items-too-large'
    | 'one-of'
    | 'additional-properties'
    | 'unsupported-format'
    | 'external-ref'
    | 'recursive-ref'
    | 'all-of-ref'
    | 'enum-complex'
    | 'too-many-unions'
    | 'too-many-optional-properties'
  path: (string | number)[]
  message: string
}

export interface StrictLintOptions {
  /** Spec 04 §8: "≤ 16 unions". */
  maxUnions?: number
  /** Spec 04 §8: "≤ 24 optional parameters", read per object. */
  maxOptionalProperties?: number
}

interface Visit {
  schema: JsonSchema
  path: (string | number)[]
  /** The `$defs` names currently being expanded, to detect a cycle. */
  defStack: readonly string[]
}

/** The child schemas of a node, with their paths. */
function children(schema: JsonSchema, path: (string | number)[]): Visit[] {
  const next: Visit[] = []
  const push = (child: unknown, ...segments: (string | number)[]) => {
    if (isSchemaObject(child))
      next.push({ schema: child, path: [...path, ...segments], defStack: [] })
  }
  for (const key of [
    'properties',
    '$defs',
    'definitions',
    'patternProperties',
    'dependentSchemas',
  ]) {
    const map = schema[key]
    if (isSchemaObject(map)) for (const [name, child] of Object.entries(map)) push(child, key, name)
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    const list = schema[key]
    if (Array.isArray(list)) for (const [index, child] of list.entries()) push(child, key, index)
  }
  for (const key of [
    'items',
    'additionalProperties',
    'not',
    'if',
    'then',
    'else',
    'contains',
    'propertyNames',
    'unevaluatedProperties',
    'unevaluatedItems',
  ]) {
    push(schema[key], key)
  }
  return next
}

function resolveRef(root: JsonSchema, ref: string): { name: string; schema: JsonSchema } | null {
  const match = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref)
  if (match === null) return null
  const defs = root[match[1] as string]
  const name = match[2] as string
  const target = isSchemaObject(defs) ? defs[name] : undefined
  return isSchemaObject(target) ? { name, schema: target } : null
}

/** Every strict-mode violation in `schema`, walking `$defs`, unions and nested objects. */
export function lintStrictJsonSchema(
  schema: JsonSchema,
  options: StrictLintOptions = {},
): StrictIssue[] {
  const { maxUnions = 16, maxOptionalProperties = 24 } = options
  const issues: StrictIssue[] = []
  const seen = new Set<JsonSchema>()
  let unions = 0

  const visit = ({ schema: node, path, defStack }: Visit): void => {
    if (typeof node.$ref === 'string') {
      const resolved = resolveRef(schema, node.$ref)
      if (resolved === null) {
        issues.push({
          code: 'external-ref',
          path: [...path, '$ref'],
          message: `${node.$ref} is not a local $defs reference`,
        })
      } else if (defStack.includes(resolved.name)) {
        issues.push({
          code: 'recursive-ref',
          path: [...path, '$ref'],
          message: `$defs/${resolved.name} refers back to itself`,
        })
      } else {
        visit({
          schema: resolved.schema,
          path: [...path, '$ref'],
          defStack: [...defStack, resolved.name],
        })
      }
      return
    }
    if (seen.has(node)) return
    seen.add(node)

    for (const keyword of [...STRIPPED_KEYWORDS, ...LINT_ONLY_KEYWORDS]) {
      if (keyword in node) {
        issues.push({
          code: 'unsupported-keyword',
          path: [...path, keyword],
          message: `${keyword} is not supported in strict mode`,
        })
      }
    }
    if (typeof node.minItems === 'number' && node.minItems > 1) {
      issues.push({
        code: 'min-items-too-large',
        path: [...path, 'minItems'],
        message: 'minItems may only be 0 or 1',
      })
    }
    if ('oneOf' in node) {
      issues.push({
        code: 'one-of',
        path: [...path, 'oneOf'],
        message: 'use anyOf instead of oneOf',
      })
    }
    if (typeof node.format === 'string' && !STRICT_FORMATS.has(node.format)) {
      issues.push({
        code: 'unsupported-format',
        path: [...path, 'format'],
        message: `format ${node.format} is not supported`,
      })
    }
    if (
      Array.isArray(node.enum) &&
      node.enum.some((value) => value !== null && typeof value === 'object')
    ) {
      issues.push({
        code: 'enum-complex',
        path: [...path, 'enum'],
        message: 'enum values must be scalars',
      })
    }
    if (
      Array.isArray(node.allOf) &&
      node.allOf.some((member) => isSchemaObject(member) && '$ref' in member)
    ) {
      issues.push({
        code: 'all-of-ref',
        path: [...path, 'allOf'],
        message: 'allOf may not contain $ref',
      })
    }
    if (looksLikeObject(node)) {
      if (node.additionalProperties !== false) {
        issues.push({
          code: 'additional-properties',
          path: [...path, 'additionalProperties'],
          message: 'every object needs additionalProperties: false',
        })
      }
      const properties = isSchemaObject(node.properties) ? Object.keys(node.properties) : []
      const required = Array.isArray(node.required) ? node.required : []
      const optional = properties.filter((name) => !required.includes(name)).length
      if (optional > maxOptionalProperties) {
        issues.push({
          code: 'too-many-optional-properties',
          path,
          message: `${optional} optional properties, at most ${maxOptionalProperties}`,
        })
      }
    }
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) unions += 1

    for (const child of children(node, path)) visit({ ...child, defStack })
  }

  visit({ schema, path: [], defStack: [] })
  if (unions > maxUnions) {
    issues.push({
      code: 'too-many-unions',
      path: [],
      message: `${unions} unions, at most ${maxUnions}`,
    })
  }
  return issues
}

export interface StrictSchemaStats {
  objects: number
  unions: number
  optionalTotal: number
  maxOptionalPerObject: number
  depth: number
}

/** Size figures for the report of `tooling/schema-check.ts`. */
export function strictSchemaStats(schema: JsonSchema): StrictSchemaStats {
  const stats: StrictSchemaStats = {
    objects: 0,
    unions: 0,
    optionalTotal: 0,
    maxOptionalPerObject: 0,
    depth: 0,
  }
  const seen = new Set<JsonSchema>()
  const visit = (node: JsonSchema, path: (string | number)[], depth: number): void => {
    if (seen.has(node)) return
    seen.add(node)
    stats.depth = Math.max(stats.depth, depth)
    if (looksLikeObject(node)) {
      stats.objects += 1
      const properties = isSchemaObject(node.properties) ? Object.keys(node.properties) : []
      const required = Array.isArray(node.required) ? node.required : []
      const optional = properties.filter((name) => !required.includes(name)).length
      stats.optionalTotal += optional
      stats.maxOptionalPerObject = Math.max(stats.maxOptionalPerObject, optional)
    }
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) stats.unions += 1
    for (const child of children(node, path)) visit(child.schema, child.path, depth + 1)
  }
  visit(schema, [], 0)
  return stats
}
