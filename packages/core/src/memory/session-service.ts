import type { Card, ImportanceLevel, KnowledgeItem } from '../entities'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { SettingsRepository } from '../ports/settings-repository'
import { DEFAULT_IMPORTANCE_CATALOG, type ImportanceCatalog } from './importance'
import type { ImportanceResolution, SchedulingPolicyInput } from './scheduling-policy'
import { createImportanceResolver } from './scheduling-policy'
import {
  composeSession,
  type ResolvedSessionSettings,
  resolveSessionSettings,
  type SessionCandidate,
  type SessionPlan,
  type SessionSettings,
} from './session'
import {
  type ExamQueueProvider,
  NO_EXAM_QUEUE,
  NO_REINFORCEMENT,
  type ReinforcementProvider,
} from './session-ports'
import { type DayBoundary, HOUR_MS, isSameStudyDay, resolveDayBoundary } from './study-day'
import { CARD_STATE, type Scheduler } from './types'

/**
 * The I/O half of the daily session composer: read what today could hold, resolve each
 * card's importance, and hand it all to the pure `composeSession`.
 *
 * Read-only by construction — the repository slices it asks for carry no `update`, no
 * `append` and no `buryUntil`, so this cannot write even by mistake (the same trick
 * `reschedule.ts` uses to make `simulateReschedule`'s side-effect freedom structural rather
 * than a promise). Applying the plan's burials and postponements is `startSession`'s job.
 */

/**
 * How many due cards one composition may consider.
 *
 * A bound is needed for the same reason `rescheduleSelectionSchema` has one: without it a
 * neglected collection turns one call into an unbounded synchronous read. It is well past
 * the 2,000-card backlog the sub-phase budgets for, so a real user never meets it; when they
 * do, overload protection is what the extra cards would have triggered anyway.
 */
export const MAX_SESSION_CANDIDATES = 10_000

/** How far back to look for "was this reviewed today". A study day is 24 h, but a DST jump
 *  can stretch it to 25; 26 h over-fetches safely and `isSameStudyDay` does the deciding. */
const REVIEWED_TODAY_WINDOW_MS = 26 * HOUR_MS

export interface SessionReadRepositories {
  cards: Pick<CardRepository, 'findDue' | 'findMany'>
  knowledgeItems: Pick<KnowledgeItemRepository, 'findMany'>
  reviewLogs: Pick<ReviewLogRepository, 'medianDurationMs' | 'listSince'>
  settings: Pick<SettingsRepository, 'get'>
}

export interface ComposeSessionDeps {
  repos: SessionReadRepositories
  scheduler: Pick<Scheduler, 'retrievability'>
  /** Defaults to `createImportanceResolver({ catalog, dayBoundary })`. */
  resolve?: (input: SchedulingPolicyInput) => ImportanceResolution
  catalog?: ImportanceCatalog
  exams?: ExamQueueProvider
  reinforcement?: ReinforcementProvider
  /**
   * `createExpireUrgentMode`. Urgent mode's own doc says to run it "before composing the
   * daily session": a lapsed 48-hour override that is still on the card would put its
   * cards first and at retention 0.97 for a push that ended yesterday.
   */
  expireUrgentMode?: (now?: Date) => Promise<number>
  clock?: Clock
  dayBoundary?: Partial<DayBoundary>
}

export type ComposeSessionQuery = (overrides?: SessionSettings, now?: Date) => Promise<SessionPlan>

/** The stored half of the settings, so the composer's defaults and the settings screen can
 *  never drift apart. */
export async function readSessionSettings(
  repos: {
    reviewLogs: Pick<ReviewLogRepository, 'medianDurationMs'>
    settings: Pick<SettingsRepository, 'get'>
  },
  catalog: ImportanceCatalog = DEFAULT_IMPORTANCE_CATALOG,
  overrides: SessionSettings = {},
): Promise<ResolvedSessionSettings> {
  const [
    budgetMinutes,
    streakGoalCards,
    newEveryNReviews,
    order,
    finalDrill,
    newLimit,
    reviewLimit,
  ] = await Promise.all([
    repos.settings.get('review.budgetMinutes'),
    repos.settings.get('review.streakGoalCards'),
    repos.settings.get('review.newEveryNReviews'),
    repos.settings.get('review.queueOrder'),
    repos.settings.get('review.finalDrill'),
    repos.settings.get('review.dailyNewLimit'),
    repos.settings.get('review.dailyReviewLimit'),
  ])

  // §12 input 3: the median comes from the history, and falls back to 8 s only while there
  // is no history to measure.
  const medianMs =
    overrides.medianSecondsPerCard === undefined
      ? await repos.reviewLogs.medianDurationMs({ contexts: ['daily', 'lesson', 'reinforcement'] })
      : null

  return resolveSessionSettings(
    {
      budgetMinutes,
      streakGoalCards,
      newEveryNReviews,
      order,
      finalDrill,
      dailyNewLimit: newLimit,
      dailyReviewLimit: reviewLimit,
      ...(medianMs === null || medianMs <= 0 ? {} : { medianSecondsPerCard: medianMs / 1000 }),
      ...overrides,
    },
    catalog,
  )
}

export function createComposeSession(deps: ComposeSessionDeps): ComposeSessionQuery {
  const catalog = deps.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const boundary = resolveDayBoundary(deps.dayBoundary)
  const clock = deps.clock ?? systemClock
  const exams = deps.exams ?? NO_EXAM_QUEUE
  const reinforcement = deps.reinforcement ?? NO_REINFORCEMENT
  const resolve =
    deps.resolve ?? createImportanceResolver({ catalog, dayBoundary: deps.dayBoundary })

  return async (overrides = {}, at) => {
    const now = at ?? clock.now()
    if (deps.expireUrgentMode !== undefined) await deps.expireUrgentMode(now)

    const settings = await readSessionSettings(deps.repos, catalog, overrides)

    // Reviews and introductions are read separately so the new-card cap bounds its own
    // query: a collection with 5,000 unseen cards must not drag them all into memory to
    // then take fifteen.
    const [dueCards, newCards, recentLogs] = await Promise.all([
      deps.repos.cards.findDue(now, {
        states: [CARD_STATE.Learning, CARD_STATE.Review, CARD_STATE.Relearning],
        limit: MAX_SESSION_CANDIDATES,
      }),
      deps.repos.cards.findDue(now, {
        states: [CARD_STATE.New],
        limit: Math.max(settings.dailyNewLimit * 4, settings.dailyNewLimit + 50),
      }),
      deps.repos.reviewLogs.listSince(new Date(now.getTime() - REVIEWED_TODAY_WINDOW_MS), now),
    ])

    const items = await loadItems(deps.repos, [...dueCards, ...newCards])
    const candidate = (card: Card): SessionCandidate => {
      const item = items.get(card.itemId) ?? null
      return { card, item, resolution: resolve({ card, item, now }) }
    }

    const { reviewedCardIds, reviewedItemIds } = await reviewedToday(
      deps.repos,
      recentLogs,
      now,
      boundary,
      items,
    )

    const [examQueue, node] = await Promise.all([exams.queueFor(now), reinforcement.dueToday(now)])

    return composeSession({
      now,
      settings,
      due: dueCards.map(candidate),
      newCards: newCards.map(candidate),
      examQueue,
      reinforcement: node,
      reviewedTodayCardIds: reviewedCardIds,
      reviewedTodayItemIds: reviewedItemIds,
      scheduler: deps.scheduler,
      catalog,
      dayBoundary: deps.dayBoundary,
    })
  }
}

async function loadItems(
  repos: Pick<SessionReadRepositories, 'knowledgeItems'>,
  cards: readonly Card[],
): Promise<Map<string, KnowledgeItem>> {
  const ids = [...new Set(cards.map((card) => card.itemId))]
  if (ids.length === 0) return new Map()
  const rows = await repos.knowledgeItems.findMany(ids)
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * Which cards — and so which knowledge items — already had a review today (§4's sibling
 * bury trigger).
 *
 * The logs name cards, not items, and a card reviewed today may well not be due again, so it
 * is not in `items` yet; the ones that are missing are fetched. Rating `Manual` rows are
 * skipped: a postpone is not "you have seen this today" and must not bury its siblings.
 */
async function reviewedToday(
  repos: Pick<SessionReadRepositories, 'cards'>,
  logs: readonly { cardId: string; rating: number; review: Date }[],
  now: Date,
  boundary: DayBoundary,
  items: ReadonlyMap<string, KnowledgeItem>,
): Promise<{ reviewedCardIds: Set<string>; reviewedItemIds: Set<string> }> {
  const reviewedCardIds = new Set<string>()
  for (const log of logs) {
    if (log.rating === 0) continue
    if (!isSameStudyDay(log.review, now, boundary.dayStartHour, boundary.timeZone)) continue
    reviewedCardIds.add(log.cardId)
  }
  const reviewedItemIds = new Set<string>()
  if (reviewedCardIds.size === 0) return { reviewedCardIds, reviewedItemIds }

  const cards = await repos.cards.findMany([...reviewedCardIds])
  for (const card of cards) reviewedItemIds.add(card.itemId)
  // A soft-deleted card no longer comes back from `findMany`; its item may still be known
  // from the due set, so fall back to that rather than silently losing the bury.
  for (const [id, item] of items) {
    if (reviewedCardIds.has(id)) reviewedItemIds.add(item.id)
  }
  return { reviewedCardIds, reviewedItemIds }
}

/** Every level the catalog knows, for callers that need a zero-filled record. */
export function emptyLevelCounts(
  catalog: ImportanceCatalog = DEFAULT_IMPORTANCE_CATALOG,
): Record<ImportanceLevel, number> {
  const counts = {} as Record<ImportanceLevel, number>
  for (const level of catalog.ordered()) counts[level.level] = 0
  return counts
}
