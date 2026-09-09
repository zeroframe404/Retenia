import { compareNumbers } from '../graph/order'
import type { SynthesizeOutlineOutput } from '../schemas/outline'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { type ConceptKey, compareConceptKey, conceptKey } from '../validate/keys'
import type { ConceptNode, KnowledgeGraph, Objective } from '../validate/types'
import { DEFAULT_IMPORTANCE_THRESHOLD } from '../validate/types'

/**
 * The skeleton the module calls are asked about, made consistent with the validated graph
 * before any of them is made — so no module is asked to write lessons for a concept that
 * does not exist, or for one another module already owns, and every important concept has
 * a module to be written into.
 *
 * The same rules the lesson gates apply later, one level up: an unknown id is dropped, a
 * repeat keeps its first home, an empty module or section disappears, and an important
 * concept nobody claimed goes to the module whose concepts the book introduces just before
 * it. Running them here is what turns a coverage gap into a real lesson from the model
 * rather than a catch-up lesson from the code.
 */

export interface SkeletonModule {
  readonly sectionIndex: number
  readonly moduleIndex: number
  readonly title: string
  readonly objectives: Objective[]
  readonly conceptIds: string[]
}

export interface SkeletonSection {
  readonly title: string
  readonly modules: SkeletonModule[]
}

export interface Skeleton {
  readonly sections: SkeletonSection[]
  readonly warnings: GenerationWarning[]
}

export function fixSkeleton(
  proposed: SynthesizeOutlineOutput['sections'],
  graph: KnowledgeGraph,
  options: { readonly sourceIds: readonly string[]; readonly threshold?: number },
): Skeleton {
  const threshold = options.threshold ?? DEFAULT_IMPORTANCE_THRESHOLD
  const known = new Map<string, ConceptNode>(graph.nodes.map((node) => [node.concept_id, node]))
  const homed = new Map<string, SkeletonModule>()
  const warnings: GenerationWarning[] = []
  const sections: SkeletonSection[] = []

  proposed.forEach((section, sectionIndex) => {
    const modules: SkeletonModule[] = []
    section.modules.forEach((module, moduleIndex) => {
      const conceptIds: string[] = []
      for (const id of module.concept_ids) {
        if (!known.has(id)) {
          warnings.push(warning('unknown_concept', { concept_id: id, module: module.title }))
          continue
        }
        if (conceptIds.includes(id)) continue
        if (homed.has(id)) {
          warnings.push(warning('concept_repeated', { concept_id: id, module: module.title }))
          continue
        }
        conceptIds.push(id)
      }
      if (conceptIds.length === 0) {
        warnings.push(warning('module_empty', { module: module.title }))
        return
      }
      const entry: SkeletonModule = {
        sectionIndex,
        moduleIndex,
        title: module.title,
        objectives: module.objectives.map((objective) => ({ ...objective })),
        conceptIds,
      }
      for (const id of conceptIds) homed.set(id, entry)
      modules.push(entry)
    })
    if (modules.length === 0) {
      warnings.push(warning('section_empty', { section: section.title }))
      return
    }
    sections.push({ title: section.title, modules })
  })

  const modules = sections.flatMap((section) => section.modules)
  if (modules.length === 0) return { sections, warnings }

  // Coverage: every important concept nobody claimed goes to the module whose earliest
  // concept the book introduces last before it — the module a reader would be in.
  const keyOf = (id: string): ConceptKey =>
    conceptKey(known.get(id) as ConceptNode, options.sourceIds)
  const anchored = modules
    .map((module, index) => ({
      module,
      index,
      anchor: module.conceptIds.map(keyOf).sort(compareConceptKey)[0] as ConceptKey,
    }))
    .sort((a, b) => compareConceptKey(a.anchor, b.anchor) || compareNumbers(a.index, b.index))

  const gaps = graph.nodes
    .filter((node) => node.importance >= threshold && !homed.has(node.concept_id))
    .map((node) => ({ node, key: conceptKey(node, options.sourceIds) }))
    .sort((a, b) => compareConceptKey(a.key, b.key))

  const assigned = new Map<SkeletonModule, string[]>()
  for (const gap of gaps) {
    let home = (anchored[0] as (typeof anchored)[number]).module
    for (const candidate of anchored) {
      if (compareConceptKey(candidate.anchor, gap.key) <= 0) home = candidate.module
      else break
    }
    home.conceptIds.push(gap.node.concept_id)
    homed.set(gap.node.concept_id, home)
    const list = assigned.get(home) ?? []
    list.push(gap.node.concept_id)
    assigned.set(home, list)
  }
  for (const module of modules) {
    const ids = assigned.get(module)
    if (ids !== undefined) {
      warnings.push(warning('coverage_gap', { concept_ids: ids, module: module.title }))
    }
  }

  return { sections, warnings }
}
