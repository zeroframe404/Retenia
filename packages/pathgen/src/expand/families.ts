import type { ActivityFamily } from '@retenia/core'
import type { ConceptKind } from '../validate/types'

/**
 * Which activity families a lesson may draw from — `docs/spec/03-activities.md` §11's
 * "skill kind × type matrix", read as families rather than types because §7 puts one family
 * per call and the types inside it are the model's choice.
 *
 * | Skill kind | §11's types | Family here |
 * |---|---|---|
 * | definition | flashcard / cloze / mcq | `cards`, `cloze`, `choice` |
 * | process | ordering / worked_example | `ordering` |
 * | classification | categorize / matching | `categorize`, `pairs` |
 * | formula | numeric / calculated | `text_input` |
 * | code | code_fill / parsons / predict_output | (phase 2) |
 * | language | sentence_builder / complete_the_chat / dictation | `ordering`, `choice` |
 *
 * The **base set is always present** because the block has to satisfy `composeLessonPractice`
 * whatever the material is: §7 asks for ≥ 3 distinct types from ≥ 3 families, ≤ 40 % MCQ and
 * one activity at the "apply" level, and a lesson offered only `choice` could not meet any of
 * them. `long_text` is in the base set for the apply rule specifically — it is the one MVP
 * family whose progression stage is production.
 *
 * The kind-driven additions are what the *material* supports: asking for an ordering exercise
 * about a lesson with no procedure in it produces a plausible-looking sequence the sources
 * never stated, which is exactly the failure the fidelity contract exists to prevent.
 */

/** Always asked for: without these the variety rules are unsatisfiable whatever the pool. */
export const BASE_FAMILIES: readonly ActivityFamily[] = Object.freeze([
  'choice',
  'cloze',
  'text_input',
  'long_text',
])

/** What each concept kind additionally supports. */
export const FAMILIES_BY_KIND: Readonly<Record<ConceptKind, readonly ActivityFamily[]>> =
  Object.freeze({
    concept: Object.freeze(['pairs', 'categorize'] as const),
    procedure: Object.freeze(['ordering'] as const),
    fact: Object.freeze(['cards'] as const),
    principle: Object.freeze(['categorize'] as const),
    example: Object.freeze(['categorize'] as const),
    // A misconception is what a distractor is built *from*, not a family of its own.
    misconception: Object.freeze([] as const),
  })

/**
 * One call per family costs a request, so the ceiling is what keeps a six-concept lesson from
 * fanning out to eight calls for a block of eight activities. Six families over-generating
 * 2–3× is already a pool of thirty for a block of at most eight.
 */
export const MAX_FAMILIES_PER_LESSON = 6

export function familiesFor(kinds: readonly ConceptKind[]): readonly ActivityFamily[] {
  const chosen: ActivityFamily[] = [...BASE_FAMILIES]
  for (const kind of kinds) {
    for (const family of FAMILIES_BY_KIND[kind]) {
      if (!chosen.includes(family)) chosen.push(family)
    }
  }
  return chosen.slice(0, MAX_FAMILIES_PER_LESSON)
}
