import {
  compareNumbers,
  comparePrimary,
  compareStrings,
  minPrimary,
  type PrimaryKey,
  sourceRank,
} from '../graph/order'
import type { ConceptNode } from './types'

/**
 * Where a concept sits in the book: the earliest of its source refs, primary source first,
 * with the concept id as the final tie-break so the order is total.
 *
 * This is the "order in the primary source" of `docs/spec/04-path-generation.md` §3 stage
 * 5, and the reason a concept that only appears in a secondary source, or in no source at
 * all, sorts after everything the primary source introduces.
 */
export type ConceptKey = readonly [rank: number, ordinal: number, conceptId: string]

export function primaryKeyOf(
  node: Pick<ConceptNode, 'source_refs'>,
  sourceIds: readonly string[],
): PrimaryKey {
  return minPrimary(
    node.source_refs.map((ref): PrimaryKey => [sourceRank(ref.source_id, sourceIds), ref.ordinal]),
  )
}

export function conceptKey(
  node: Pick<ConceptNode, 'concept_id' | 'source_refs'>,
  sourceIds: readonly string[],
): ConceptKey {
  const [rank, ordinal] = primaryKeyOf(node, sourceIds)
  return [rank, ordinal, node.concept_id]
}

export function compareConceptKey(a: ConceptKey, b: ConceptKey): number {
  return (
    comparePrimary([a[0], a[1]], [b[0], b[1]]) || compareNumbers(0, 0) || compareStrings(a[2], b[2])
  )
}
