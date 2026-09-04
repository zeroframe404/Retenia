import type { ActivityFamily } from '@retenia/core'
import { CONFIDENCE_LEVELS } from '@retenia/core'
import { z } from 'zod'
import { shortIdSchema } from './common'
import { isMvpFamily } from './registry'

/**
 * What the user answers, per family — the `answer` JSON of an `attempts` row and the input of
 * every grader. Strict objects: an unknown key is a renderer bug, not data.
 */

export const gradeLiteralSchema = z.literal([1, 2, 3, 4])

export const choiceResponseSchema = z.strictObject({
  sets: z.array(z.strictObject({ selected: z.array(shortIdSchema) })).min(1),
  confidence: z.enum(CONFIDENCE_LEVELS).optional(),
})
export const textInputResponseSchema = z.strictObject({ value: z.string() })
export const clozeResponseSchema = z.strictObject({ gaps: z.record(shortIdSchema, z.string()) })
export const longTextResponseSchema = z.strictObject({ text: z.string() })
export const pairsResponseSchema = z.strictObject({
  matches: z.array(z.strictObject({ left: shortIdSchema, right: shortIdSchema })),
})
export const orderingResponseSchema = z.strictObject({
  order: z.array(shortIdSchema),
  indents: z.record(shortIdSchema, z.int().min(0)).optional(),
})
export const categorizeResponseSchema = z.strictObject({
  placements: z.record(shortIdSchema, z.array(shortIdSchema)),
})
export const textMarkResponseSchema = z.strictObject({ markedIds: z.array(shortIdSchema) })
export const cardsResponseSchema = z.strictObject({ rating: gradeLiteralSchema })
export const disclosureResponseSchema = z.strictObject({ openedIds: z.array(shortIdSchema) })

export const RESPONSE_SCHEMAS = {
  choice: choiceResponseSchema,
  text_input: textInputResponseSchema,
  cloze: clozeResponseSchema,
  long_text: longTextResponseSchema,
  pairs: pairsResponseSchema,
  ordering: orderingResponseSchema,
  categorize: categorizeResponseSchema,
  text_mark: textMarkResponseSchema,
  cards: cardsResponseSchema,
  disclosure: disclosureResponseSchema,
} as const

export type ResponseFamily = keyof typeof RESPONSE_SCHEMAS
export type Response<F extends ResponseFamily = ResponseFamily> = z.infer<
  (typeof RESPONSE_SCHEMAS)[F]
>

export function hasResponseSchema(family: ActivityFamily): family is ResponseFamily {
  return isMvpFamily(family)
}

/** The response schema of an MVP family; a placeholder family has none yet. */
export function responseSchemaFor<F extends ResponseFamily>(family: F): (typeof RESPONSE_SCHEMAS)[F]
export function responseSchemaFor(family: ActivityFamily): z.ZodType
export function responseSchemaFor(family: ActivityFamily): z.ZodType {
  if (!hasResponseSchema(family)) {
    throw new RangeError(`responseSchemaFor: family "${family}" has no response schema yet`)
  }
  return RESPONSE_SCHEMAS[family]
}
