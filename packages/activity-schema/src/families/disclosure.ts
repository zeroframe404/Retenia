import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `disclosure` (§7): theory blocks — accordion, tabs, process, timeline, flip, stack. Not graded. */

export const DISCLOSURE_PRESENTATIONS = [
  'accordion',
  'tabs',
  'process',
  'timeline',
  'flip',
  'stack',
] as const
export type DisclosurePresentation = (typeof DISCLOSURE_PRESENTATIONS)[number]

export const disclosureItemSchema = z.object({
  id: shortIdSchema,
  title: z.string().min(1),
  body: richTextSchema,
})

export const disclosurePayloadSchema = z.object({
  family: z.literal('disclosure'),
  presentation: z.enum(DISCLOSURE_PRESENTATIONS).optional(),
  items: z.array(disclosureItemSchema).min(1),
})
export type DisclosurePayload = z.infer<typeof disclosurePayloadSchema>
