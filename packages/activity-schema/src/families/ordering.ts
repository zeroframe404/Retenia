import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `ordering` (§7): put items in sequence; graded exact, by adjacent pairs, Kendall τ or position. */

export const ORDERING_SCORINGS = ['exact', 'adjacent-pairs', 'kendall', 'position'] as const
export type OrderingScoring = (typeof ORDERING_SCORINGS)[number]

export const ORDERING_AXES = ['vertical', 'horizontal', 'timeline'] as const
export type OrderingAxis = (typeof ORDERING_AXES)[number]

export const orderingItemSchema = z.object({
  id: shortIdSchema,
  text: richTextSchema,
  media: shortIdSchema.optional(),
  date: z.string().min(1).optional().describe('Label on a timeline axis.'),
  indent: z.int().min(0).optional().describe('Expected indentation level (parsons_problem).'),
})
export type OrderingItem = z.infer<typeof orderingItemSchema>

export const orderingDistractorSchema = z.object({
  id: shortIdSchema,
  text: richTextSchema,
})

export const orderingPayloadSchema = z.object({
  family: z.literal('ordering'),
  items: z.array(orderingItemSchema).min(2),
  correctOrder: z.array(shortIdSchema).min(2).describe('Every item id exactly once.'),
  alternativeOrders: z.array(z.array(shortIdSchema).min(2)).optional(),
  distractors: z.array(orderingDistractorSchema).optional().describe('Items that belong nowhere.'),
  scoring: z.enum(ORDERING_SCORINGS),
  axis: z.enum(ORDERING_AXES).optional(),
  checkIndentation: z.boolean().optional(),
})
export type OrderingPayload = z.infer<typeof orderingPayloadSchema>
