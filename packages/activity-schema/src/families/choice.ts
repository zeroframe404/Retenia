import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/**
 * `choice` (`docs/spec/03-activities.md` §7): one or more sets of options. A set with
 * `multiple: false` has exactly one correct option (`mcq_single`, `true_false`, …); with
 * `multiple: true` it is a multiple-response set (`mcq_multi`, `statement_set`).
 */

export const CHOICE_LAYOUTS = ['list', 'grid', 'inline'] as const
export type ChoiceLayout = (typeof CHOICE_LAYOUTS)[number]

export const choiceOptionSchema = z.object({
  id: shortIdSchema,
  text: richTextSchema,
  media: shortIdSchema.optional().describe('A media id from the envelope.'),
  correct: z.boolean(),
  feedback: richTextSchema.optional().describe('Shown when this option is picked.'),
})
export type ChoiceOption = z.infer<typeof choiceOptionSchema>

export const choiceSetSchema = z.object({
  id: shortIdSchema.optional(),
  stem: richTextSchema
    .optional()
    .describe('The question of this set, when it differs from the prompt.'),
  options: z.array(choiceOptionSchema).min(2),
  multiple: z.boolean().describe('false: exactly one correct option; true: multiple response.'),
  minSelect: z.int().min(0).optional(),
  maxSelect: z.int().min(1).optional(),
})
export type ChoiceSet = z.infer<typeof choiceSetSchema>

export const choicePayloadSchema = z.object({
  family: z.literal('choice'),
  sets: z.array(choiceSetSchema).min(1),
  layout: z.enum(CHOICE_LAYOUTS).optional(),
  askConfidence: z.boolean().optional().describe('Certainty-based marking (confidence_mcq).'),
})
export type ChoicePayload = z.infer<typeof choicePayloadSchema>
