import { gradeActivity } from '@retenia/activity-graders'
import type { Activity, ActivityType, GradeResult, Issue } from '@retenia/activity-schema'
import {
  ACTIVITY_TYPES,
  familyOf,
  isActivityType,
  validateActivity,
} from '@retenia/activity-schema'
import type { ActivityFamily, GradeMeta, RatingRule } from '@retenia/core'
import type { ActivityRendererComponent } from './renderers'
import { familyRenderer, hasRenderer } from './renderers'

/**
 * The open type registry of `docs/spec/03-activities.md` §9 and §13 rule 4: *"an open type registry
 * so that phase 3 and H5P content do not force changes to the core"*. One file per type under
 * `types/`, each calling `registerActivityType`; nothing else in the engine knows the list.
 *
 * The static half of a type (family, grader, rating strategy) already lives in
 * `activity-schema`'s 98-row table, so `defineActivityType` reads it from there instead of asking
 * every type file to repeat it — a row and its registry entry cannot drift apart.
 */

/** Where a generation call draws its source text from (§11's pipeline). */
export const SOURCE_MODES = ['chunk', 'section', 'skill', 'document'] as const
export type SourceMode = (typeof SOURCE_MODES)[number]

/** §5's progression per skill: recognition → assisted production → free production. */
export const PROGRESSION_STAGES = ['theory', 'recognition', 'assisted', 'production'] as const
export type ProgressionStage = (typeof PROGRESSION_STAGES)[number]

export interface ActivityGenerationSpec {
  /** The prompt `packages/ai` fills in for this type. A stub until sub-phase 8.3. */
  promptTemplate: string
  /** The payload family whose JSON Schema is passed on the call (§7: one schema per call). */
  schemaRef: ActivityFamily
  needsMedia: boolean
  /** How many items of this type one call should produce. */
  itemsPerCall: number
  sourceMode: SourceMode
}

export interface ActivityReviewSpec {
  /** §3's M-* rule, as core's `RatingRule`. */
  strategy: RatingRule
  /** The generator's estimate, in seconds; `toRating`'s fallback before a personal median exists. */
  expectedSeconds: number
  progression: ProgressionStage
}

export interface ActivityCapabilities {
  /** Runs with no network: everything in the MVP does. */
  offline: boolean
  needsMic: boolean
  /** Needs the isolated code runner (§10: "never in the renderer"). */
  needsSandbox: boolean
}

export type ActivityGrader = (activity: Activity, response: unknown, meta: GradeMeta) => GradeResult

export interface ActivityTypeEntry {
  type: ActivityType
  family: ActivityFamily
  Renderer: ActivityRendererComponent
  grader: ActivityGrader
  validate: (activity: Activity) => Issue[]
  generator: ActivityGenerationSpec
  review: ActivityReviewSpec
  capabilities: ActivityCapabilities
}

const REGISTRY = new Map<ActivityType, ActivityTypeEntry>()

export class ActivityTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActivityTypeError'
  }
}

/**
 * Registers one type. Rejects a type id the 98-row table does not know, a family that contradicts
 * the table, and a second registration of the same id — a duplicate is a copy-paste bug in a
 * `types/` file, and silently overwriting it would swap a renderer at import order's whim.
 */
export function registerActivityType(entry: ActivityTypeEntry): ActivityTypeEntry {
  if (!isActivityType(entry.type)) {
    throw new ActivityTypeError(`"${entry.type}" is not one of the 98 activity types`)
  }
  const expected = familyOf(entry.type)
  if (entry.family !== expected) {
    throw new ActivityTypeError(
      `"${entry.type}" belongs to family "${expected}", not "${entry.family}"`,
    )
  }
  if (REGISTRY.has(entry.type)) {
    throw new ActivityTypeError(`"${entry.type}" is already registered`)
  }
  const frozen = Object.freeze(entry)
  REGISTRY.set(entry.type, frozen)
  return frozen
}

export function isActivityTypeRegistered(type: string): type is ActivityType {
  return isActivityType(type) && REGISTRY.has(type)
}

export function getActivityType(type: ActivityType): ActivityTypeEntry {
  const entry = REGISTRY.get(type)
  if (!entry) throw new ActivityTypeError(`"${type}" has no renderer registered yet`)
  return entry
}

export function findActivityType(type: string): ActivityTypeEntry | undefined {
  return isActivityType(type) ? REGISTRY.get(type) : undefined
}

/** §9's `getRenderer(type)`. */
export function getRenderer(type: ActivityType): ActivityRendererComponent {
  return getActivityType(type).Renderer
}

/** The registered ids, in the master-table order of §4. */
export function registeredActivityTypes(): readonly ActivityTypeEntry[] {
  return Object.freeze([...REGISTRY.values()])
}

/** Test-only: drops every registration so a suite can assert on a fresh registry. */
export function resetActivityTypeRegistry(): void {
  REGISTRY.clear()
}

export interface ActivityTypeDefinition {
  type: ActivityType
  generator: Omit<ActivityGenerationSpec, 'schemaRef'> & { schemaRef?: ActivityFamily }
  review: Omit<ActivityReviewSpec, 'strategy'> & { strategy?: RatingRule }
  capabilities?: Partial<ActivityCapabilities>
  /** Overrides the family renderer — an escape hatch for a type that needs its own screen. */
  Renderer?: ActivityRendererComponent
  grader?: ActivityGrader
  validate?: (activity: Activity) => Issue[]
}

const DEFAULT_CAPABILITIES: ActivityCapabilities = Object.freeze({
  offline: true,
  needsMic: false,
  needsSandbox: false,
})

/**
 * Fills a registry entry from the 98-row table: `family`, the family's renderer and grader, the
 * per-type validation rules, and the row's rating strategy. A type file therefore states only what
 * the table does not know — the generation spec, the expected duration, the progression stage and
 * any capability that is not the default.
 */
export function defineActivityType(definition: ActivityTypeDefinition): ActivityTypeEntry {
  const { type } = definition
  if (!isActivityType(type)) {
    throw new ActivityTypeError(`"${type}" is not one of the 98 activity types`)
  }
  const meta = ACTIVITY_TYPES[type]
  let Renderer = definition.Renderer
  if (Renderer === undefined) {
    if (!hasRenderer(meta.family)) {
      throw new ActivityTypeError(
        `"${type}" is of family "${meta.family}", which has no renderer yet — pass one explicitly`,
      )
    }
    Renderer = familyRenderer(meta.family)
  }
  return registerActivityType({
    type,
    family: meta.family,
    Renderer,
    grader: definition.grader ?? gradeActivity,
    validate: definition.validate ?? validateActivity,
    generator: { schemaRef: meta.family, ...definition.generator },
    review: { strategy: meta.ratingStrategy, ...definition.review },
    capabilities: { ...DEFAULT_CAPABILITIES, ...definition.capabilities },
  })
}
