import { breakCycles } from '../graph/cycles'
import { chain, compareNumbers, comparePrimary, minPrimary, type PrimaryKey } from '../graph/order'
import { priorityTopologicalOrder } from '../graph/toposort'
import { type GenerationWarning, warning } from '../schemas/warnings'
import type { ConceptEdge, ModuleSpec, Outline, SectionSpec } from '../validate/types'
import type { LessonRef, Lifted, LiftedEdge } from './lift'

/**
 * The stable topological sort of `docs/spec/04-path-generation.md` §3 stage 5, done level by
 * level so that the model's grouping survives: sections are ordered among themselves, then
 * the modules inside each section, then the lessons inside each module. At every level the
 * prerequisite edges lifted to that level are made acyclic first — the weakest one goes —
 * and then Kahn's algorithm with the tie-break "earliest in the primary source, then most
 * important, then as the model listed it" decides among the unblocked items.
 *
 * Ordering the levels this way is what makes every surviving edge forward *by construction*:
 * an edge between two sections is honoured by the section order, one inside a section by
 * the module order, and so on down. Nothing is moved between modules; a lesson stays where
 * the model put it, and a dependency that cannot be honoured without moving it is dropped
 * with a warning that says which one, so the editable preview can show it.
 */

export interface OrderedModule {
  readonly s: number
  readonly m: number
  readonly lessons: LessonRef[]
}

export interface OrderedSection {
  readonly s: number
  readonly modules: OrderedModule[]
}

export interface Hierarchy {
  readonly sections: OrderedSection[]
  /** The lifted edges that survived, for `prerequisite_lesson_ids`. */
  readonly edges: LiftedEdge[]
  /** The concept edges behind every lifted edge that had to go, so the output graph agrees. */
  readonly removedConceptEdges: ConceptEdge[]
  readonly warnings: GenerationWarning[]
}

interface LevelEdge {
  readonly from: string
  readonly to: string
  readonly confidence: number
  readonly via: LiftedEdge[]
}

/** Lifted edges between two groups of lessons, merged per pair of groups. */
function groupEdges(
  edges: readonly LiftedEdge[],
  groupOf: (lessonId: string) => string,
  within: (lessonId: string) => boolean,
): LevelEdge[] {
  const merged = new Map<
    string,
    { from: string; to: string; confidence: number; via: LiftedEdge[] }
  >()
  for (const edge of edges) {
    if (!within(edge.from) || !within(edge.to)) continue
    const from = groupOf(edge.from)
    const to = groupOf(edge.to)
    if (from === to) continue
    const key = `${from}>${to}`
    const existing = merged.get(key)
    if (existing === undefined) {
      merged.set(key, { from, to, confidence: edge.confidence, via: [edge] })
    } else {
      existing.confidence = Math.max(existing.confidence, edge.confidence)
      existing.via.push(edge)
    }
  }
  return [...merged.values()]
}

/** How many concept edges a broken level edge takes with it — what the warnings report. */
function conceptEdgeCount(level: LevelEdge): number {
  return level.via.reduce((sum, edge) => sum + edge.via.length, 0)
}

/** The strongest concept edge behind a lifted edge, for the warning that names it. */
function strongestVia(edge: LiftedEdge): ConceptEdge {
  return edge.via.reduce((best, entry) => (entry.confidence > best.confidence ? entry : best))
}

export function orderHierarchy(lifted: Lifted, outline: Outline): Hierarchy {
  const warnings: GenerationWarning[] = []
  const removedConceptEdges: ConceptEdge[] = []
  let edges = [...lifted.edges]

  // Every lifted lesson came out of a section and a module of this outline.
  const sectionTitle = (s: number): string => (outline.sections[s] as SectionSpec).title
  const moduleTitle = (s: number, m: number): string =>
    ((outline.sections[s] as SectionSpec).modules[m] as ModuleSpec).title
  const lessonOf = (id: string): LessonRef => lifted.byId.get(id) as LessonRef

  /** Drops the lifted edges behind a broken level edge, and records their concept edges. */
  const dropVia = (level: LevelEdge): void => {
    const gone = new Set(level.via)
    edges = edges.filter((edge) => !gone.has(edge))
    for (const edge of level.via) removedConceptEdges.push(...edge.via)
  }

  const anchorOf = (lessons: readonly LessonRef[]): PrimaryKey =>
    minPrimary(lessons.map((lesson) => lesson.anchor))
  const firstOutlineIndex = (lessons: readonly LessonRef[]): number =>
    Math.min(...lessons.map((lesson) => lesson.outlineIndex))
  const maxImportance = (lessons: readonly LessonRef[]): number =>
    Math.max(...lessons.map((lesson) => lesson.importance))

  // --- sections -------------------------------------------------------------------------
  const sectionIds = [...new Set(lifted.lessons.map((lesson) => lesson.key.s))]
  const lessonsOfSection = (s: number): LessonRef[] =>
    lifted.lessons.filter((lesson) => lesson.key.s === s)

  const sectionEdges = groupEdges(
    edges,
    (id) => String(lessonOf(id).key.s),
    () => true,
  )
  const brokenSections = breakCycles(sectionEdges)
  for (const level of brokenSections.removed) {
    dropVia(level)
    warnings.push(
      warning('section_cycle_broken', {
        from: sectionTitle(Number(level.from)),
        to: sectionTitle(Number(level.to)),
        edges: conceptEdgeCount(level),
        confidence: level.confidence,
      }),
    )
  }
  const sectionOrder = priorityTopologicalOrder(
    sectionIds,
    brokenSections.kept.map((edge) => [Number(edge.from), Number(edge.to)] as const),
    chain<number>(
      (a, b) => comparePrimary(anchorOf(lessonsOfSection(a)), anchorOf(lessonsOfSection(b))),
      (a, b) =>
        compareNumbers(maxImportance(lessonsOfSection(b)), maxImportance(lessonsOfSection(a))),
      (a, b) => compareNumbers(a, b),
    ),
  )
  reportReordered('section', sectionOrder, sectionTitle, warnings)

  // --- modules within each section ------------------------------------------------------
  const sections: OrderedSection[] = []
  for (const s of sectionOrder) {
    const inSection = lessonsOfSection(s)
    const moduleIds = [...new Set(inSection.map((lesson) => lesson.key.m))]
    const lessonsOfModule = (m: number): LessonRef[] =>
      inSection.filter((lesson) => lesson.key.m === m)

    const moduleEdges = groupEdges(
      edges,
      (id) => String(lessonOf(id).key.m),
      (id) => lessonOf(id).key.s === s,
    )
    const brokenModules = breakCycles(moduleEdges)
    for (const level of brokenModules.removed) {
      dropVia(level)
      warnings.push(
        warning('module_cycle_broken', {
          from: moduleTitle(s, Number(level.from)),
          to: moduleTitle(s, Number(level.to)),
          edges: conceptEdgeCount(level),
          confidence: level.confidence,
        }),
      )
    }
    const moduleOrder = priorityTopologicalOrder(
      moduleIds,
      brokenModules.kept.map((edge) => [Number(edge.from), Number(edge.to)] as const),
      chain<number>(
        (a, b) => comparePrimary(anchorOf(lessonsOfModule(a)), anchorOf(lessonsOfModule(b))),
        (a, b) =>
          compareNumbers(maxImportance(lessonsOfModule(b)), maxImportance(lessonsOfModule(a))),
        (a, b) =>
          compareNumbers(
            firstOutlineIndex(lessonsOfModule(a)),
            firstOutlineIndex(lessonsOfModule(b)),
          ),
      ),
    )
    reportReordered('module', moduleOrder, (m) => moduleTitle(s, m), warnings)

    // --- lessons within each module -----------------------------------------------------
    const modules: OrderedModule[] = []
    for (const m of moduleOrder) {
      const inModule = lessonsOfModule(m)
      const lessonEdges = groupEdges(
        edges,
        (id) => id,
        (id) => lessonOf(id).key.s === s && lessonOf(id).key.m === m,
      )
      const brokenLessons = breakCycles(lessonEdges)
      for (const level of brokenLessons.removed) {
        dropVia(level)
        const named = strongestVia(level.via[0] as LiftedEdge)
        warnings.push(
          warning('lesson_cycle_broken', {
            from: lessonOf(level.from).lesson.title,
            to: lessonOf(level.to).lesson.title,
            concept_from: named.from,
            concept_to: named.to,
            confidence: level.confidence,
            edges: conceptEdgeCount(level),
          }),
        )
      }
      const lessonOrder = priorityTopologicalOrder(
        inModule.map((lesson) => lesson.id),
        brokenLessons.kept.map((edge) => [edge.from, edge.to] as const),
        chain<string>(
          (a, b) => comparePrimary(lessonOf(a).anchor, lessonOf(b).anchor),
          (a, b) => compareNumbers(lessonOf(b).importance, lessonOf(a).importance),
          (a, b) => compareNumbers(lessonOf(a).outlineIndex, lessonOf(b).outlineIndex),
        ),
      )
      modules.push({ s, m, lessons: lessonOrder.map(lessonOf) })
    }
    sections.push({ s, modules })
  }

  return { sections, edges, removedConceptEdges, warnings }
}

/** One warning per item that ended up ahead of something the model had listed before it. */
function reportReordered(
  level: 'section' | 'module',
  order: readonly number[],
  titleOf: (index: number) => string,
  warnings: GenerationWarning[],
): void {
  for (const [position, index] of order.entries()) {
    const jumped = order.slice(position + 1).some((later) => later < index)
    if (!jumped) continue
    warnings.push(
      warning('narrative_reordered', {
        level,
        title: titleOf(index),
        outline_index: index,
        final_index: position,
      }),
    )
  }
}
