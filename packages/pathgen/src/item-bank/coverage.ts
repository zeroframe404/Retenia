import type { LessonKind, LessonStatus } from '@retenia/core'
import { z } from 'zod'
import { generationWarningSchema } from '../schemas/warnings'

/**
 * How much of each module the written lessons actually cover — the "coverage" of §3 stage 5's
 * exam weight, *importance × coverage* (`docs/spec/04-path-generation.md`). Sequencing can only
 * pass it as 1 (`sequencing/exam.ts`): nothing is written at that point. Stage 8's coverage
 * gate (gate c) measures it per lesson and records what a lesson failed to cover as a
 * `concept_uncovered` warning in `lessons.qa`; this reads those back, per module, once every
 * core lesson has settled — so the final exam's items follow what the path really teaches
 * rather than what the outline promised.
 *
 * Pure: a tree in, numbers out.
 */

/** A lesson is settled once it left the pipeline: through QA (`ready`) or given up (`failed`). */
const SETTLED: ReadonlySet<LessonStatus> = new Set(['ready', 'failed'])

export interface CoverageLesson {
  readonly kind: LessonKind
  readonly status: LessonStatus
  readonly conceptIds: readonly string[]
  readonly qa: unknown
}

/** The slice of `PathTree` coverage reads; a `PathTree` is one. */
export interface CoverageTree {
  readonly sections: readonly {
    readonly modules: readonly { readonly lessons: readonly CoverageLesson[] }[]
  }[]
}

export interface CoverageModule {
  /** The draft's module id (`M03`). */
  readonly id: string
  readonly concept_ids: readonly string[]
}

function coreLessonsOf(tree: CoverageTree): CoverageLesson[] {
  return tree.sections.flatMap((section) =>
    section.modules.flatMap((module) => module.lessons.filter((lesson) => lesson.kind === 'core')),
  )
}

/** Every core lesson of the version has settled — the point where coverage is measurable. */
export function coreLessonsSettled(tree: CoverageTree): boolean {
  const core = coreLessonsOf(tree)
  return core.length > 0 && core.every((lesson) => SETTLED.has(lesson.status))
}

/** Lenient on everything but the warnings, the way `readLessonQa` is lenient on the blob. */
const qaWarningsSchema = z.object({ warnings: z.array(generationWarningSchema) })

function uncoveredOf(qa: unknown): string[] {
  const parsed = qaWarningsSchema.safeParse(qa)
  if (!parsed.success) return []
  return parsed.data.warnings.flatMap((entry) => {
    const ids = entry.params.concept_ids
    return entry.code === 'concept_uncovered' && Array.isArray(ids) ? ids : []
  })
}

/**
 * Per draft module id, the importance-weighted share of its concepts some lesson covers, in
 * [0, 1]. A concept is missing when a lesson that should have taught it did not — its QA
 * flagged it `concept_uncovered`, or the lesson failed — and no other lesson taught it. A
 * concept no lesson claims counts as covered: there is no evidence against it, and the gate
 * only speaks about the concepts a lesson was given.
 */
export function moduleCoverage(
  tree: CoverageTree,
  modules: readonly CoverageModule[],
  importanceOf: (conceptId: string) => number,
): Map<string, number> {
  const covered = new Set<string>()
  const missed = new Set<string>()
  for (const lesson of coreLessonsOf(tree)) {
    if (lesson.status === 'failed') {
      for (const id of lesson.conceptIds) missed.add(id)
      continue
    }
    if (lesson.status !== 'ready') continue
    const uncovered = new Set(uncoveredOf(lesson.qa))
    for (const id of lesson.conceptIds) (uncovered.has(id) ? missed : covered).add(id)
    for (const id of uncovered) missed.add(id)
  }

  const coverage = new Map<string, number>()
  for (const module of modules) {
    const concepts = [...new Set(module.concept_ids)]
    if (concepts.length === 0) {
      coverage.set(module.id, 1)
      continue
    }
    const isMissing = (id: string) => missed.has(id) && !covered.has(id)
    const weights = concepts.map((id) => Math.max(0, importanceOf(id)))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    const share =
      total > 0
        ? concepts.reduce((sum, id, i) => sum + (isMissing(id) ? 0 : (weights[i] as number)), 0) /
          total
        : concepts.filter((id) => !isMissing(id)).length / concepts.length
    coverage.set(module.id, share)
  }
  return coverage
}

/**
 * The draft's topic weights — each module's total importance, coverage taken as 1 — times the
 * measured coverage, renormalised to sum to one (four decimals). A topic whose module has no
 * coverage entry keeps its weight. All-zero stays all-zero: the blueprint then splits evenly,
 * which is the one fair answer when nothing was covered.
 */
export function coverageWeightedTopics(
  topics: readonly { readonly module_id: string; readonly weight: number }[],
  coverage: ReadonlyMap<string, number>,
): { module_id: string; weight: number; coverage: number }[] {
  const raw = topics.map((topic) => {
    const measured = Math.min(1, Math.max(0, coverage.get(topic.module_id) ?? 1))
    return {
      module_id: topic.module_id,
      coverage: measured,
      raw: Math.max(0, topic.weight) * measured,
    }
  })
  const total = raw.reduce((sum, topic) => sum + topic.raw, 0)
  return raw.map((topic) => ({
    module_id: topic.module_id,
    weight: total > 0 ? Math.round((topic.raw / total) * 10_000) / 10_000 : 0,
    coverage: Math.round(topic.coverage * 10_000) / 10_000,
  }))
}
