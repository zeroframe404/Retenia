import { hashString, mulberry32, shuffleWithRng } from '@retenia/core'
import { chain, compareNumbers, compareStrings } from '../graph/order'
import type { ConceptNode } from '../validate/types'
import type { ReinforcementNode, SequencingLimits } from './types'

/**
 * The reinforcement node that closes every module — `docs/spec/04-path-generation.md` §3
 * stage 5: "module = 3–7 lessons + reinforcement (10–15 items, interleaving)"; §1.1
 * "reinforcements interleave previous lessons".
 *
 * The item count grows with the module's concepts inside the 10–15 band; about 30 % of the
 * concepts drawn on come from earlier modules — the most important ones first, chosen with a
 * shuffle seeded from the run's inputs, so the same book gives the same order on every device
 * (§7). The order of `concept_ids` is the order sub-phase 8.5's item generator draws in, and
 * the earlier concepts are spread evenly through it rather than shuffled in: an item generator
 * that takes the first `item_count` entries of a longer list still interleaves.
 */

/**
 * `earlier` spread evenly through `own`: the k-th earlier entry lands where the running share
 * of earlier entries would otherwise fall behind `earlier / total`, so every prefix long
 * enough to hold one of them holds one.
 */
export function interleaveEvenly(own: readonly string[], earlier: readonly string[]): string[] {
  const total = own.length + earlier.length
  const out: string[] = []
  let takenEarlier = 0
  let takenOwn = 0
  for (let position = 0; position < total; position += 1) {
    const due = Math.floor(((position + 1) * earlier.length) / total)
    if (takenEarlier < due || takenOwn >= own.length) {
      out.push(earlier[takenEarlier] as string)
      takenEarlier += 1
    } else {
      out.push(own[takenOwn] as string)
      takenOwn += 1
    }
  }
  return out
}
export function buildReinforcement(input: {
  readonly moduleId: string
  readonly ownConceptIds: readonly string[]
  /** Concepts of every earlier module, in lesson order. */
  readonly earlierPool: readonly string[]
  readonly nodes: ReadonlyMap<string, ConceptNode>
  readonly homeIndex: ReadonlyMap<string, number>
  readonly limits: SequencingLimits
  readonly seed: string
}): ReinforcementNode {
  const { reinforcement, minutesPerItem } = input.limits
  const own = input.ownConceptIds.length
  const itemCount = Math.min(
    reinforcement.maxItems,
    Math.max(reinforcement.minItems, Math.ceil(own * reinforcement.itemsPerConcept)),
  )

  const importanceOf = (id: string): number => input.nodes.get(id)?.importance ?? 0
  // A pool concept without a home is one the lessons never taught: it sorts last.
  const homeOf = (id: string): number => input.homeIndex.get(id) ?? Number.POSITIVE_INFINITY
  const ranked = [...input.earlierPool].sort(
    chain<string>(
      (a, b) => compareNumbers(importanceOf(b), importanceOf(a)),
      (a, b) => compareNumbers(homeOf(a), homeOf(b)),
      compareStrings,
    ),
  )
  const earlierCount = Math.min(Math.round(own * reinforcement.earlierRatio), ranked.length)
  const shortlist = ranked.slice(0, 2 * earlierCount)
  const earlier = shuffleWithRng(
    shortlist,
    mulberry32(hashString(`${input.seed}:${input.moduleId}:earlier`)),
  ).slice(0, earlierCount)

  const mixed = interleaveEvenly(
    shuffleWithRng(
      [...input.ownConceptIds],
      mulberry32(hashString(`${input.seed}:${input.moduleId}:mix`)),
    ),
    earlier,
  )

  return {
    id: `${input.moduleId}.reinf`,
    kind: 'reinforcement',
    module_id: input.moduleId,
    concept_ids: mixed,
    earlier_concept_ids: earlier,
    item_count: itemCount,
    estimated_minutes: Math.ceil(itemCount * minutesPerItem.reinforcement),
  }
}
