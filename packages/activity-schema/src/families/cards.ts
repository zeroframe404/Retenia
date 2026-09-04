import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `cards` (§7): flashcards, self-assessed (M-self). */

export const cardSchema = z.object({
  id: shortIdSchema,
  front: richTextSchema,
  back: richTextSchema,
  media: z.array(shortIdSchema).optional(),
})
export type Card = z.infer<typeof cardSchema>

export const cardsPayloadSchema = z.object({
  family: z.literal('cards'),
  cards: z.array(cardSchema).min(1),
})
export type CardsPayload = z.infer<typeof cardsPayloadSchema>
