import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `pairs` (§7): left ↔ right matching, with optional extra right-hand distractors. */

export const PAIR_PRESENTATIONS = ['drag', 'dropdown', 'lines', 'tap-timed', 'memory'] as const
export type PairPresentation = (typeof PAIR_PRESENTATIONS)[number]

export const pairSchema = z.object({
  id: shortIdSchema,
  left: richTextSchema,
  right: richTextSchema,
})
export type Pair = z.infer<typeof pairSchema>

export const pairDistractorSchema = z.object({
  id: shortIdSchema,
  text: richTextSchema,
})

export const pairsPayloadSchema = z.object({
  family: z.literal('pairs'),
  presentation: z.enum(PAIR_PRESENTATIONS),
  pairs: z.array(pairSchema).min(2),
  rightDistractors: z.array(pairDistractorSchema).optional(),
  timeLimitSec: z.int().min(1).optional(),
})
export type PairsPayload = z.infer<typeof pairsPayloadSchema>
