import { type ActivityTypeOf, authoringBranch, typesOfFamily } from '@retenia/activity-schema'
import type { ActivityFamily } from '@retenia/core'
import { z } from 'zod'

/**
 * `make_activities@1` — what P4 returns for one lesson and one family
 * (`docs/spec/03-activities.md` §7, §11; `docs/spec/04-path-generation.md` §4, §9). The
 * `schema:` line of `packages/ai/prompts/P4_make_activities/1.md` names this version, and it
 * is the `schemaVersion` half of every P4 `custom_id`.
 *
 * The schema is built **per call**, because §7's rule is that "on each LLM call only the
 * schema of the family to be generated is passed, with the `enum` of `type` reduced to the
 * allowed types". A union of 22 families would be both fragile and expensive, and a `type` a
 * family cannot render would be a parse error rather than a rule to remember.
 *
 * Each candidate is `authoringBranch`'s wrapper: the draft envelope plus the two fields the
 * `activities` row carries and the envelope does not — `bloom` and `misconception_ids`.
 */

export const MAKE_ACTIVITIES_SCHEMA_NAME = 'make_activities'
export const MAKE_ACTIVITIES_SCHEMA_VERSION = '1'
export const MAKE_ACTIVITIES_SCHEMA_ID = `${MAKE_ACTIVITIES_SCHEMA_NAME}@${MAKE_ACTIVITIES_SCHEMA_VERSION}`

/**
 * The ceiling on one call's pool.
 *
 * §4 keeps 4–8 activities per lesson and §2 says to generate two to three times that and
 * filter, so 24 is three times the largest block — enough that the filter has a real choice,
 * low enough that a model which ignored `wanted` cannot bill for a hundred exercises.
 */
export const MAX_CANDIDATES_PER_CALL = 24

export function makeActivitiesOutputSchema<F extends ActivityFamily>(
  family: F,
  types: readonly ActivityTypeOf<F>[] = typesOfFamily(family),
) {
  return z.object({
    candidates: z.array(authoringBranch(family, types)).min(1).max(MAX_CANDIDATES_PER_CALL),
    /** Anything the author could not do: a family this lesson has no material for, say. */
    notes: z.array(z.string().min(1).max(300)).max(6),
  })
}

export type MakeActivitiesOutput = {
  candidates: z.infer<ReturnType<typeof authoringBranch>>[]
  notes: string[]
}
