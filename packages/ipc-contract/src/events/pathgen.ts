import { z } from 'zod'
import { generationStageSchema, lessonStatusDtoSchema } from '../channels/pathgen'
import { defineEvents } from '../define'

/**
 * Live generation progress, pushed from main (`docs/spec/04-path-generation.md` §13 step 2:
 * "Reading 14 sources (9/14)", "Detecting 212 concepts", …). Mirrors pathgen's own
 * `ProgressEvent`/`ProgressDetail` field for field — that event carries only `runId`, not a
 * path id, because a run's `pathId` is only settled once `start`'s first write returns (the
 * renderer already has it from `pathgen.start`'s own response). Main throttles these the same
 * way `jobs.progress` throttles job updates, so a listener sees a smooth stage counter rather
 * than one push per chunk.
 */
export const pathgenProgressSchema = z.object({
  runId: z.uuid(),
  stage: generationStageSchema,
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  detail: z
    .object({
      concepts: z.number().int().min(0).optional(),
      cached: z.number().int().min(0).optional(),
      usdSoFar: z.number().min(0).optional(),
      batchId: z.string().optional(),
      /** Which lesson just landed, during the three `expanding_*` stages (sub-phase 8.3). */
      lessonSpecId: z.string().optional(),
    })
    .optional(),
})
export type PathgenProgressEvent = z.infer<typeof pathgenProgressSchema>

/**
 * One lesson finished expanding (sub-phase 8.3, §13 step 5: *"lessons appear
 * progressively"*).
 *
 * Separate from `pathgen.progress` because the two answer different questions: progress is
 * "how far through the stage is the run", and this is "row L07 has changed, redraw it". A
 * panel driven by the counter alone would have to refetch the whole list on every tick.
 */
export const pathgenLessonStatusSchema = z.object({
  runId: z.uuid(),
  pathVersionId: z.uuid(),
  lessonId: z.uuid(),
  specId: z.string(),
  status: lessonStatusDtoSchema,
  activities: z.number().int().min(0),
  flashcards: z.number().int().min(0),
})
export type PathgenLessonStatusEvent = z.infer<typeof pathgenLessonStatusSchema>

export const pathgenEvents = defineEvents({
  'pathgen.progress': pathgenProgressSchema,
  'pathgen.lessonStatus': pathgenLessonStatusSchema,
})
