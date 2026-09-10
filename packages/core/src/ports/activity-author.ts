import type { Activity, ActivityFamily, BloomLevel } from '../entities'
import type { ActivityOption } from '../sessions/activity-option'
import type { NewEntity } from './audit'

/**
 * The data half of the activity-authoring port — P4 of
 * `docs/spec/04-path-generation.md` §9, whose implementation lives in
 * `@retenia/activity-ai` because §8 of the activity spec assigns *"prompts per type,
 * generation with structured outputs, validation + repair"* there.
 *
 * These shapes live in `core` for the ordinary reason: they are expressed entirely in domain
 * types, and both sides of the port import `core`. The transport half — the request the
 * caller dispatches, which is `@retenia/ai`'s — is declared by the consumer, in
 * `@retenia/pathgen`'s `expand/activity-author.ts`, and satisfied structurally.
 */

export interface AuthoringConcept {
  readonly id: string
  readonly name: string
  readonly definition: string
}

export interface AuthoringMisconception {
  /** `X001`, positional within the path draft. */
  readonly id: string
  readonly conceptId: string
  readonly text: string
  readonly whyWrong: string
}

export interface AuthoringObjective {
  readonly text: string
  readonly bloom: BloomLevel
}

/** One block of the theory P3 wrote, as much of it as P4 needs to write exercises about it. */
export interface AuthoringBlock {
  readonly type: string
  readonly content: string
}

export interface ActivityAuthorRequest {
  /** `L07` — half of the `custom_id`, and what a warning names. */
  readonly lessonSpecId: string
  /** The `custom_id` of the P3 call whose theory this reads: the other half. */
  readonly parentCustomId: string
  readonly lang: string
  readonly title: string
  readonly objectives: readonly AuthoringObjective[]
  readonly concepts: readonly AuthoringConcept[]
  readonly blocks: readonly AuthoringBlock[]
  readonly misconceptions: readonly AuthoringMisconception[]
  /** The families this lesson may draw from, narrowed to what the material supports. */
  readonly families: readonly ActivityFamily[]
  /** How many the lesson will keep. The prompt asks for `overGeneration ×` this. */
  readonly wanted: number
  readonly overGeneration: number
  /** Prompts of exercises the lesson already has — "Más ejemplos" must not repeat them. */
  readonly alreadyGenerated: readonly string[]
  /**
   * "Más ejemplos" press count, part of P4's `custom_id` and of P4's alone.
   *
   * It is a variant rather than `AiBinding.force` because this call *adds* to a pool that is
   * already on the row: forcing would replace the cached answer and orphan the activities the
   * learner can already see. "Regenerar", which does mean replace, uses `force`.
   */
  readonly variant: number
}

/** Why a generated candidate never reached the pool. */
export interface ActivityRejection {
  readonly type: string
  /** `checkActivity`'s layer and issue code: `schema`, `choice-single-correct-count`, … */
  readonly code: string
  readonly message: string
}

export interface AuthoredActivity {
  /**
   * A pool-local key, stable within one call: `<custom_id>#<index>`.
   *
   * Not a UUIDv7. Ids are minted by the repositories (`00-conventions.md`), and a candidate
   * the variety filter drops is a row that never existed — so the key exists only to carry
   * `ActivityOption.activityId` from `composeLessonPractice`'s answer back to the row it chose.
   */
  readonly key: string
  /** Ready to insert once the caller knows the lesson and the position in its block. */
  readonly row: Omit<NewEntity<Activity>, 'lessonId' | 'ordinal'>
  /** The same candidate as `composeLessonPractice` selects over; `activityId` is `key`. */
  readonly option: ActivityOption
}

export interface ActivityAuthorCollected {
  readonly activities: readonly AuthoredActivity[]
  readonly rejected: readonly ActivityRejection[]
  /** What the model said it could not do for this family. */
  readonly notes: readonly string[]
}
