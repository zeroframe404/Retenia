import { compareNumbers } from '../graph/order'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { type ConceptKey, compareConceptKey, conceptKey } from './keys'
import { fitLessonSizes, highestBloom, resolveLimits, splitEvenly } from './lessons'
import {
  DEFAULT_IMPORTANCE_THRESHOLD,
  type KnowledgeGraph,
  type LessonSpec,
  type ModuleSpec,
  type SectionSpec,
  type ValidationContext,
} from './types'

/**
 * Gate 6 of the validation pass — QA gate 4 of `docs/spec/04-path-generation.md` §5:
 * "concepts with importance ≥ 0.5 must be covered".
 *
 * An important concept no lesson teaches gets a catch-up lesson in the section where the
 * book introduces it — the section of the nearest concept that *is* taught and comes at or
 * before it in reading order — appended to that section's last module with lessons, in
 * groups of at most one lesson's worth, titled after the concepts themselves. The module is
 * then put through the same size fitting as gate 5, so a one-concept catch-up lesson merges
 * into, or borrows from, its neighbour exactly as a model's would, and a second validation
 * pass has nothing left to change. The preview labels these lessons (`origin: 'catch_up'`)
 * and the lesson writer of sub-phase 8.3 gives them real objectives.
 */

const MAX_TITLE_CHARS = 80

function titleFrom(canonicals: readonly string[]): string {
  const title = canonicals.join(' · ')
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…` : title
}

interface MutableSection {
  title: string
  modules: ModuleSpec[]
}

export function fillCoverageGaps(
  sections: readonly SectionSpec[],
  graph: KnowledgeGraph,
  ctx: ValidationContext,
): { sections: SectionSpec[]; warnings: GenerationWarning[] } {
  const threshold = ctx.importanceThreshold ?? DEFAULT_IMPORTANCE_THRESHOLD
  const { max } = resolveLimits(ctx).conceptsPerLesson
  const warnings: GenerationWarning[] = []

  const keys = new Map(
    graph.nodes.map((node) => [node.concept_id, conceptKey(node, ctx.sourceIds)]),
  )
  const canonical = new Map(graph.nodes.map((node) => [node.concept_id, node.canonical]))
  const compare = (a: string, b: string): number =>
    compareConceptKey(keys.get(a) as ConceptKey, keys.get(b) as ConceptKey)

  const homeSection = new Map<string, number>()
  for (const [s, section] of sections.entries()) {
    for (const module of section.modules) {
      for (const lesson of module.lesson_specs) {
        for (const id of lesson.concept_ids) homeSection.set(id, s)
      }
    }
  }

  const uncovered = graph.nodes
    .filter((node) => node.importance >= threshold && !homeSection.has(node.concept_id))
    .map((node) => node.concept_id)
    .sort(compare)
  if (uncovered.length === 0) return { sections: [...sections], warnings }

  // The nearest taught concept at or before each gap, in book order: a two-pointer walk over
  // the two sorted lists.
  const homed = [...homeSection.keys()].sort(compare)
  const byTarget = new Map<number, string[]>()
  let cursor = 0
  for (const id of uncovered) {
    while (cursor < homed.length && compare(homed[cursor] as string, id) <= 0) cursor += 1
    const before = homed[cursor - 1]
    const target = before === undefined ? 0 : (homeSection.get(before) as number)
    const list = byTarget.get(target) ?? []
    list.push(id)
    byTarget.set(target, list)
  }

  const out: MutableSection[] = sections.map((section) => ({
    title: section.title,
    modules: section.modules.map((module) => ({
      title: module.title,
      objectives: module.objectives,
      lesson_specs: [...module.lesson_specs],
    })),
  }))
  // An outline with no sections at all still gets its gaps homed somewhere.
  if (out.length === 0) out.push({ title: '', modules: [] })

  for (const target of [...byTarget.keys()].sort(compareNumbers)) {
    const ids = byTarget.get(target) as string[]
    const section = out[Math.min(target, out.length - 1)] as MutableSection
    if (section.modules.length === 0) {
      section.modules.push({ title: '', objectives: [], lesson_specs: [] })
    }
    // The last module that still has lessons: a module the model left empty is dropped by the
    // structure gate, and a catch-up lesson must not be what keeps it alive.
    let at = section.modules.length - 1
    for (let index = section.modules.length - 1; index >= 0; index -= 1) {
      if ((section.modules[index] as ModuleSpec).lesson_specs.length > 0) {
        at = index
        break
      }
    }
    const module = section.modules[at] as ModuleSpec
    const lessons: LessonSpec[] = [...module.lesson_specs]

    for (const group of splitEvenly(ids, Math.ceil(ids.length / max))) {
      const names = group.map((id) => canonical.get(id) as string)
      const lesson: LessonSpec = {
        title: titleFrom(names),
        concept_ids: group,
        objectives: [{ text: names.join(', '), bloom: highestBloom(graph, group) }],
        estimated_minutes: null,
        origin: 'catch_up',
      }
      lessons.push(lesson)
      warnings.push(warning('coverage_gap', { concept_ids: group, lesson: lesson.title }))
    }

    const fitted = fitLessonSizes(lessons, graph, ctx, warnings)
    section.modules[at] = {
      title: module.title === '' ? (fitted[0] as LessonSpec).title : module.title,
      objectives: module.objectives,
      lesson_specs: fitted,
    }
    if (section.title === '') section.title = (section.modules[at] as ModuleSpec).title
  }

  return { sections: out, warnings }
}
