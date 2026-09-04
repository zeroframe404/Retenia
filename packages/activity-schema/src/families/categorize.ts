import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `categorize` (§7): group sort — every item belongs to one or more categories. */

export const categorySchema = z.object({
  id: shortIdSchema,
  label: richTextSchema,
})

export const categorizeItemSchema = z.object({
  id: shortIdSchema,
  text: richTextSchema,
  categoryIds: z.array(shortIdSchema).min(1),
})
export type CategorizeItem = z.infer<typeof categorizeItemSchema>

export const categorizePayloadSchema = z.object({
  family: z.literal('categorize'),
  categories: z.array(categorySchema).min(2),
  items: z.array(categorizeItemSchema).min(2),
})
export type CategorizePayload = z.infer<typeof categorizePayloadSchema>
