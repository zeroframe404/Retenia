import type { Entity, JsonObject, JsonValue } from './_common'
import type {
  ActivityFamily,
  ActivityStatus,
  BloomLevel,
  LessonKind,
  LessonStatus,
  PathStatus,
} from './enums'

/** A learning path, its frozen versions, and the version-owned tree
 *  sections → modules → lessons → activities (`docs/spec/04-path-generation.md` §8). */

export interface LearningPath extends Entity {
  title: string
  language: string
  level: string | null
  goal: string | null
  /** ISO `YYYY-MM-DD`. */
  targetDate: string | null
  status: PathStatus
  /** The `number` of the `PathVersion` currently being studied. */
  activeVersion: number | null
  sourceIds: string[]
  settings: JsonObject | null
}

/**
 * One frozen generation of a path. The tree below it is immutable once `frozenAt` is set:
 * regeneration produces a new version rather than editing this one
 * (`docs/spec/01-decisions.md` §3, "fixed path with remediation").
 */
export interface PathVersion extends Entity {
  pathId: string
  number: number
  spec: JsonObject
  knowledgeGraph: JsonObject | null
  manifest: JsonObject | null
  diff: JsonObject | null
  frozenAt: Date | null
}

export interface Section extends Entity {
  pathVersionId: string
  ordinal: number
  /** The id this node carries inside the PathSpec (`S03`), stable across versions. */
  specId: string
  title: string
  unlockRule: JsonObject | null
  xpReward: number
}

export interface Module extends Entity {
  sectionId: string
  ordinal: number
  specId: string
  title: string
  objectives: JsonValue[]
  diagnosticItemIds: string[]
  unlockRule: JsonObject | null
  xpReward: number
}

export interface Lesson extends Entity {
  moduleId: string
  ordinal: number
  /** `L07`, or `L07.r1` for a remediation derived from it. */
  specId: string
  kind: LessonKind
  parentLessonId: string | null
  title: string
  status: LessonStatus
  objectives: JsonValue[]
  conceptIds: string[]
  prerequisiteLessonIds: string[]
  estimatedMinutes: number | null
  theory: JsonObject | null
  citations: JsonValue[]
  qa: JsonObject | null
  remediation: JsonObject | null
  unlockRule: JsonObject | null
  xpReward: number
  completedAt: Date | null
}

/** One exercise. `lessonId` is null for item-bank-only activities (exams, diagnostics). */
export interface Activity extends Entity {
  lessonId: string | null
  ordinal: number | null
  /** One of the 98 type ids of `docs/spec/03-activities.md`. */
  type: string
  family: ActivityFamily
  schemaVersion: number
  lang: string
  bloom: BloomLevel | null
  /** 1–5. */
  difficulty: number | null
  conceptIds: string[]
  misconceptionIds: string[]
  config: JsonObject
  grading: JsonObject
  status: ActivityStatus
  sourceRefs: JsonValue[]
}
