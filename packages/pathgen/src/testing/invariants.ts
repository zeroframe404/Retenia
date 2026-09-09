import type { CoreLessonNode, SequencedPath } from '../sequencing/types'
import type { ConceptEdge } from '../validate/types'

/**
 * Test-side checkers, written from the rule statements rather than by calling the code
 * under test — the "honest report" pattern of `packages/core/src/sessions/properties.test.ts`.
 * Kept out of `src/sequencing` so production carries no unreachable "invariant violated"
 * branch and the coverage gate stays honest.
 */

export function flattenLessons(draft: SequencedPath): CoreLessonNode[] {
  return draft.sections.flatMap((section) => section.modules.flatMap((module) => module.lessons))
}

/** Concept id → index of the core lesson that teaches it. */
export function homeIndexOf(lessons: readonly CoreLessonNode[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [index, lesson] of lessons.entries()) {
    for (const id of lesson.concept_ids) out.set(id, index)
  }
  return out
}

/** Prerequisite edges whose `to` is taught before their `from`. */
export function violatedEdges(
  edges: readonly ConceptEdge[],
  homes: ReadonlyMap<string, number>,
): ConceptEdge[] {
  return edges.filter((edge) => {
    if (edge.kind !== 'PREREQ_OF') return false
    const from = homes.get(edge.from)
    const to = homes.get(edge.to)
    return from !== undefined && to !== undefined && from > to
  })
}

function successorsOf(edges: readonly ConceptEdge[]): Map<string, string[]> {
  const successors = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== 'PREREQ_OF') continue
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to])
  }
  return successors
}

/** Whether the `PREREQ_OF` subgraph has no cycle, by plain depth-first search. */
export function isAcyclic(edges: readonly ConceptEdge[]): boolean {
  const successors = successorsOf(edges)
  const state = new Map<string, 'open' | 'done'>()
  const visit = (node: string): boolean => {
    const seen = state.get(node)
    if (seen === 'open') return false
    if (seen === 'done') return true
    state.set(node, 'open')
    for (const next of successors.get(node) ?? []) {
      if (!visit(next)) return false
    }
    state.set(node, 'done')
    return true
  }
  for (const node of successors.keys()) {
    if (!visit(node)) return false
  }
  return true
}

/** Whether `to` can be reached from `from` along `PREREQ_OF` edges, by breadth-first search. */
export function reachable(edges: readonly ConceptEdge[], from: string, to: string): boolean {
  const successors = successorsOf(edges)
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length > 0) {
    const node = queue.shift() as string
    if (node === to) return true
    for (const next of successors.get(node) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return false
}
