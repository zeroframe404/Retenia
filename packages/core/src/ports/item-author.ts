import type { Activity, BloomLevel, ExamForm } from '../entities'
import type {
  ActivityRejection,
  AuthoringConcept,
  AuthoringMisconception,
  AuthoringObjective,
} from './activity-author'
import type { NewEntity } from './audit'

/**
 * The data half of the item-authoring port — P9 of `docs/spec/04-path-generation.md` §9
 * (*"blueprint → items per cell, forms A/B, estimated difficulty, NBME rules"*), implemented
 * in `@retenia/activity-ai` beside P4 for the same reason P4 is there: the activity schema,
 * its validators and the row mapping live on that side. The transport half is declared by
 * the consumer, `@retenia/pathgen`'s `item-bank/item-author.ts`.
 */

/** What a blueprint cell is for; the item bank turns it into `item_bank.usage` tags. */
export const ITEM_CELL_KINDS = ['diagnostic', 'reinforcement', 'exam'] as const
export type ItemCellKind = (typeof ITEM_CELL_KINDS)[number]

/** One cell of the blueprint: a module × Bloom level × difficulty band, and what it needs. */
export interface ItemAuthorCell {
  /** Stable key of the cell (`M03|exam|apply|hard`): half of the `custom_id`, and the row's. */
  readonly key: string
  readonly kind: ItemCellKind
  readonly bloom: BloomLevel
  /** Target difficulty (1–5) of each item wanted, in order. */
  readonly difficulties: readonly number[]
  /** `['A', 'B']` for an exam cell — one item of each form per difficulty — else `[]`. */
  readonly forms: readonly ExamForm[]
}

export interface ItemAuthorRequest {
  /** The blueprint's hash: the other half of the `custom_id`. */
  readonly blueprintKey: string
  readonly lang: string
  readonly moduleTitle: string
  readonly objectives: readonly AuthoringObjective[]
  readonly concepts: readonly AuthoringConcept[]
  readonly misconceptions: readonly AuthoringMisconception[]
  /** Source fragments the items must be answerable from. */
  readonly excerpts: readonly string[]
  readonly cell: ItemAuthorCell
  /** The prompt asks for `overGeneration ×` the wanted count and the collector keeps the best. */
  readonly overGeneration: number
  /** Stems the items must not repeat: the lessons' quizzes and the bank's other items. */
  readonly avoid: readonly string[]
}

export interface AuthoredItem {
  /** `<custom_id>#<index>`, never a UUIDv7 — the repositories mint ids. */
  readonly key: string
  /** Ready to insert as an item-bank activity (`lesson_id` NULL). */
  readonly row: Omit<NewEntity<Activity>, 'lessonId' | 'ordinal'>
  /** Parallel form, for an exam cell; `null` otherwise. */
  readonly form: ExamForm | null
  /** The author's 1–5 estimate — `difficulty_logit`'s prior. */
  readonly difficulty: number
  readonly conceptIds: readonly string[]
  /** Which misconception each distractor was built from, by option id. */
  readonly misconceptionByOption: Readonly<Record<string, string>>
  /** The question as the learner reads it, for dedupe against the lessons. */
  readonly stem: string
}

export interface ItemAuthorCollected {
  readonly items: readonly AuthoredItem[]
  readonly rejected: readonly ActivityRejection[]
  readonly notes: readonly string[]
}
