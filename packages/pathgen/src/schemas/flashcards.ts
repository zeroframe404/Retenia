import { z } from 'zod'

/**
 * `make_flashcards@1` — what P5 returns for one lesson (`docs/spec/04-path-generation.md`
 * §1.2's twenty rules, §4 item 9, §8's `Flashcard.v1`, §9). The `schema:` line of
 * `packages/ai/prompts/P5_make_flashcards/1.md` names this version.
 *
 * Two deliberate departures from §8's `Flashcard.v1`:
 *
 *   * **`importance` is a level, not a 0–1 float.** `knowledge_items.importance` is one of
 *     `IMPORTANCE_LEVELS`, and §1.2 rule 20 states the mapping in levels ("core = Alta;
 *     anecdotal = Mantenimiento"). Asking a model for a number we would immediately bucket
 *     adds a lossy step and a threshold nobody can defend. `paused` is not offered: a card
 *     born out of the queue is a card nobody asked for.
 *   * **No `image_occlusion`.** Every MVP family is text-only (§6 of the activity spec), so a
 *     type that needs an image and coordinates could only produce a card the app cannot
 *     render. It arrives with phase 2's media.
 */

export const MAKE_FLASHCARDS_SCHEMA_NAME = 'make_flashcards'
export const MAKE_FLASHCARDS_SCHEMA_VERSION = '1'
/** The `schema:` value of the prompt file. */
export const MAKE_FLASHCARDS_SCHEMA_ID = `${MAKE_FLASHCARDS_SCHEMA_NAME}@${MAKE_FLASHCARDS_SCHEMA_VERSION}`

/** §8's `Flashcard.v1` types, minus the one that needs an image. */
export const FLASHCARD_TYPES = [
  'basic',
  'reverse',
  'cloze',
  'example_to_concept',
  'contrast',
] as const
export type FlashcardType = (typeof FLASHCARD_TYPES)[number]

/** The levels P5 may propose. The path's own level can still raise these (§11 rule 3). */
export const PROPOSABLE_IMPORTANCE = ['high', 'normal', 'maintenance'] as const

/** §1.2 rule 2: a cloze deletion, as the app's editor and its importers already write one. */
export const CLOZE_DELETION_PATTERN = /\{\{c(\d+)::(.+?)\}\}/g

export const flashcardSchema = z.object({
  type: z.enum(FLASHCARD_TYPES),
  /** `null` on a cloze, where the sentence is the card. */
  front: z.string().min(1).max(400).nullable(),
  back: z.string().min(1).max(400).nullable(),
  /** The sentence with its `{{c1::…}}` deletion; `null` on every other type. */
  cloze_text: z.string().min(1).max(600).nullable(),
  /** §1.2 rule 16: `[CSS Grid]` rather than a sentence of periphrasis. */
  context_cue: z.string().max(80).nullable(),
  concept_ids: z.array(z.string().min(1).max(40)).min(1).max(4),
  importance: z.enum(PROPOSABLE_IMPORTANCE),
  /** §1.2 rule 11: a shared label on cards whose answers are easily confused. */
  interference_group: z.string().max(80).nullable(),
  /** §1.2 rule 19: an ISO date for volatile knowledge; `null` for what does not change. */
  as_of: z.string().max(10).nullable(),
  /** Cite ids from the lesson's `citable` list — §1.2 rule 18. */
  citations: z.array(z.string().min(1).max(64)).max(4),
})
export type Flashcard = z.infer<typeof flashcardSchema>

export const makeFlashcardsOutputSchema = z.object({
  /**
   * §4 item 9 asks for 3–8 and caps at 12. The floor here is **0**, not 3: §1.3 lists
   * material that should not become a card at all — a procedure, a comprehension question,
   * something you would look up — and a lesson made entirely of it has the honest answer of
   * none. Padding to a quota is §14 pitfall 4 ("over-generation of flashcards sinks memory").
   */
  flashcards: z.array(flashcardSchema).max(12),
  /** What §1.3 refused, so the pipeline can report it rather than silently produce nothing. */
  skipped: z
    .array(z.object({ what: z.string().min(1).max(200), reason: z.string().min(1).max(200) }))
    .max(6),
})
export type MakeFlashcardsOutput = z.infer<typeof makeFlashcardsOutputSchema>
