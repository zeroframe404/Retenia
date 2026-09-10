import type { Activity as ActivityRow, BloomLevel, JsonObject, NewEntity } from '@retenia/core'
import { type Activity, type ActivityDraft, activitySchema } from './envelope'
import { familyOf, isActivityType } from './registry'

/**
 * The envelope ↔ `activities` row mapping (`docs/spec/03-activities.md` §7,
 * `packages/db/src/schema/paths.ts`).
 *
 * The row is not a serialized envelope: `packages/db/src/schema/paths.ts` promotes to columns
 * everything a query filters or joins on — `type`, `family`, `schema_version`, `lang`,
 * `bloom`, `difficulty`, `concept_ids`, `misconception_ids`, `source_refs`, `status` — and
 * keeps `grading` apart from `config` *"because the grader reads it without the rest"*. What
 * is left in `config` is the envelope minus those: the prompt, the instructions, the media,
 * the hints, the explanation, the review block and the payload.
 *
 * Two fields have no envelope home and arrive from outside it: `bloom` and `misconceptionIds`
 * are what `authoringBranch` wraps a generated draft in, and what the item bank sets when it
 * reuses an activity. Everything else round-trips, which `row.test.ts` proves over every
 * committed fixture.
 */

/** What `activities` stores in its `config` column: the envelope minus its promoted columns. */
export interface ActivityConfig {
  prompt: string
  instructions?: string
  media?: unknown[]
  hints?: string[]
  explanation?: string
  review: Activity['review']
  payload: Activity['payload']
  tags?: string[]
}

export interface ActivityRowExtras {
  /** §1.4's Bloom level. `null` when the generator did not label it. */
  bloom?: BloomLevel | null
  /** Ids of the misconceptions the distractors were built from. */
  misconceptionIds?: readonly string[]
  /** The activity's status; `ready` unless a media job or a critic says otherwise. */
  status?: ActivityRow['status']
}

/**
 * One generated (or stored) envelope as the row the repository inserts, minus the two fields
 * only the caller knows: which lesson it belongs to and where in the practice block it sits.
 */
export function toActivityRow(
  activity: ActivityDraft | Activity,
  extras: ActivityRowExtras = {},
): Omit<NewEntity<ActivityRow>, 'lessonId' | 'ordinal'> {
  const config: ActivityConfig = {
    prompt: activity.prompt,
    ...(activity.instructions === undefined ? {} : { instructions: activity.instructions }),
    ...(activity.media === undefined ? {} : { media: activity.media }),
    ...(activity.hints === undefined ? {} : { hints: activity.hints }),
    ...(activity.explanation === undefined ? {} : { explanation: activity.explanation }),
    review: activity.review,
    payload: activity.payload,
    ...(activity.tags === undefined ? {} : { tags: activity.tags }),
  }
  return {
    type: activity.type,
    family: activity.family,
    schemaVersion: activity.schemaVersion,
    lang: activity.lang,
    bloom: extras.bloom ?? null,
    difficulty: activity.difficulty,
    conceptIds: [...activity.skills],
    misconceptionIds: [...(extras.misconceptionIds ?? [])],
    config: config as unknown as JsonObject,
    grading: activity.grading as unknown as JsonObject,
    status: extras.status ?? 'ready',
    sourceRefs: (activity.sources ?? []) as unknown as JsonObject[],
  }
}

/**
 * The reverse: a stored row as the envelope a renderer and a grader read.
 *
 * Parsed rather than cast. A row can predate a schema change, be hand-edited, or come from an
 * import, and every consumer downstream assumes a valid envelope — so the boundary that
 * reassembles one is the boundary that validates it.
 */
export function fromActivityRow(row: ActivityRow): Activity {
  if (!isActivityType(row.type)) {
    throw new TypeError(`fromActivityRow: "${row.type}" is not one of the 98 activity types`)
  }
  const config = row.config as unknown as ActivityConfig
  return activitySchema.parse({
    id: row.id,
    schemaVersion: row.schemaVersion,
    lang: row.lang,
    prompt: config.prompt,
    ...(config.instructions === undefined ? {} : { instructions: config.instructions }),
    ...(config.media === undefined ? {} : { media: config.media }),
    ...(config.hints === undefined ? {} : { hints: config.hints }),
    ...(config.explanation === undefined ? {} : { explanation: config.explanation }),
    ...(row.sourceRefs.length === 0 ? {} : { sources: row.sourceRefs }),
    skills: row.conceptIds,
    difficulty: row.difficulty,
    ...(config.tags === undefined ? {} : { tags: config.tags }),
    grading: row.grading,
    review: config.review,
    // `family` is derived rather than read back: `familyOf` is the single source
    // (`registry.ts`), and a row whose column disagrees with its type must not silently win.
    family: familyOf(row.type),
    type: row.type,
    payload: config.payload,
  })
}
