import { authoringBranch } from '@retenia/activity-schema'
import { z } from 'zod'

/**
 * `make_items@1` — what P9 returns for one blueprint cell (`docs/spec/04-path-generation.md`
 * §8 `ItemBankItem.v1`, §9). The `schema:` line of `packages/ai/prompts/P9_items/1.md` names
 * this version, and it is the `schemaVersion` half of every P9 `custom_id`.
 *
 * Each item is P4's `authoringBranch` over the `choice` family narrowed to the two types a
 * blind item bank can grade without a model — `mcq_single` and `true_false` — plus the two
 * fields only the bank needs: the parallel `form` of an exam cell and, per distractor, the
 * misconception it was built from (what `insert_remediation` names when a learner picks it
 * with confidence, §10 step 3).
 */

export const MAKE_ITEMS_SCHEMA_NAME = 'make_items'
export const MAKE_ITEMS_SCHEMA_VERSION = '1'
export const MAKE_ITEMS_SCHEMA_ID = `${MAKE_ITEMS_SCHEMA_NAME}@${MAKE_ITEMS_SCHEMA_VERSION}`

export const ITEM_TYPES = ['mcq_single', 'true_false'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

/** Three times the largest cell (four difficulties × two forms), with room to spare. */
export const MAX_ITEMS_PER_CALL = 24

export const optionMisconceptionSchema = z.object({
  option_id: z.string().min(1),
  misconception_id: z.string().min(1),
})

/** One item as the model writes it — shared with P11, whose detours carry bank-shaped items. */
export function itemCandidateSchema() {
  return authoringBranch('choice', ITEM_TYPES).extend({
    form: z
      .enum(['A', 'B'])
      .nullable()
      .describe('The parallel form of an exam cell; null for any other cell.'),
    option_misconceptions: z
      .array(optionMisconceptionSchema)
      .describe('For each wrong option: its option id and the misconception id behind it.'),
  })
}

export type ItemCandidate = z.infer<ReturnType<typeof itemCandidateSchema>>

export function makeItemsOutputSchema() {
  return z.object({
    items: z.array(itemCandidateSchema()).min(1).max(MAX_ITEMS_PER_CALL),
    /** What the author could not do: a cell the excerpts do not support, say. */
    notes: z.array(z.string().min(1).max(300)).max(6),
  })
}

export type MakeItemsOutput = z.infer<ReturnType<typeof makeItemsOutputSchema>>
