import { z } from 'zod'

/**
 * A zod schema, in the JSON Schema dialect a provider's strict mode will actually accept.
 *
 * `docs/spec/04-path-generation.md` §8 is specific about Claude's: `output_config.format =
 * json_schema` with `strict: true` "does not accept `min/max`, `pattern` or recursive
 * references (the SDK passes them into descriptions)". Gemini's `responseJsonSchema` takes a
 * broad subset and is quiet about what it drops. Sending a schema with a `pattern` in it is
 * therefore one of two failures, depending on the provider: a 400 that reads like a bug in
 * our request, or a constraint silently ignored — the worse of the two, because the output
 * then looks compliant and is not.
 *
 * So the constraints are moved rather than removed: every one becomes a sentence in the
 * node's `description`, where it is guidance the model reads, and the *real* enforcement
 * stays where `docs/spec/01-decisions.md` §7 rule 7 puts it — `schema.parse()` on the
 * completion, in `runStructured`, which still has the original zod schema with every
 * refinement intact. Nothing is relaxed; only who checks it moves.
 */

/** JSON Schema as this module handles it: a plain JSON object tree. */
export type JsonSchemaNode = Record<string, unknown>

/**
 * Keyword → how it reads in a sentence. The order is the order they appear in a
 * description, so the same schema always produces the same bytes — `custom_id` hashes the
 * schema version rather than this text, but a stable rendering keeps a golden fixture and a
 * provider's own 24 h schema cache from churning for no reason.
 */
const MOVED_KEYWORDS: ReadonlyArray<readonly [string, (value: unknown) => string]> = [
  ['minimum', (v) => `at least ${String(v)}`],
  ['exclusiveMinimum', (v) => `greater than ${String(v)}`],
  ['maximum', (v) => `at most ${String(v)}`],
  ['exclusiveMaximum', (v) => `less than ${String(v)}`],
  ['multipleOf', (v) => `a multiple of ${String(v)}`],
  ['minLength', (v) => `at least ${String(v)} characters`],
  ['maxLength', (v) => `at most ${String(v)} characters`],
  ['pattern', (v) => `matching the regular expression ${String(v)}`],
  ['format', (v) => `in ${String(v)} format`],
  ['minItems', (v) => `at least ${String(v)} items`],
  ['maxItems', (v) => `at most ${String(v)} items`],
  ['uniqueItems', () => 'with no repeated items'],
  ['minProperties', (v) => `at least ${String(v)} properties`],
  ['maxProperties', (v) => `at most ${String(v)} properties`],
]

const MOVED_KEYS: ReadonlySet<string> = new Set(MOVED_KEYWORDS.map(([keyword]) => keyword))

/**
 * Keywords dropped outright, with nothing said about them.
 *
 * `$schema` and `$id` are metadata a provider has no use for; `default` is a value the model
 * would be entitled to return instead of thinking; `examples` inflates a cached schema for
 * no gain. `~standard` is zod's own non-enumerable marker, stripped in case a structured
 * clone somewhere makes it enumerable again.
 */
const DROPPED_KEYWORDS: ReadonlySet<string> = new Set([
  '$schema',
  '$id',
  'default',
  'examples',
  '~standard',
])

function withConstraintsInDescription(node: JsonSchemaNode): JsonSchemaNode {
  const out: JsonSchemaNode = {}
  const moved: string[] = []

  for (const [keyword, phrase] of MOVED_KEYWORDS) {
    if (!(keyword in node)) continue
    const value = node[keyword]
    // `uniqueItems: false` says nothing; neither does an absent constraint.
    if (value === false || value === undefined) continue
    moved.push(phrase(value))
  }

  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key) || MOVED_KEYS.has(key)) continue
    out[key] = value
  }

  if (moved.length > 0) {
    const existing = typeof node.description === 'string' ? node.description.trim() : ''
    const sentence = `Must be ${moved.join(', ')}.`
    out.description = existing === '' ? sentence : `${existing.replace(/\.?$/, '.')} ${sentence}`
  }

  return out
}

/**
 * Rewrite every node of a JSON Schema.
 *
 * `$ref` is deliberately not followed and not resolved: `toStrictJsonSchema` asks zod to
 * throw on cycles and to inline reused subschemas, so a `$ref` reaching here would mean a
 * shape we did not intend to send. It travels through untouched and the provider rejects it,
 * which is a louder failure than quietly flattening something recursive.
 */
export function relaxJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => relaxJsonSchema(entry))
  if (schema === null || typeof schema !== 'object') return schema

  const node = withConstraintsInDescription(schema as JsonSchemaNode)
  const out: JsonSchemaNode = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = relaxJsonSchema(value)
  }
  return out
}

export class SchemaNotRepresentableError extends Error {
  override readonly name = 'SchemaNotRepresentableError'
  constructor(cause: unknown) {
    super(
      'the schema cannot be expressed as JSON Schema for a provider: ' +
        (cause instanceof Error ? cause.message : String(cause)),
    )
  }
}

/**
 * The JSON Schema handed to a provider's strict mode.
 *
 * `io: 'output'` because this describes what the model must *produce*: with an input
 * conversion, a field carrying a zod `.default()` would come back optional and the model
 * would be free to omit it.
 *
 * `cycles: 'throw'` and `reused: 'inline'` are the §8 rule about recursive references,
 * enforced where the schema is written rather than discovered as a provider 400 in
 * production: a schema this function accepts is one every strict mode can compile.
 */
export function toStrictJsonSchema(schema: z.ZodType): unknown {
  let generated: unknown
  try {
    generated = z.toJSONSchema(schema, {
      target: 'draft-07',
      io: 'output',
      // A `z.custom()` or a branded type becomes `{}` — "anything" — rather than failing the
      // call. The zod parse afterwards is what actually enforces it.
      unrepresentable: 'any',
      cycles: 'throw',
      reused: 'inline',
    })
  } catch (error) {
    throw new SchemaNotRepresentableError(error)
  }
  return relaxJsonSchema(generated)
}
