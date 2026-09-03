import type { Card, KnowledgeItem } from '../entities'
import { assertSchedulingOptions, DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import type { SchedulingOptions } from './types'

/**
 * Where a review's `SchedulingOptions` come from.
 *
 * Sub-phase 4.2 implements the real thing: the card's effective importance level
 * (`card.importanceOverride ?? item.importance`, `docs/spec/02-memory-system.md` §7 rule 1)
 * mapped through `importance_levels`, with an active exam's retention and cap winning over
 * it (§8). Until then every card gets the spec's defaults (`Normal`: 0.90, five years).
 */

export interface SchedulingPolicyInput {
  card: Card
  /** The card's knowledge item, when it still exists — the importance lives there. */
  item: KnowledgeItem | null
  now: Date
}

export interface SchedulingPolicy {
  optionsFor(input: SchedulingPolicyInput): SchedulingOptions | Promise<SchedulingOptions>
}

/** The stub: the same options for every card. */
export function createDefaultSchedulingPolicy(
  options: SchedulingOptions = DEFAULT_SCHEDULING_OPTIONS,
): SchedulingPolicy {
  const resolved = assertSchedulingOptions(options)
  return { optionsFor: () => resolved }
}
