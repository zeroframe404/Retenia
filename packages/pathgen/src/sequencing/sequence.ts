import { type GenerationWarning, warning } from '../schemas/warnings'
import type {
  ConceptEdge,
  KnowledgeGraph,
  SectionSpec,
  ValidatedSynthesis,
} from '../validate/types'
import { DEFAULT_IMPORTANCE_THRESHOLD, DEFAULT_LESSON_LIMITS } from '../validate/types'
import { buildCheckpoints } from './checkpoints'
import { buildFinalExam } from './exam'
import { orderHierarchy } from './hierarchy'
import { assignIds, prerequisitesOf, sourceRefsOf } from './ids'
import { liftGraph } from './lift'
import { lessonMinutes, weeksAvailable, weeksEstimate } from './minutes'
import { fitModuleSizes } from './module-size'
import { buildReinforcement } from './reinforcement'
import {
  type CoreLessonNode,
  DEFAULT_SEQUENCING_LIMITS,
  type ModuleNode,
  type SectionNode,
  type SequencedPath,
  type SequencingConfig,
  type SequencingLimits,
  type SequencingOptions,
} from './types'
import { assignWarmups } from './warmup'

/**
 * Stage 5 of `docs/spec/04-path-generation.md` §3, as one pure function: the validated
 * graph and outline in, the body of the `PathDraft.v1` out. Deterministic — no clock, no
 * randomness beyond the seed, no dependence on input order — because §7 says
 * reproducibility comes from "the sequencing being pure code".
 *
 * lift → order the hierarchy → fit module sizes → ids → warm-ups → reinforcements →
 * checkpoints → final exam → minutes and weeks.
 */

export interface SequencingResult {
  readonly draft: SequencedPath
  /** The validated graph minus the prerequisite edges the hierarchy sort had to drop. */
  readonly graph: KnowledgeGraph
}

export function resolveSequencingLimits(
  overrides: Partial<SequencingLimits> | undefined,
): SequencingLimits {
  return { ...DEFAULT_SEQUENCING_LIMITS, ...overrides }
}

/** The primary source first, then the rest as configured — the rank every anchor uses. */
export function orderedSources(config: SequencingConfig): string[] {
  return [config.primarySourceId, ...config.sourceIds.filter((id) => id !== config.primarySourceId)]
}

export function sequencePath(
  validated: ValidatedSynthesis,
  config: SequencingConfig,
  options: SequencingOptions,
): SequencingResult {
  const limits = resolveSequencingLimits(options.limits)
  const coverageOf = options.coverageOf ?? (() => 1)
  const sourceIds = orderedSources(config)
  const warnings: GenerationWarning[] = []

  const lifted = liftGraph(validated, sourceIds)
  const hierarchy = orderHierarchy(lifted, validated.outline)
  warnings.push(...hierarchy.warnings)

  const layout = fitModuleSizes(
    hierarchy.sections,
    validated.outline,
    limits.lessonsPerModule,
    options.maxObjectives ?? DEFAULT_LESSON_LIMITS.objectivesPerLesson.max,
  )
  warnings.push(...layout.warnings)

  const removed = new Set(hierarchy.removedConceptEdges)
  const graph: KnowledgeGraph = {
    nodes: validated.graph.nodes,
    edges: validated.graph.edges.filter((edge: ConceptEdge) => !removed.has(edge)),
  }

  const numbered = assignIds(layout)

  // Core lessons, in final order, without their warm-ups yet.
  const flatLessons: CoreLessonNode[] = []
  const lessonsByModule: CoreLessonNode[][] = []
  for (const section of layout.sections) {
    for (const module of section.modules) {
      const lessons: CoreLessonNode[] = []
      for (const ref of module.lessons) {
        const lesson: CoreLessonNode = {
          id: numbered.lessonIds.get(ref.id) as string,
          kind: 'core',
          title: ref.lesson.title,
          concept_ids: [...ref.lesson.concept_ids],
          warmup_concept_ids: [],
          objectives: ref.lesson.objectives.map((objective) => ({ ...objective })),
          prerequisite_lesson_ids: prerequisitesOf(ref.id, hierarchy.edges, numbered.lessonIds),
          estimated_minutes: lessonMinutes(ref.lesson.estimated_minutes, limits.lessonMinutes),
          source_refs: sourceRefsOf(ref.lesson.concept_ids, lifted.nodes, sourceIds),
          origin: ref.lesson.origin,
        }
        lessons.push(lesson)
        flatLessons.push(lesson)
      }
      lessonsByModule.push(lessons)
    }
  }

  const warmups = assignWarmups(
    flatLessons,
    lifted.nodes,
    graph.edges,
    limits.warmup,
    DEFAULT_IMPORTANCE_THRESHOLD,
  )
  for (const [index, lesson] of flatLessons.entries()) {
    lesson.warmup_concept_ids = warmups[index] as string[]
  }

  const homeIndex = new Map<string, number>()
  for (const [index, lesson] of flatLessons.entries()) {
    for (const id of lesson.concept_ids) homeIndex.set(id, index)
  }

  // Modules, with their reinforcement nodes.
  const modules: ModuleNode[] = []
  const sections: SectionNode[] = []
  const earlierPool: string[] = []
  let moduleIndex = 0
  for (const [s, section] of layout.sections.entries()) {
    const built: ModuleNode[] = []
    for (const sized of section.modules) {
      const id = numbered.moduleIds[moduleIndex] as string
      const lessons = lessonsByModule[moduleIndex] as CoreLessonNode[]
      const conceptIds = lessons.flatMap((lesson) => lesson.concept_ids)
      const reinforcement = buildReinforcement({
        moduleId: id,
        ownConceptIds: conceptIds,
        earlierPool,
        nodes: lifted.nodes,
        homeIndex,
        limits,
        seed: options.seed,
      })
      const module: ModuleNode = {
        id,
        title: sized.title,
        objectives: sized.objectives.map((objective) => ({ ...objective })),
        concept_ids: conceptIds,
        lessons,
        reinforcement,
        checkpoint: null,
        estimated_minutes:
          lessons.reduce((sum, lesson) => sum + lesson.estimated_minutes, 0) +
          reinforcement.estimated_minutes,
      }
      built.push(module)
      modules.push(module)
      earlierPool.push(...conceptIds)
      moduleIndex += 1
    }
    sections.push({
      id: numbered.sectionIds[s] as string,
      title: sectionTitle(validated, section.s),
      modules: built,
    })
  }

  for (const placement of buildCheckpoints(modules, limits)) {
    const module = modules[placement.moduleIndex] as ModuleNode
    module.checkpoint = placement.node
    module.estimated_minutes += placement.node.estimated_minutes
  }

  const finalExam = buildFinalExam(modules, lifted.nodes, coverageOf, limits)

  const minutes =
    modules.reduce((sum, module) => sum + module.estimated_minutes, 0) + finalExam.estimated_minutes
  const weeks = weeksEstimate(minutes, config.paceHoursPerWeek)
  if (config.forExam !== null && weeks !== null) {
    const available = weeksAvailable(options.now, config.forExam.date)
    if (available !== null && weeks > available) {
      warnings.push(
        warning('exam_date_overshoot', {
          weeks_estimate: weeks,
          weeks_available: available,
          target_date: config.forExam.date,
        }),
      )
    }
  }

  return {
    draft: {
      sections,
      final_exam: finalExam,
      stats: {
        sections: sections.length,
        modules: modules.length,
        lessons: flatLessons.length,
        checkpoints: modules.filter((module) => module.checkpoint !== null).length,
        concepts: homeIndex.size,
        minutes,
        weeks_estimate: weeks,
      },
      warnings,
    },
    graph,
  }
}

function sectionTitle(validated: ValidatedSynthesis, s: number): string {
  return (validated.outline.sections[s] as SectionSpec).title
}
