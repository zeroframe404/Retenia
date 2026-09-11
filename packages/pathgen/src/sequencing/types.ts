import type { GenerationWarning } from '../schemas/warnings'
import type { LessonOrigin, Objective, SourceRef } from '../validate/types'

/**
 * What stage 5 produces: the body of the `PathDraft.v1` document
 * (`docs/spec/04-path-generation.md` §3 stage 5, §8). JSON-shaped throughout — mutable
 * arrays, `null` rather than `undefined` — because it is written into `path_versions.spec`
 * as it is.
 */

export interface SequencingConfig {
  readonly primarySourceId: string
  readonly sourceIds: readonly string[]
  /** 0 or less means "no pace": no weeks estimate and no exam-date check. */
  readonly paceHoursPerWeek: number
  readonly forExam: { readonly date: string } | null
}

export interface SequencingLimits {
  /** §4: 3–7 lessons per module. */
  readonly lessonsPerModule: { readonly min: number; readonly max: number }
  /** A warm-up comes from a lesson at least `minDistance` back, and not within `cooldown`. */
  readonly warmup: { readonly minDistance: number; readonly cooldown: number }
  /** §4: 10–15 items per reinforcement; `earlierRatio` of them from earlier modules. */
  readonly reinforcement: {
    readonly itemsPerConcept: number
    readonly minItems: number
    readonly maxItems: number
    readonly earlierRatio: number
  }
  /** §3 stage 5: a cumulative checkpoint every 3–4 modules. */
  readonly checkpoint: {
    readonly spanMin: number
    readonly spanMax: number
    readonly itemsPerModule: number
    readonly minItems: number
    readonly maxItems: number
  }
  readonly exam: {
    readonly itemsPerModule: number
    readonly minItems: number
    readonly maxItems: number
  }
  /** A lesson is 5–15 minutes of theory and practice (§1.1 "microlearning"); the model's
   *  estimate is clamped to this band and a missing one takes the default. */
  readonly lessonMinutes: { readonly min: number; readonly max: number; readonly default: number }
  readonly minutesPerItem: {
    readonly reinforcement: number
    readonly checkpoint: number
    readonly exam: number
  }
}

export const DEFAULT_SEQUENCING_LIMITS: SequencingLimits = Object.freeze({
  lessonsPerModule: Object.freeze({ min: 3, max: 7 }),
  warmup: Object.freeze({ minDistance: 2, cooldown: 2 }),
  reinforcement: Object.freeze({
    itemsPerConcept: 1.25,
    minItems: 10,
    maxItems: 15,
    earlierRatio: 3 / 7,
  }),
  checkpoint: Object.freeze({
    spanMin: 3,
    spanMax: 4,
    itemsPerModule: 4,
    minItems: 12,
    maxItems: 20,
  }),
  exam: Object.freeze({ itemsPerModule: 4, minItems: 20, maxItems: 40 }),
  lessonMinutes: Object.freeze({ min: 7, max: 20, default: 12 }),
  minutesPerItem: Object.freeze({ reinforcement: 1, checkpoint: 1, exam: 1.5 }),
})

export interface SequencingOptions {
  /**
   * What the seeded shuffles draw from. The run's *inputs* digest — source hashes, config
   * hash, prompt versions — rather than its id, so the same inputs give the same draft on
   * every run (§7).
   */
  readonly seed: string
  /** From the `Clock` port; read only for the exam-date check. */
  readonly now: Date
  /** How much of a module's concepts the lessons actually cover, 0–1. `1` by default: no
   *  lesson is written at sequencing time. The item bank applies the measured coverage to
   *  the exam once the lessons settle (`item-bank/coverage.ts`). */
  readonly coverageOf?: (moduleId: string) => number
  readonly limits?: Partial<SequencingLimits>
  /** The ceiling merged modules keep their objectives under; defaults to the lesson limit. */
  readonly maxObjectives?: number
}

export interface CoreLessonNode {
  /** `L07`. */
  id: string
  kind: 'core'
  title: string
  concept_ids: string[]
  /** At most one: the concept this lesson opens by retrieving (§4 step 2, "activation"). */
  warmup_concept_ids: string[]
  objectives: Objective[]
  prerequisite_lesson_ids: string[]
  estimated_minutes: number
  source_refs: SourceRef[]
  origin: LessonOrigin
}

export interface ReinforcementNode {
  /** `M03.reinf`. */
  id: string
  kind: 'reinforcement'
  module_id: string
  /** The module's own concepts and the earlier ones, interleaved — the order to draw items in. */
  concept_ids: string[]
  earlier_concept_ids: string[]
  item_count: number
  estimated_minutes: number
}

export interface CheckpointNode {
  /** `C02`. */
  id: string
  kind: 'checkpoint'
  module_ids: string[]
  concept_ids: string[]
  item_count: number
  estimated_minutes: number
}

export interface ModuleNode {
  /** `M03`, numbered across the whole path. */
  id: string
  title: string
  objectives: Objective[]
  /** Every concept its lessons teach, in lesson order. */
  concept_ids: string[]
  lessons: CoreLessonNode[]
  reinforcement: ReinforcementNode
  /** Set on the last module of a checkpoint span. */
  checkpoint: CheckpointNode | null
  estimated_minutes: number
}

export interface SectionNode {
  /** `S01`. */
  id: string
  title: string
  modules: ModuleNode[]
}

export interface FinalExamBlueprint {
  /** Weights sum to exactly 1 in hundredths (largest-remainder rounding). */
  topics: Array<{ module_id: string; weight: number }>
  item_count: number
}

export interface FinalExamNode {
  id: 'FINAL'
  kind: 'final_exam'
  blueprint: FinalExamBlueprint
  estimated_minutes: number
}

export interface PathStats {
  sections: number
  modules: number
  lessons: number
  checkpoints: number
  concepts: number
  minutes: number
  weeks_estimate: number | null
}

export interface SequencedPath {
  sections: SectionNode[]
  final_exam: FinalExamNode
  stats: PathStats
  warnings: GenerationWarning[]
}
