import { z } from 'zod'
import { richTextSchema, shortIdSchema } from '../common'

/** `long_text` (§7): free production graded by key points (FUZ set-match), a rubric (AI) or the user. */

export const keyPointSchema = z.object({
  id: shortIdSchema,
  text: z.string().min(1),
  weight: z.number().positive().optional().describe('Relative weight; default 1.'),
  aliases: z.array(z.string().min(1)).optional().describe('Other phrasings that count as covered.'),
})
export type KeyPoint = z.infer<typeof keyPointSchema>

export const rubricLevelSchema = z.object({
  score: z.number().min(0).max(1),
  description: z.string().min(1),
})

export const rubricCriterionSchema = z.object({
  id: shortIdSchema,
  criterion: z.string().min(1),
  weight: z.number().positive().optional(),
  levels: z.array(rubricLevelSchema).min(2).describe('Anchored levels, e.g. 0 / 0.5 / 1.'),
})
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>

export const longTextSectionSchema = z.object({
  id: shortIdSchema,
  title: z.string().min(1),
  hint: richTextSchema.optional(),
})

export const longTextPayloadSchema = z.object({
  family: z.literal('long_text'),
  minWords: z.int().min(1).optional(),
  maxWords: z.int().min(1).optional(),
  sections: z.array(longTextSectionSchema).optional().describe('Scaffold (structure_strip).'),
  modelAnswer: richTextSchema.optional(),
  keyPoints: z.array(keyPointSchema).optional(),
  rubric: z.array(rubricCriterionSchema).optional(),
})
export type LongTextPayload = z.infer<typeof longTextPayloadSchema>
