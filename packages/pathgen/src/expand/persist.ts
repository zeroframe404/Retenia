import type { Activity, JsonObject, JsonValue, LessonStatus, NewEntity } from '@retenia/core'
import { asJson } from '../json'
import type { LessonCitation, LessonTheory } from '../schemas/lesson'
import type { ExpandRepos } from './deps'
import type { LessonExpansion } from './expansion'
import type { MemoryItemDraft } from './flashcards'
import type { LessonPlan } from './plan'

/**
 * The three writes of stage 7, each idempotent on its own.
 *
 * Idempotence is what makes the resume of §7 work without a second ledger: the theory is an
 * `UPDATE`, which is idempotent by construction; the activities and the memory items are
 * "exists ⟹ this stage already ran", so the caller skips a lesson whose rows are there rather
 * than paying for the answer again. `lessons.expansion` records only what the rows cannot say
 * — the attempt counters and the rules the pool could not meet.
 *
 * The two multi-row writes go through `repos.transaction` for the reason
 * `apps/desktop/src/main/library/service.ts` gives: an item with no card is a row nothing will
 * ever show the learner, and a card with no item cannot be rendered at all.
 */

export interface PersistTheoryInput {
  readonly plan: LessonPlan
  readonly theory: LessonTheory
  readonly citations: readonly LessonCitation[]
  readonly expansion: LessonExpansion
  readonly status: LessonStatus
}

export async function persistTheory(
  repos: Pick<ExpandRepos, 'paths'>,
  input: PersistTheoryInput,
): Promise<void> {
  await repos.paths.updateLesson(input.plan.lessonId, {
    theory: asJson(input.theory),
    citations: input.citations as unknown as JsonValue[],
    expansion: asJson(input.expansion),
    status: input.status,
  })
}

export interface PersistPracticeInput {
  readonly plan: LessonPlan
  /**
   * Already ordered, with `ordinal` counted from zero.
   *
   * When `replace` is false the rows are *appended*, so the numbering continues from what the
   * lesson already has: two activities both claiming ordinal 0 would leave the player's
   * `ORDER BY ordinal` to break the tie by insertion order, which is not an order anybody
   * chose.
   */
  readonly rows: readonly Omit<NewEntity<Activity>, 'lessonId'>[]
  readonly expansion: LessonExpansion
  readonly status: LessonStatus
  /** "Regenerar" replaces the block; "Más ejemplos" appends to it. */
  readonly replace: boolean
}

export async function persistPractice(
  repos: ExpandRepos,
  input: PersistPracticeInput,
): Promise<readonly Activity[]> {
  return repos.transaction(async (tx) => {
    const existing = await tx.paths.listActivities(input.plan.lessonId)
    if (input.replace) {
      for (const row of existing) await tx.paths.softDeleteActivity(row.id)
    }
    const offset = input.replace ? 0 : existing.length
    const created =
      input.rows.length === 0
        ? []
        : await tx.paths.createActivities(
            input.rows.map((row, index) => ({
              ...row,
              lessonId: input.plan.lessonId,
              ordinal: offset + index,
            })),
          )
    await tx.paths.updateLesson(input.plan.lessonId, {
      expansion: asJson(input.expansion),
      status: input.status,
    })
    return created
  })
}

export interface PersistFlashcardsInput {
  readonly plan: LessonPlan
  readonly drafts: readonly MemoryItemDraft[]
  readonly expansion: LessonExpansion
  readonly status: LessonStatus
}

/**
 * The items and their cards, then the lesson's ledger, in one transaction.
 *
 * A lesson that already has items is skipped by the caller rather than merged here: "created
 * exactly once per flashcard" is a property of the whole stage, and a merge would need a
 * natural key on `knowledge_items` that the schema deliberately does not have (*"dedupe is
 * the generator's job, not the schema's"*).
 */
export async function persistFlashcards(
  repos: ExpandRepos,
  input: PersistFlashcardsInput,
): Promise<number> {
  return repos.transaction(async (tx) => {
    let written = 0
    for (const draft of input.drafts) {
      const item = await tx.knowledgeItems.create({
        ...draft.item,
        lessonId: input.plan.lessonId,
        fields: draft.item.fields as JsonObject,
      })
      await tx.cards.create({ ...draft.card, itemId: item.id })
      written += 1
    }
    await tx.paths.updateLesson(input.plan.lessonId, {
      expansion: asJson(input.expansion),
      status: input.status,
    })
    return written
  })
}

/** Marks a lesson `generating` or `failed` without touching anything it has already earned. */
export async function markLesson(
  repos: Pick<ExpandRepos, 'paths'>,
  plan: LessonPlan,
  status: LessonStatus,
  expansion: LessonExpansion,
): Promise<void> {
  await repos.paths.updateLesson(plan.lessonId, { status, expansion: asJson(expansion) })
}
