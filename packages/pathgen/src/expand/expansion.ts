import { z } from 'zod'
import { generationWarningSchema } from '../schemas/warnings'

/**
 * `LessonExpansion.v1` — what `lessons.expansion` stores (sub-phase 8.3).
 *
 * Almost nothing about a lesson's progress needs a column: `theory !== null` says P3 landed,
 * an `activities` row says P4 did, a `knowledge_items` row says P5 did, and the batches in
 * flight are already in `generation_runs.progress.batch_ids`. This carries the three things
 * that cannot be derived:
 *
 *   * the **attempt counters** — `revision` is how many times "Regenerar" has been pressed
 *     and `variants` how many times "Más ejemplos" has, per family. Without them the second
 *     press of either would replay the first one's cached answer;
 *   * the **`unmet` practice rules**, which are a property of the pool that produced the
 *     block rather than of the block, and which the completion panel shows;
 *   * a **per-stage receipt**, so a resumed run can tell "P4 produced nothing, legitimately"
 *     from "P4 has not run", which the activity rows alone cannot say.
 *
 * `qa` is deliberately left alone: it is the QA gates' column and sub-phase 8.4 starts by
 * writing it, not by migrating data out of it.
 */

export const LESSON_EXPANSION_VERSION = 1

const receipt = z.object({
  custom_id: z.string(),
  at: z.string(),
  model: z.string(),
})

export const lessonExpansionSchema = z.object({
  version: z.literal(LESSON_EXPANSION_VERSION),
  /** The expansion run that last wrote this lesson. */
  run_id: z.string(),
  /** "Regenerar" presses. Part of P3's `custom_id`, and so of P4's and P5's through it. */
  revision: z.number().int().min(0),
  /**
   * How many times the QA gates sent this lesson back to P3 (sub-phase 8.4: at most one).
   *
   * Persisted *with* the revision bump, before the second attempt's P3 lands, so a process
   * that dies mid-attempt resumes into "already regenerated once" rather than into a third
   * rewrite. Additive: a ledger written before this field existed reads as `0`.
   */
  qa_regenerations: z.number().int().min(0).default(0),
  /**
   * "Más ejemplos" presses, under the key `all`: part of every family's P4 `custom_id` and of
   * nothing else, so a second press asks for a genuinely new pool rather than replaying the
   * first one's answer.
   *
   * A record rather than a number because the natural next step is per-family ("more cloze
   * exercises, the rest are fine"), and a shape that already allows it costs nothing now.
   */
  variants: z.record(z.string(), z.number().int().min(0)),
  p3: receipt.extend({ word_count: z.number().int().min(0) }).nullable(),
  p4: receipt
    .omit({ custom_id: true })
    .extend({
      custom_ids: z.record(z.string(), z.string()),
      generated: z.number().int().min(0),
      kept: z.number().int().min(0),
      unmet: z.array(z.object({ rule: z.string(), detail: z.string() })),
    })
    .nullable(),
  p5: receipt
    .extend({
      generated: z.number().int().min(0),
      kept: z.number().int().min(0),
      deduped: z.number().int().min(0),
    })
    .nullable(),
  citations: z.object({
    resolved: z.number().int().min(0),
    dropped: z.number().int().min(0),
    uncited_blocks: z.number().int().min(0),
  }),
  warnings: z.array(generationWarningSchema),
})

export type LessonExpansion = z.infer<typeof lessonExpansionSchema>

export function emptyExpansion(runId: string): LessonExpansion {
  return {
    version: LESSON_EXPANSION_VERSION,
    run_id: runId,
    revision: 0,
    qa_regenerations: 0,
    variants: {},
    p3: null,
    p4: null,
    p5: null,
    citations: { resolved: 0, dropped: 0, uncited_blocks: 0 },
    warnings: [],
  }
}

/**
 * The ledger as stored, or a fresh one.
 *
 * A row whose `expansion` does not parse is treated as absent rather than as an error — the
 * same rule `readExtractionRow` applies to a stored P1 answer. The cost of re-expanding one
 * lesson is a few cents; the cost of failing a 40-lesson run over one unreadable JSON blob is
 * the whole run.
 */
export function readExpansion(value: unknown, runId: string): LessonExpansion {
  const parsed = lessonExpansionSchema.safeParse(value)
  return parsed.success ? parsed.data : emptyExpansion(runId)
}
