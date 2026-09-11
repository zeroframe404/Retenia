import type { ImportanceLevel, KnowledgeItemStatus } from '../entities'
import type { CardRepository, KnowledgeItemRepository, ReviewLogRepository } from '../ports'
import type { ReviewCard } from './review-card'
import type { UndoReview } from './session-runner'
import { CARD_STATE } from './types'

/**
 * `seed_memory` of `docs/spec/04-path-generation.md` §10 step 8 and stage 10 of §3: the cards
 * of a module the learner already knows enter memory *"seeded with a state equivalent to a
 * Good and low priority"*.
 *
 * The seeding is one real review, not a hand-written state: every card is graded Good through
 * the caller's `reviewCard`, so the scheduler — and only the scheduler — computes S and D
 * (`fsrs-rules`), and the history holds exactly one `review_logs` row with `context =
 * 'diagnostic'` saying why the card is where it is. The caller wires that `reviewCard` with a
 * policy whose learning steps are empty, so the Good graduates the card straight to Review
 * rather than parking it in a ten-minute learning step: the learner said they know this.
 *
 * Before the review, the item leaves "Need to Learn" (`active`) at `maintenance` importance —
 * in that order, so the interval is computed from maintenance's desired retention.
 *
 * Idempotent: a card with any review already (a learner who studied it, or a seeding that
 * ran) is left alone, so running it twice writes nothing the second time.
 */

export const SEED_IMPORTANCE: ImportanceLevel = 'maintenance'

export interface SeedKnownRepos {
  readonly knowledgeItems: Pick<KnowledgeItemRepository, 'listByLesson' | 'findById' | 'update'>
  readonly cards: Pick<CardRepository, 'listByItems' | 'findById'>
  readonly reviewLogs: Pick<ReviewLogRepository, 'countByCard'>
}

/** What one seeding wrote — exactly what the undo needs to take it back. */
export interface SeededCard {
  readonly cardId: string
  readonly itemId: string
  readonly logId: string
  readonly previousImportance: ImportanceLevel
  readonly previousStatus: KnowledgeItemStatus
}

export type SeedKnownItems = (input: {
  readonly lessonIds: readonly string[]
}) => Promise<SeededCard[]>

export function createSeedKnownItems(deps: {
  readonly repos: SeedKnownRepos
  readonly reviewCard: ReviewCard
}): SeedKnownItems {
  const { repos } = deps
  return async ({ lessonIds }) => {
    const seeded: SeededCard[] = []
    for (const lessonId of lessonIds) {
      const items = await repos.knowledgeItems.listByLesson(lessonId)
      for (const item of items) {
        if (item.status === 'archived' || item.deletedAt !== null) continue
        const cards = await repos.cards.listByItems([item.id])
        const fresh = []
        for (const card of cards) {
          if (card.deletedAt !== null || card.state !== CARD_STATE.New) continue
          if ((await repos.reviewLogs.countByCard(card.id)) > 0) continue
          fresh.push(card)
        }
        if (fresh.length === 0) continue
        await repos.knowledgeItems.update(item.id, {
          status: 'active',
          importance: SEED_IMPORTANCE,
        })
        for (const card of fresh) {
          const { log } = await deps.reviewCard({
            cardId: card.id,
            rating: 3,
            context: 'diagnostic',
          })
          seeded.push({
            cardId: card.id,
            itemId: item.id,
            logId: log.id,
            previousImportance: item.importance,
            previousStatus: item.status,
          })
        }
      }
    }
    return seeded
  }
}

export type UnseedItems = (records: readonly SeededCard[]) => Promise<number>

/**
 * The one-click "deshacer" of the diagnostic's summary: every seeded review rolled back and
 * its log soft-deleted (`createUndoReview`, the same write the review screen's undo does),
 * then each item returned to the importance and status it had. Returns how many reviews were
 * undone; a record already undone counts for nothing and is not an error.
 */
export function createUnseedItems(deps: {
  readonly repos: Pick<SeedKnownRepos, 'knowledgeItems'>
  readonly undoReview: UndoReview
}): UnseedItems {
  return async (records) => {
    let undone = 0
    const restore = new Map<string, SeededCard>()
    for (const record of records) {
      const result = await deps.undoReview({ cardId: record.cardId, logId: record.logId })
      if (result !== null) undone += 1
      if (!restore.has(record.itemId)) restore.set(record.itemId, record)
    }
    for (const record of restore.values()) {
      const item = await deps.repos.knowledgeItems.findById(record.itemId)
      if (item === undefined) continue
      await deps.repos.knowledgeItems.update(record.itemId, {
        status: record.previousStatus,
        importance: record.previousImportance,
      })
    }
    return undone
  }
}
