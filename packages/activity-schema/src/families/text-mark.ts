import { z } from 'zod'
import { shortIdSchema } from '../common'

/** `text_mark` (§7): mark the words — tokens of a passage, some of which are the targets. */

export const textTokenSchema = z.object({
  id: shortIdSchema,
  text: z.string().min(1),
})

export const textMarkPayloadSchema = z.object({
  family: z.literal('text_mark'),
  tokens: z
    .array(textTokenSchema)
    .min(2)
    .describe('The passage split into markable tokens, in order.'),
  correctIds: z.array(shortIdSchema).min(1),
})
export type TextMarkPayload = z.infer<typeof textMarkPayloadSchema>
