import { RATING_RULES } from '@retenia/core'
import { z } from 'zod'

/**
 * The `grading` and `review` blocks of the envelope (`docs/spec/03-activities.md` §7).
 *
 * `grading.method` is the grader column of the master table (§2's seven graders plus `none`).
 * `review.ratingStrategy` names the row of `docs/spec/02-memory-system.md` §10 that turns the
 * grade into an FSRS rating — deliberately `@retenia/core`'s `RatingRule` vocabulary rather
 * than the spec's `bin | pct` abbreviations, so the block is a `ReviewSpec` after a rename and
 * `toRating` needs no translation table (see `toReviewSpec` in `./grade-result`).
 */

export const GRADING_METHODS = [
  'det',
  'fuzzy',
  'ai',
  'self',
  'speech',
  'code',
  'cas',
  'none',
] as const
export type GradingMethod = (typeof GRADING_METHODS)[number]

export const fuzzyOptionsSchema = z.object({
  caseSensitive: z.boolean().optional(),
  ignoreDiacritics: z.boolean().optional(),
  maxRelativeEditDistance: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Damerau-Levenshtein distance over the longer length; the FUZ default is 0.2.'),
  synonyms: z
    .array(z.array(z.string().min(1)).min(2))
    .optional()
    .describe('Groups of interchangeable answers.'),
})
export type FuzzyOptions = z.infer<typeof fuzzyOptionsSchema>

export const numericOptionsSchema = z.object({
  absTol: z.number().min(0).optional(),
  relTol: z.number().min(0).optional().describe('Relative to the expected value, 0.05 = 5 %.'),
  units: z.array(z.string().min(1)).optional().describe('Accepted unit spellings.'),
})
export type NumericOptions = z.infer<typeof numericOptionsSchema>

export const gradingSchema = z.object({
  method: z.enum(GRADING_METHODS),
  partialCredit: z.boolean().optional(),
  negativeScoring: z.boolean().optional(),
  maxAttempts: z.int().min(1).optional(),
  hintPenalty: z.number().min(0).max(1).optional().describe('Score fraction lost per hint.'),
  timeLimitSec: z.int().min(1).optional(),
  shuffle: z.boolean().optional(),
  fuzzy: fuzzyOptionsSchema.optional(),
  numeric: numericOptionsSchema.optional(),
})
export type Grading = z.infer<typeof gradingSchema>

export const reviewSchema = z.object({
  eligible: z.boolean().describe('false for the lesson-only types: nothing is scheduled.'),
  ratingStrategy: z.enum(RATING_RULES),
  expectedSeconds: z
    .int()
    .min(1)
    .optional()
    .describe('How long the activity takes; "fast" and "slow" fall back to it.'),
})
export type Review = z.infer<typeof reviewSchema>
