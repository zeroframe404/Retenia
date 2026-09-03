import type { ImportanceLevel } from '../entities'
import { IMPORTANCE_LEVELS } from '../entities'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import {
  DEFAULT_IMPORTANCE_CATALOG,
  type ImportanceCatalog,
  PRIORITY_BIAS_THRESHOLD,
} from './importance'

/**
 * The priority-bias guard of `docs/spec/02-memory-system.md` §7 rule 4: "show the
 * percentage per level and limit Urgente + Alta to ~30 % — if everything is urgent, nothing
 * is."
 *
 * Read-only. The warning is a nudge, never an enforcement: nothing here stops the user from
 * marking everything urgent, it just tells them what that costs. Sub-phase 4.4 renders it.
 */

export interface ImportanceMixEntry {
  level: ImportanceLevel
  /** Live knowledge items at this level. */
  items: number
  /** Live cards whose *effective* level is this one (an override moves a card without
   *  moving its item). */
  cards: number
  /** `items` as a share of `totalItems`, in `[0, 1]`. `0` when there is nothing yet — never
   *  `NaN`. */
  share: number
}

export interface ImportanceMix {
  /** Every level, review order first. */
  entries: readonly ImportanceMixEntry[]
  /** Live items excluding `paused` — a parked item is not competing for the day. */
  totalItems: number
  totalCards: number
  /** `share(urgent) + share(high)`. */
  prioritizedShare: number
  threshold: number
  /** `prioritizedShare > threshold`, strictly — exactly 30 % does not warn. */
  biasWarning: boolean
  computedAt: Date
}

export interface ImportanceMixDeps {
  repos: {
    knowledgeItems: Pick<KnowledgeItemRepository, 'countByImportance'>
    cards: Pick<CardRepository, 'countByImportance'>
  }
  catalog?: ImportanceCatalog
  clock?: Clock
}

/** Sums the counts of every level but `paused` — the denominator of every share. */
export function queuedTotal(counts: Record<ImportanceLevel, number>): number {
  return IMPORTANCE_LEVELS.reduce(
    (total, level) => (level === 'paused' ? total : total + counts[level]),
    0,
  )
}

export type ImportanceMixQuery = () => Promise<ImportanceMix>

export function createImportanceMix(deps: ImportanceMixDeps): ImportanceMixQuery {
  const catalog = deps.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const clock = deps.clock ?? systemClock

  return async () => {
    const [items, cards] = await Promise.all([
      deps.repos.knowledgeItems.countByImportance(),
      deps.repos.cards.countByImportance(),
    ])

    const totalItems = queuedTotal(items)
    const totalCards = queuedTotal(cards)
    const share = (level: ImportanceLevel): number =>
      level === 'paused' || totalItems === 0 ? 0 : items[level] / totalItems

    const entries = catalog.ordered().map(
      (settings): ImportanceMixEntry => ({
        level: settings.level,
        items: items[settings.level],
        cards: cards[settings.level],
        share: share(settings.level),
      }),
    )

    // One division, not `share('urgent') + share('high')`: summing two quotients
    // accumulates floating-point error, and 0.2 + 0.1 > 0.3 would warn on a collection
    // sitting exactly on the threshold.
    const prioritizedShare = totalItems === 0 ? 0 : (items.urgent + items.high) / totalItems
    return {
      entries: Object.freeze(entries),
      totalItems,
      totalCards,
      prioritizedShare,
      threshold: PRIORITY_BIAS_THRESHOLD,
      biasWarning: prioritizedShare > PRIORITY_BIAS_THRESHOLD,
      computedAt: clock.now(),
    }
  }
}
