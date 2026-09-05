import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `cards` (§7): flashcards, self-assessed (M-self). */

/** `grade`: the four-button Again/Hard/Good/Easy fieldset. `dialog`: the two-button "I knew it /
 *  no" variant of §4 row 3 — same M-self grader, fewer buttons. */
export const CARD_PRESENTATIONS = ['grade', 'dialog'] as const
export type CardPresentation = (typeof CARD_PRESENTATIONS)[number]

export const cardSchema = z.object({
  id: shortIdSchema,
  front: richTextSchema,
  back: richTextSchema,
  media: z.array(shortIdSchema).optional(),
})
export type Card = z.infer<typeof cardSchema>

export const cardsPayloadSchema = z.object({
  family: z.literal('cards'),
  presentation: z.enum(CARD_PRESENTATIONS),
  cards: z.array(cardSchema).min(1),
})
export type CardsPayload = z.infer<typeof cardsPayloadSchema>
