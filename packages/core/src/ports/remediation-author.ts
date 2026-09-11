import type { ActivityRejection, AuthoringConcept, AuthoringMisconception } from './activity-author'
import type { AuthoredItem } from './item-author'

/**
 * The data half of the remediation-authoring port — P11 of `docs/spec/04-path-generation.md`
 * §9 (*"concept + misconception + errors + chunks → 3–5 min mini-lesson with 1 worked example
 * + 3 items"*). Implemented in `@retenia/activity-ai` beside P4 and P9, because the items it
 * writes are validated by the activity schema that lives there; the transport half is
 * `@retenia/pathgen`'s `remediation/author.ts`.
 */

/** One wrong answer the learner gave, as the evidence the mini-lesson has to answer. */
export interface RemediationError {
  /** The question as the learner read it. */
  readonly stem: string
  /** The option or text they chose; `null` when it is not known (a lapse on a flashcard). */
  readonly chosen: string | null
  /** The right answer, when there is one to show. */
  readonly correct: string | null
}

/** A source fragment the explanation may cite, by a short id the prompt shows (`B01`). */
export interface RemediationExcerpt {
  readonly citeId: string
  readonly text: string
  readonly locator: string
}

export interface RemediationAuthorRequest {
  /** Half of the `custom_id`: the version the detour belongs to. */
  readonly pathVersionId: string
  /** `L07.r1` — the other half, and what a warning names. */
  readonly specId: string
  readonly lang: string
  /** The core lesson it detours from, so the new angle can be told apart from the old one. */
  readonly anchorTitle: string
  readonly concept: AuthoringConcept
  readonly misconception: AuthoringMisconception | null
  readonly errors: readonly RemediationError[]
  readonly excerpts: readonly RemediationExcerpt[]
  /** Items to write: three minus what the item bank already supplied. Zero is valid. */
  readonly itemsWanted: number
  /** Stems the new items must not repeat. */
  readonly avoid: readonly string[]
}

export const REMEDIATION_BLOCK_TYPES = [
  'explanation',
  'worked_example',
  'misconception',
  'summary',
] as const
export type RemediationBlockType = (typeof REMEDIATION_BLOCK_TYPES)[number]

export interface RemediationBlock {
  readonly type: RemediationBlockType
  /** Markdown, `[cite:B01]` markers inline. */
  readonly content: string
  /** The cite ids it rests on — verified in code, never trusted. */
  readonly citations: readonly string[]
}

/** §11: the detour reuses the lesson's flashcards and adds only this one. */
export interface RemediationContrastCard {
  readonly front: string
  readonly back: string
  readonly citations: readonly string[]
}

export interface RemediationAuthorCollected {
  readonly title: string | null
  readonly blocks: readonly RemediationBlock[]
  readonly items: readonly AuthoredItem[]
  readonly contrastCard: RemediationContrastCard | null
  readonly rejected: readonly ActivityRejection[]
  readonly notes: readonly string[]
}
