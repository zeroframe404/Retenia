import type { Card } from '../entities'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import { HOUR_MS } from './study-day'

/**
 * Urgent mode (`docs/spec/02-memory-system.md` §7 rule 5): "DR 0.97 + final drill +
 * same-day steps 10m 1h, explicitly temporary", for 48 or 72 hours.
 *
 * It is stored as what it is — an importance override with an expiry
 * (`cards.importance_override` + `importance_override_expires_at`). The retention, the
 * steps and the final-drill flag are the same for every card, so they are constants in
 * `./importance.ts`, not columns; what is per-card is only when the window closes.
 *
 * **Expiry is honoured on read, not only by the sweep.** `resolveImportance` compares the
 * expiry to `now` on every review, so a user who closes the app for a week never comes back
 * to a collection still reviewing at 0.97. `expireUrgentMode` is hygiene: it clears the
 * columns so the badge disappears and the override stops shadowing the item's level.
 *
 * Nothing here writes `stability`, `difficulty` or `due`. Urgent mode changes what the next
 * review asks for, not what is already scheduled (§7 rule 2).
 */

/** §7 rule 5: "urgent mode of 48–72 h". */
export const URGENT_MODE_HOURS = Object.freeze([48, 72] as const)
export type UrgentModeHours = (typeof URGENT_MODE_HOURS)[number]

export const DEFAULT_URGENT_MODE_HOURS: UrgentModeHours = 48

/**
 * How many cards one call may put into urgent mode.
 *
 * The channel caps `itemIds`, but one item can own many cards, so the id cap alone bounds
 * nothing: without this the fan-out is unbounded and every card is written inside a single
 * transaction. `truncated` in the result is how the UI tells the user the window was
 * applied to part of the selection.
 */
export const MAX_URGENT_MODE_CARDS = 2_000

export interface UrgentModeRepositories {
  cards: Pick<CardRepository, 'listByItems' | 'overrideImportance' | 'clearExpiredOverrides'>
}

export interface UrgentModeUnitOfWork extends UrgentModeRepositories {
  transaction<T>(work: (repos: UrgentModeRepositories) => Promise<T> | T): Promise<T>
}

export interface UrgentModeDeps {
  uow: UrgentModeUnitOfWork
  /** Only consulted when the input names no `now`. */
  clock?: Clock
}

export interface StartUrgentModeInput {
  itemIds: readonly string[]
  /** 48 or 72. Anything else is a `RangeError`. */
  hours?: UrgentModeHours
  now?: Date
}

export interface UrgentModeCounts {
  /** Items whose cards were touched. */
  items: number
  /** Cards written. */
  cards: number
}

export interface UrgentModeResult extends UrgentModeCounts {
  /** When the window closes. */
  expiresAt: Date
  /** The selection had more cards than `MAX_URGENT_MODE_CARDS`; the rest were left alone. */
  truncated: boolean
}

export type StartUrgentMode = (input: StartUrgentModeInput) => Promise<UrgentModeResult>
export type EndUrgentMode = (itemIds: readonly string[]) => Promise<UrgentModeCounts>
export type ExpireUrgentMode = (now?: Date) => Promise<number>

function assertHours(hours: number): UrgentModeHours {
  if (hours !== 48 && hours !== 72) {
    throw new RangeError(`urgentMode: hours must be 48 or 72, got ${String(hours)}`)
  }
  return hours
}

function assertIds(ids: readonly string[]): readonly string[] {
  if (!Array.isArray(ids)) throw new TypeError('urgentMode: itemIds must be an array')
  return ids
}

/**
 * Put every card of these items into urgent mode.
 *
 * An existing manual override is replaced for the duration and is **not** restored when the
 * window closes: the override simply clears and the card falls back to its item's level.
 * That is the documented trade-off of storing one override per card.
 */
export function createStartUrgentMode(deps: UrgentModeDeps): StartUrgentMode {
  const clock = deps.clock ?? systemClock

  return async (input) => {
    const itemIds = assertIds(input.itemIds)
    const hours = assertHours(input.hours ?? DEFAULT_URGENT_MODE_HOURS)
    const now = input.now ?? clock.now()
    const expiresAt = new Date(now.getTime() + hours * HOUR_MS)
    if (itemIds.length === 0) return { items: 0, cards: 0, expiresAt, truncated: false }

    // The read is outside the transaction: `UnitOfWork.transaction`'s contract is that its
    // body only awaits the repositories it is handed. One extra row is read so a selection
    // sitting exactly on the cap is not reported as truncated.
    const found = await deps.uow.cards.listByItems(itemIds, { limit: MAX_URGENT_MODE_CARDS + 1 })
    const truncated = found.length > MAX_URGENT_MODE_CARDS
    const cards = truncated ? found.slice(0, MAX_URGENT_MODE_CARDS) : found
    if (cards.length === 0) return { items: 0, cards: 0, expiresAt, truncated: false }

    const written = await deps.uow.transaction((repos) =>
      repos.cards.overrideImportance(
        cards.map((card) => card.id),
        'urgent',
        expiresAt,
      ),
    )
    return {
      items: new Set(cards.map((card) => card.itemId)).size,
      cards: written,
      expiresAt,
      truncated,
    }
  }
}

/** Leave urgent mode early: clears the override and its expiry. */
export function createEndUrgentMode(deps: UrgentModeDeps): EndUrgentMode {
  return async (itemIds) => {
    const ids = assertIds(itemIds)
    if (ids.length === 0) return { items: 0, cards: 0 }

    const cards = (await deps.uow.cards.listByItems(ids)).filter(
      (card) => card.importanceOverrideExpiresAt !== null,
    )
    if (cards.length === 0) return { items: 0, cards: 0 }

    const written = await deps.uow.transaction((repos) =>
      repos.cards.overrideImportance(
        cards.map((card) => card.id),
        null,
        null,
      ),
    )
    return { items: new Set(cards.map((card) => card.itemId)).size, cards: written }
  }
}

/** The sweep. Idempotent; run it at startup and before composing the daily session. */
export function createExpireUrgentMode(deps: UrgentModeDeps): ExpireUrgentMode {
  const clock = deps.clock ?? systemClock
  return async (now) => deps.uow.cards.clearExpiredOverrides(now ?? clock.now())
}

/** When the card's urgent window closes, or `null` if it is not in urgent mode at `now`. */
export function urgentModeExpiry(card: Card, now: Date): Date | null {
  return card.importanceOverride !== null &&
    card.importanceOverrideExpiresAt !== null &&
    card.importanceOverrideExpiresAt.getTime() > now.getTime()
    ? card.importanceOverrideExpiresAt
    : null
}
