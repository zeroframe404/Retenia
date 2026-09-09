import { splitEvenly } from '../validate/lessons'
import { positional } from './ids'
import type { CheckpointNode, SequencingLimits } from './types'

/**
 * Cumulative checkpoints — `docs/spec/04-path-generation.md` §3 stage 5: "every 3–4 modules a
 * cumulative reinforcement".
 *
 * The modules are cut into even spans of 3–4 wherever that is possible. Five modules are the
 * one count that cannot be: rather than a span of five, the checkpoint sits after the fourth
 * module and the fifth goes without — its reinforcement and the final exam follow it anyway.
 * A path of fewer than three modules has no checkpoint at all.
 */
export function checkpointSpans(
  moduleCount: number,
  limits: SequencingLimits['checkpoint'],
): number[] {
  if (moduleCount < limits.spanMin) return []
  let groups = Math.ceil(moduleCount / limits.spanMax)
  while (groups > 1 && Math.floor(moduleCount / groups) < limits.spanMin) groups -= 1
  const spans = splitEvenly(
    Array.from({ length: moduleCount }, (_, index) => index),
    groups,
  ).map((span) => span.length)
  // Only one group can be over the ceiling, and only when it is the only group.
  return spans.map((span) => Math.min(span, limits.spanMax))
}

export interface CheckpointPlacement {
  /** Index of the module the checkpoint sits after. */
  readonly moduleIndex: number
  readonly node: CheckpointNode
}

export function buildCheckpoints(
  modules: ReadonlyArray<{ readonly id: string; readonly concept_ids: readonly string[] }>,
  limits: SequencingLimits,
): CheckpointPlacement[] {
  const { checkpoint, minutesPerItem } = limits
  const placements: CheckpointPlacement[] = []
  let start = 0
  for (const [index, span] of checkpointSpans(modules.length, checkpoint).entries()) {
    const covered = modules.slice(start, start + span)
    const itemCount = Math.min(
      checkpoint.maxItems,
      Math.max(checkpoint.minItems, checkpoint.itemsPerModule * span),
    )
    placements.push({
      moduleIndex: start + span - 1,
      node: {
        id: positional('C', index),
        kind: 'checkpoint',
        module_ids: covered.map((module) => module.id),
        concept_ids: covered.flatMap((module) => [...module.concept_ids]),
        item_count: itemCount,
        estimated_minutes: Math.ceil(itemCount * minutesPerItem.checkpoint),
      },
    })
    start += span
  }
  return placements
}
