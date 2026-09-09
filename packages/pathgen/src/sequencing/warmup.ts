import { chain, compareNumbers, compareStrings } from '../graph/order'
import type { ConceptEdge, ConceptNode } from '../validate/types'
import type { SequencingLimits } from './types'

/**
 * The spiral of `docs/spec/04-path-generation.md` §3 stage 5 — "important concepts reappear
 * as a retrieval warm-up" — as the activation step of §4 ("1–2 retrieval questions from
 * previous lessons"): every lesson after the first two opens by retrieving at most one
 * concept introduced at least two lessons earlier.
 *
 * Which one is a deterministic choice: a direct prerequisite of what the lesson teaches
 * beats anything else (Gagné's activation is of *relevant* prior knowledge), then the concept
 * warmed up least often (round-robin, so every important concept comes round), then the more
 * important, then the older, then the id. A concept never warms up two lessons in a row, nor
 * within `cooldown` lessons of its last warm-up.
 */
export function assignWarmups(
  lessons: ReadonlyArray<{ readonly concept_ids: readonly string[] }>,
  nodes: ReadonlyMap<string, ConceptNode>,
  prerequisites: readonly ConceptEdge[],
  limits: SequencingLimits['warmup'],
  importanceThreshold: number,
): string[][] {
  const homeIndex = new Map<string, number>()
  for (const [index, lesson] of lessons.entries()) {
    for (const id of lesson.concept_ids) homeIndex.set(id, index)
  }
  const prerequisitesOf = new Map<string, Set<string>>()
  for (const edge of prerequisites) {
    if (edge.kind !== 'PREREQ_OF') continue
    const set = prerequisitesOf.get(edge.to) ?? new Set<string>()
    set.add(edge.from)
    prerequisitesOf.set(edge.to, set)
  }

  const warmedCount = new Map<string, number>()
  const lastWarmed = new Map<string, number>()
  const importanceOf = (id: string): number => nodes.get(id)?.importance ?? 0

  return lessons.map((lesson, index) => {
    if (index < limits.minDistance) return []

    const direct = new Set<string>()
    for (const id of lesson.concept_ids) {
      for (const prerequisite of prerequisitesOf.get(id) ?? []) direct.add(prerequisite)
    }

    let candidates = [...homeIndex.entries()]
      .filter(([id, home]) => {
        if (home > index - limits.minDistance) return false
        const last = lastWarmed.get(id)
        return last === undefined || index - last > limits.cooldown
      })
      .map(([id]) => id)
    const important = candidates.filter((id) => importanceOf(id) >= importanceThreshold)
    if (important.length > 0) candidates = important

    const order = chain<string>(
      (a, b) => compareNumbers(direct.has(a) ? 0 : 1, direct.has(b) ? 0 : 1),
      (a, b) => compareNumbers(warmedCount.get(a) ?? 0, warmedCount.get(b) ?? 0),
      (a, b) => compareNumbers(importanceOf(b), importanceOf(a)),
      (a, b) => compareNumbers(homeIndex.get(a) as number, homeIndex.get(b) as number),
      compareStrings,
    )
    const pick = candidates.sort(order)[0]
    if (pick === undefined) return []

    warmedCount.set(pick, (warmedCount.get(pick) ?? 0) + 1)
    lastWarmed.set(pick, index)
    return [pick]
  })
}
