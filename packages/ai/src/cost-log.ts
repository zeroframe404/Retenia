import type { JsonObject, JsonValue } from '@retenia/core'
import { z } from 'zod'
import type { AiErrorCode } from './errors'

/**
 * `ai_calls.meta` — and the schema that makes its rule enforceable.
 *
 * `packages/db/src/schema/system.ts` says of the column: *"Request/response identifiers,
 * stop reason, pricing snapshot… never the content itself"*. A comment is not a control.
 * This is: `strictObject` refuses any field nobody declared, and **every string is capped
 * at 128 characters** — below anything a prompt, a learner's answer or a completion fits
 * in, and comfortably above every identifier a provider hands back. Adding
 * `prompt: z.string()` therefore fails in CI (`cost-log.test.ts` introspects the schema)
 * rather than in review.
 */

/** Long enough for a request id or a finish reason; far too short for content. */
export const META_STRING_MAX = 128

const short = z.string().max(META_STRING_MAX)

export const aiCallMetaSchema = z.strictObject({
  /** 1-based, within this target. */
  attempt: z.int().positive(),
  /** 0 = primary, 1 = first fallback. */
  target: z.int().nonnegative(),
  code: short.optional(),
  statusCode: z.int().optional(),
  requestId: short.optional(),
  finishReason: short.optional(),
  pricingRevision: short.optional(),
  rates: z
    .strictObject({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number().nullable(),
    })
    .optional(),
  /** `ai_calls` has no cache-write column; the count still has to survive for the tooltip. */
  cacheWriteTokens: z.int().nonnegative().optional(),
  /**
   * Tokens were probably spent but no usage came back, so 7.5's dashboard can say "plus an
   * unknown amount from 3 timed-out calls" rather than presenting them as free.
   */
  costUnknown: z.boolean().optional(),
  /**
   * 1-based repair turn (`runStructured`'s validation loop), absent on a first attempt.
   *
   * The number nobody wants to be guessing at later: a prompt whose rows are mostly
   * `repair: 1` is a prompt whose schema and wording disagree, and that is visible in the
   * cost log or it is visible nowhere.
   */
  repair: z.int().positive().optional(),
  /** The output was rejected by the schema and this target was given up on. */
  outputRejected: z.boolean().optional(),
  /** `runStructured`'s array mode continued a completion cut off by `maxOutputTokens`. */
  continuation: z.int().positive().optional(),
})

export interface AiCallMeta {
  attempt: number
  target: number
  code?: AiErrorCode
  statusCode?: number
  requestId?: string
  finishReason?: string
  pricingRevision?: string
  rates?: { input: number; output: number; cacheRead: number | null }
  cacheWriteTokens?: number
  costUnknown?: boolean
  repair?: number
  outputRejected?: boolean
  continuation?: number
}

/**
 * Flatten to JSON primitives, then validate **field by field**.
 *
 * Two decisions worth stating, because the obvious implementations both misbehave here.
 *
 * This is written on the settle path of a call that may well have **succeeded**, so it must
 * not throw: `meta` is a TEXT column with a `json_valid` CHECK, and a `BigInt` reaching
 * `JSON.stringify` would turn a working answer into an error the user sees. So coercion
 * comes first.
 *
 * And validation is per field rather than all-or-nothing, because one unrepresentable
 * value should cost only itself. A whole-object `safeParse` would fail on a single bad
 * field and fall back to the minimal row, discarding the `finishReason` and `statusCode`
 * that are exactly what somebody wants when something has already gone wrong.
 *
 * Fields the schema does not declare are dropped here as well as refused there, so the
 * column's "never the content itself" rule holds even for a caller that bypassed the type.
 */
export function sanitizeMeta(meta: AiCallMeta): JsonObject {
  const coerced = coerce(meta as unknown as Record<string, unknown>, 1)

  const out: JsonObject = {}
  for (const [key, schema] of Object.entries(aiCallMetaSchema.shape)) {
    const parsed = schema.safeParse(coerced[key])
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data as JsonValue
  }

  // The two required fields always have a value, even if the caller's was nonsense: a row
  // that cannot say which attempt it was is worse than one that guesses the first.
  if (typeof out.attempt !== 'number') out.attempt = 1
  if (typeof out.target !== 'number') out.target = 0
  return out
}

/** JSON primitives only, one level of nesting, strings clipped. Anything else is dropped. */
function coerce(source: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (value === null) out[key] = null
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string') out[key] = value.slice(0, META_STRING_MAX)
    else if (depth > 0 && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = coerce(value as Record<string, unknown>, depth - 1)
    }
  }
  return out
}
