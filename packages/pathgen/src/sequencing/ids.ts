import { compareNumbers, compareStrings, sortedBy, sourceRank } from '../graph/order'
import type { ConceptNode, SourceRef } from '../validate/types'
import type { LiftedEdge } from './lift'
import type { SizedLayout } from './module-size'

/**
 * Positional ids, assigned only once the order is final — `S01`, `M01`, `L01` numbered
 * across the whole path, as `sections.spec_id`, `modules.spec_id` and `lessons.spec_id`
 * expect them (`docs/spec/07a-schema.md`). Ids are positions; concept ids are the stable
 * identity a regeneration migrates progress by (`docs/spec/04-path-generation.md` §7).
 */

export function positional(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(2, '0')}`
}

export interface Numbered {
  /** Outline lesson id (`s.m.l`) → final id (`L07`). */
  readonly lessonIds: ReadonlyMap<string, string>
  readonly sectionIds: string[]
  /** Module ids in final order, one per module of `layout`. */
  readonly moduleIds: string[]
}

export function assignIds(layout: SizedLayout): Numbered {
  const lessonIds = new Map<string, string>()
  const sectionIds: string[] = []
  const moduleIds: string[] = []
  let lessonCount = 0
  let moduleCount = 0
  for (const [s, section] of layout.sections.entries()) {
    sectionIds.push(positional('S', s))
    for (const module of section.modules) {
      moduleIds.push(positional('M', moduleCount))
      moduleCount += 1
      for (const lesson of module.lessons) {
        lessonIds.set(lesson.id, positional('L', lessonCount))
        lessonCount += 1
      }
    }
  }
  return { lessonIds, sectionIds, moduleIds }
}

/** The final ids of a lesson's direct prerequisites, sorted and unique. */
export function prerequisitesOf(
  lessonId: string,
  edges: readonly LiftedEdge[],
  lessonIds: ReadonlyMap<string, string>,
): string[] {
  const ids = new Set<string>()
  for (const edge of edges) {
    if (edge.to !== lessonId) continue
    const id = lessonIds.get(edge.from)
    if (id !== undefined) ids.add(id)
  }
  return [...ids].sort(compareStrings)
}

/** Every source ref of a lesson's concepts, one per chunk, in book order. */
export function sourceRefsOf(
  conceptIds: readonly string[],
  nodes: ReadonlyMap<string, ConceptNode>,
  sourceIds: readonly string[],
): SourceRef[] {
  const byChunk = new Map<string, SourceRef>()
  for (const conceptId of conceptIds) {
    for (const ref of nodes.get(conceptId)?.source_refs ?? []) {
      if (!byChunk.has(ref.chunk_id)) byChunk.set(ref.chunk_id, ref)
    }
  }
  return sortedBy(
    [...byChunk.values()],
    (a, b) =>
      compareNumbers(sourceRank(a.source_id, sourceIds), sourceRank(b.source_id, sourceIds)) ||
      compareNumbers(a.ordinal, b.ordinal) ||
      compareStrings(a.chunk_id, b.chunk_id),
  ).map((ref) => ({ ...ref, block_ids: [...ref.block_ids] }))
}
