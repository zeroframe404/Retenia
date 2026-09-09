import type { ConceptNode } from '../validate/types'
import type { FinalExamNode, SequencingLimits } from './types'

/**
 * The final exam by blueprint — `docs/spec/04-path-generation.md` §3 stage 5. Each module's
 * weight is its total importance times how much of it the lessons cover (`coverageOf` is 1
 * until sub-phase 8.4's coverage gate measures it), normalised and rounded to hundredths by
 * largest remainder so the weights sum to exactly one and the item bank of 8.5 can allocate
 * items without a rounding hole.
 */
export function buildFinalExam(
  modules: ReadonlyArray<{ readonly id: string; readonly concept_ids: readonly string[] }>,
  nodes: ReadonlyMap<string, ConceptNode>,
  coverageOf: (moduleId: string) => number,
  limits: SequencingLimits,
): FinalExamNode {
  const raw = modules.map((module) => {
    const importance = module.concept_ids.reduce(
      (sum, id) => sum + (nodes.get(id)?.importance ?? 0),
      0,
    )
    return Math.min(1, Math.max(0, coverageOf(module.id))) * importance
  })
  const total = raw.reduce((sum, value) => sum + value, 0)
  // Nothing to weigh by: every module counts the same.
  const shares = total > 0 ? raw.map((value) => value / total) : raw.map(() => 1 / raw.length)

  const units = shares.map((share) => Math.floor(share * 100))
  let left = 100 - units.reduce((sum, value) => sum + value, 0)
  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share * 100 - (units[index] as number) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const entry of byRemainder) {
    if (left <= 0) break
    units[entry.index] = (units[entry.index] as number) + 1
    left -= 1
  }

  const itemCount =
    modules.length === 0
      ? 0
      : Math.min(
          limits.exam.maxItems,
          Math.max(limits.exam.minItems, limits.exam.itemsPerModule * modules.length),
        )

  return {
    id: 'FINAL',
    kind: 'final_exam',
    blueprint: {
      topics: modules.map((module, index) => ({
        module_id: module.id,
        weight: (units[index] as number) / 100,
      })),
      item_count: itemCount,
    },
    estimated_minutes: Math.ceil(itemCount * limits.minutesPerItem.exam),
  }
}
