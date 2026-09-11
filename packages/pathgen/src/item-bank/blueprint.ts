import type { BloomLevel, ExamForm, ItemAuthorCell } from '@retenia/core'
import { BLOOM_LEVELS } from '@retenia/core'

/**
 * The blueprint of stage 9 (`docs/spec/04-path-generation.md` §3 stage 9, §8;
 * `docs/spec/02-memory-system.md` §9 "Simulacros"): topic × Bloom level × difficulty, with the
 * difficulty split **30/50/20** (easy/medium/hard).
 *
 * Topics are the modules, weighted as sequencing already weighted them for the final exam —
 * the module's total concept importance times how much of it the lessons cover
 * (`sequencing/exam.ts`) — so the bank and the draft's final-exam node can never disagree.
 * The shape is the one `exams.blueprint` stores, so 10.2's mock-exam editor can take it over.
 *
 * Every cell is one P9 call. Three kinds:
 * - `diagnostic` — per module, a core cell at the module's entry Bloom level (difficulty
 *   2, 3, 3) and an `apply` cell (difficulty 4): §10 step 6 lets one confident correct apply
 *   item confirm "known", so every module must have one to offer.
 * - `reinforcement` — per module, three items (2, 3, 4) at the module's working level, also
 *   usable by a remediation.
 * - `exam` — the final exam's items, parallel forms A and B per cell (§9: "the mock exam uses
 *   A, the final exam B").
 *
 * Pure and total: the same input gives the same cells in the same order.
 *
 * Two things this deliberately does not do:
 * - **measure coverage.** The weight is "importance × coverage", and sequencing still passes
 *   coverage as 1 (`sequencing/exam.ts`'s `coverageOf`) — so at freeze a topic weighs its
 *   concepts' total importance. When coverage is measured, the draft's weights carry it here
 *   unchanged.
 * - **persist the blueprint.** It is rebuilt from the frozen draft whenever it is needed
 *   (its hash is part of nothing a user can edit); the mock-exam editor of 10.2 stores the
 *   user's edited copy in `exams.blueprint`, which is the one place edits live.
 */

export const BLUEPRINT_VERSION = 1

export const DIFFICULTY_BANDS = ['easy', 'medium', 'hard'] as const
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number]

/** §9 "Simulacros": 30/50/20. */
export const DIFFICULTY_MIX: Readonly<Record<DifficultyBand, number>> = Object.freeze({
  easy: 0.3,
  medium: 0.5,
  hard: 0.2,
})

/** The 1–5 difficulty an item of each band is asked at. */
export const BAND_DIFFICULTY: Readonly<Record<DifficultyBand, number>> = Object.freeze({
  easy: 2,
  medium: 3,
  hard: 4,
})

export const DIAGNOSTIC_CORE_DIFFICULTIES: readonly number[] = Object.freeze([2, 3, 3])
export const DIAGNOSTIC_APPLY_DIFFICULTIES: readonly number[] = Object.freeze([4])
export const REINFORCEMENT_DIFFICULTIES: readonly number[] = Object.freeze([2, 3, 4])
export const PARALLEL_FORMS: readonly ExamForm[] = Object.freeze(['A', 'B'])

const BLOOM_RANK = new Map(BLOOM_LEVELS.map((level, index) => [level, index]))
const APPLY_RANK = BLOOM_RANK.get('apply') as number

export interface BlueprintModule {
  /** The draft's module id (`M03`). */
  readonly id: string
  readonly objectiveBlooms: readonly BloomLevel[]
  /** Fallback when the module lists no objectives: its concepts' `bloom_target`. */
  readonly conceptBlooms: readonly BloomLevel[]
}

export interface BlueprintInput {
  readonly modules: readonly BlueprintModule[]
  /** The draft's `final_exam.blueprint.topics`. A module missing from it weighs 0. */
  readonly topics: readonly { readonly module_id: string; readonly weight: number }[]
  /** The draft's `final_exam.blueprint.item_count` — per form. */
  readonly examItemCount: number
}

export interface BlueprintTopic {
  readonly module_id: string
  readonly weight: number
  /** Share of the module's objectives at each Bloom level. */
  readonly bloom_mix: Readonly<Partial<Record<BloomLevel, number>>>
  readonly difficulty_mix: Readonly<Record<DifficultyBand, number>>
  /** Exam items of this topic, per form. */
  readonly exam_items: number
}

export interface BlueprintCell extends ItemAuthorCell {
  readonly moduleId: string
  /** The difficulty band of an exam cell; `null` for the others. */
  readonly band: DifficultyBand | null
}

export interface Blueprint {
  readonly version: typeof BLUEPRINT_VERSION
  readonly difficulty_mix: Readonly<Record<DifficultyBand, number>>
  readonly exam_item_count: number
  readonly topics: readonly BlueprintTopic[]
  readonly cells: readonly BlueprintCell[]
}

/**
 * Hamilton's largest-remainder apportionment: integers summing to exactly `total`, each as
 * close to its share as rounding allows, ties to the earlier index.
 */
export function largestRemainder(total: number, shares: readonly number[]): number[] {
  if (shares.length === 0 || total <= 0) return shares.map(() => 0)
  const sum = shares.reduce((acc, share) => acc + Math.max(0, share), 0)
  const normalised =
    sum > 0 ? shares.map((share) => Math.max(0, share) / sum) : shares.map(() => 1 / shares.length)
  const exact = normalised.map((share) => share * total)
  const counts = exact.map(Math.floor)
  let left = total - counts.reduce((acc, count) => acc + count, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - (counts[index] as number) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    counts[index] = (counts[index] as number) + 1
    left -= 1
  }
  return counts
}

function sortedBlooms(module: BlueprintModule): BloomLevel[] {
  const source = module.objectiveBlooms.length > 0 ? module.objectiveBlooms : module.conceptBlooms
  const unique = [...new Set(source)]
  unique.sort((a, b) => (BLOOM_RANK.get(a) as number) - (BLOOM_RANK.get(b) as number))
  return unique.length === 0 ? ['understand'] : unique
}

/** The level a reinforcement works at: apply when the module reaches it, else its highest. */
function workingBloom(blooms: readonly BloomLevel[]): BloomLevel {
  const highest = blooms[blooms.length - 1] as BloomLevel
  return (BLOOM_RANK.get(highest) as number) >= APPLY_RANK ? 'apply' : highest
}

function bloomMix(module: BlueprintModule): Partial<Record<BloomLevel, number>> {
  const source = module.objectiveBlooms.length > 0 ? module.objectiveBlooms : module.conceptBlooms
  const mix: Partial<Record<BloomLevel, number>> = {}
  if (source.length === 0) return { understand: 1 }
  for (const level of source) mix[level] = (mix[level] ?? 0) + 1 / source.length
  return mix
}

export function buildBlueprint(input: BlueprintInput): Blueprint {
  const weightOf = new Map(input.topics.map((topic) => [topic.module_id, topic.weight]))
  const weights = input.modules.map((module) => weightOf.get(module.id) ?? 0)
  const bandTotals = largestRemainder(
    Math.max(0, Math.floor(input.examItemCount)),
    DIFFICULTY_BANDS.map((band) => DIFFICULTY_MIX[band]),
  )
  // Per band across modules, so the whole exam is exactly 30/50/20 and every band is spread
  // by weight rather than by whichever module came first.
  const perBand = DIFFICULTY_BANDS.map((_, b) => largestRemainder(bandTotals[b] as number, weights))

  const topics: BlueprintTopic[] = []
  const cells: BlueprintCell[] = []
  for (const [m, module] of input.modules.entries()) {
    const blooms = sortedBlooms(module)
    const entry = blooms[0] as BloomLevel
    cells.push({
      key: `${module.id}|diagnostic|core|${entry}`,
      kind: 'diagnostic',
      moduleId: module.id,
      bloom: entry,
      band: null,
      difficulties: DIAGNOSTIC_CORE_DIFFICULTIES,
      forms: [],
    })
    cells.push({
      key: `${module.id}|diagnostic|apply|apply`,
      kind: 'diagnostic',
      moduleId: module.id,
      bloom: 'apply',
      band: null,
      difficulties: DIAGNOSTIC_APPLY_DIFFICULTIES,
      forms: [],
    })
    const working = workingBloom(blooms)
    cells.push({
      key: `${module.id}|reinforcement|${working}`,
      kind: 'reinforcement',
      moduleId: module.id,
      bloom: working,
      band: null,
      difficulties: REINFORCEMENT_DIFFICULTIES,
      forms: [],
    })

    // Topic × Bloom × difficulty (§9 "Simulacros"): each band's items are split across the
    // module's Bloom levels by its objectives' mix, so an "apply"-heavy module is examined
    // mostly at "apply" at every difficulty, not only in its hard fifth.
    let examItems = 0
    const mix = bloomMix(module)
    for (const [b, band] of DIFFICULTY_BANDS.entries()) {
      const count = (perBand[b] as number[])[m] as number
      if (count === 0) continue
      examItems += count
      const split = largestRemainder(
        count,
        blooms.map((level) => mix[level] ?? 0),
      )
      for (const [l, bloom] of blooms.entries()) {
        const n = split[l] as number
        if (n === 0) continue
        cells.push({
          key: `${module.id}|exam|${bloom}|${band}`,
          kind: 'exam',
          moduleId: module.id,
          bloom,
          band,
          difficulties: Array.from({ length: n }, () => BAND_DIFFICULTY[band]),
          forms: PARALLEL_FORMS,
        })
      }
    }

    topics.push({
      module_id: module.id,
      weight: weights[m] as number,
      bloom_mix: bloomMix(module),
      difficulty_mix: DIFFICULTY_MIX,
      exam_items: examItems,
    })
  }

  return {
    version: BLUEPRINT_VERSION,
    difficulty_mix: DIFFICULTY_MIX,
    exam_item_count: bandTotals.reduce((sum, count) => sum + count, 0),
    topics,
    cells,
  }
}

/** How many items a cell keeps: one per difficulty, per form when it has forms. */
export function cellItemCount(cell: ItemAuthorCell): number {
  return cell.difficulties.length * Math.max(1, cell.forms.length)
}
