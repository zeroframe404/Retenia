import { compareStrings, minPrimary, type PrimaryKey } from '../graph/order'
import { primaryKeyOf } from '../validate/keys'
import type { ConceptEdge, ConceptNode, LessonSpec, ValidatedSynthesis } from '../validate/types'

/**
 * The prerequisite relation, lifted from concepts to the lessons that home them.
 *
 * A lesson A must come before a lesson B when some concept of A is `PREREQ_OF` some concept
 * of B. Everything the hierarchy sort needs is computed once here: where each lesson sits in
 * the book (its *anchor*), how important it is, and the lifted edges with the concept edges
 * that produced them — so that breaking a lifted edge can name, and remove, exactly the
 * concept edges behind it.
 */

/** A lesson's place in the validated outline: section, module and lesson indices. */
export interface LessonKey {
  readonly s: number
  readonly m: number
  readonly l: number
}

export function keyOf(key: LessonKey): string {
  return `${key.s}.${key.m}.${key.l}`
}

export interface LessonRef {
  readonly key: LessonKey
  readonly id: string
  readonly lesson: LessonSpec
  /**
   * The earliest position of any of its concepts, without the concept id: two lessons whose
   * first concepts share a chunk tie here, so that importance gets to decide between them.
   */
  readonly anchor: PrimaryKey
  /** The highest importance among its concepts. */
  readonly importance: number
  /** Position in the flattened outline, the last tie-break. */
  readonly outlineIndex: number
}

export interface LiftedEdge {
  readonly from: string
  readonly to: string
  /** The strongest concept edge behind it. */
  readonly confidence: number
  readonly via: ConceptEdge[]
}

export interface Lifted {
  /** Every lesson, keyed by `keyOf(key)`, in outline order. */
  readonly lessons: LessonRef[]
  readonly byId: ReadonlyMap<string, LessonRef>
  /** Concept id → the id of the lesson that homes it. */
  readonly homeOf: ReadonlyMap<string, string>
  readonly nodes: ReadonlyMap<string, ConceptNode>
  /** `PREREQ_OF` edges between different lessons, one per (from, to). */
  readonly edges: LiftedEdge[]
}

export function liftGraph(validated: ValidatedSynthesis, sourceIds: readonly string[]): Lifted {
  const nodes = new Map(validated.graph.nodes.map((node) => [node.concept_id, node]))
  const lessons: LessonRef[] = []
  const byId = new Map<string, LessonRef>()
  const homeOf = new Map<string, string>()

  let outlineIndex = 0
  for (const [s, section] of validated.outline.sections.entries()) {
    for (const [m, module] of section.modules.entries()) {
      for (const [l, lesson] of module.lesson_specs.entries()) {
        const key = { s, m, l }
        const id = keyOf(key)
        const positions: PrimaryKey[] = []
        let importance = 0
        for (const conceptId of lesson.concept_ids) {
          const node = nodes.get(conceptId)
          if (node === undefined) continue
          positions.push(primaryKeyOf(node, sourceIds))
          importance = Math.max(importance, node.importance)
          homeOf.set(conceptId, id)
        }
        const ref: LessonRef = {
          key,
          id,
          lesson,
          anchor: minPrimary(positions),
          importance,
          outlineIndex,
        }
        lessons.push(ref)
        byId.set(id, ref)
        outlineIndex += 1
      }
    }
  }

  const merged = new Map<
    string,
    { from: string; to: string; confidence: number; via: ConceptEdge[] }
  >()
  for (const edge of validated.graph.edges) {
    if (edge.kind !== 'PREREQ_OF') continue
    const from = homeOf.get(edge.from)
    const to = homeOf.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    const key = `${from}>${to}`
    const existing = merged.get(key)
    if (existing === undefined) {
      merged.set(key, { from, to, confidence: edge.confidence, via: [edge] })
    } else {
      existing.confidence = Math.max(existing.confidence, edge.confidence)
      existing.via.push(edge)
    }
  }
  const edges = [...merged.values()].sort(
    (a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to),
  )

  return { lessons, byId, homeOf, nodes, edges }
}
