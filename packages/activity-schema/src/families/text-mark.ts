import { z } from 'zod'
import { COLLECTION_MAX, LABEL_MAX, shortIdSchema } from '../common'

/** `text_mark` (§7): mark the words — tokens of a passage, some of which are the targets. */

export const textTokenSchema = z.object({
  id: shortIdSchema,
  text: z.string().min(1).max(LABEL_MAX),
})

export const textMarkPayloadSchema = z.object({
  family: z.literal('text_mark'),
  tokens: z
    .array(textTokenSchema)
    .min(2)
    .max(COLLECTION_MAX)
    .describe('The passage split into markable tokens, in order.'),
  correctIds: z.array(shortIdSchema).min(1).max(COLLECTION_MAX),
})
export type TextMarkPayload = z.infer<typeof textMarkPayloadSchema>
