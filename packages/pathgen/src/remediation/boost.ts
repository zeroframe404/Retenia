import type { Card, ImportanceLevel, JsonObject } from '@retenia/core'
import { CLEAN_RATING, DAY_MS, REMEDIATION_POLICY, type RemediationPolicy } from './policy'

/**
 * The detour's temporary importance raise (`docs/spec/01-decisions.md` §3: the AI "raises the
 * priority in memory"): the concept's cards go to `high` for 14 days, or until each has had two
 * clean reviews, whichever comes first.
 *
 * Stored as what urgent mode already is — a per-card override with an expiry — so the scheduler
 * needs nothing new: the expiry is honoured on read and swept by `clearExpiredOverrides`. The
 * clean-review release is what this file adds, and it only ever clears an override it set.
 *
 * A card that already carries an override is left alone: a manual override is the learner's
 * decision, and an urgent window is already higher. Nor are cards whose item is already
 * `high`/`urgent` (nothing to raise) or `paused` (the learner took it out of the queue).
 */

export interface BoostState {
  readonly cardIds: readonly string[]
  /** ISO instant, or `null` when nothing was raised. */
  readonly expiresAt: string | null
  /** Consecutive clean reviews per card since the raise. */
  readonly clean: Readonly<Record<string, number>>
  /** Cards already let go after their clean reviews. */
  readonly cleared: readonly string[]
}

export const EMPTY_BOOST: BoostState = Object.freeze({
  cardIds: [],
  expiresAt: null,
  clean: {},
  cleared: [],
})

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export function readBoost(json: JsonObject): BoostState {
  const clean: Record<string, number> = {}
  const raw = json.clean
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [cardId, count] of Object.entries(raw)) {
      if (typeof count === 'number' && Number.isFinite(count)) clean[cardId] = count
    }
  }
  return {
    cardIds: strings(json.card_ids),
    expiresAt: typeof json.expires_at === 'string' ? json.expires_at : null,
    clean,
    cleared: strings(json.cleared),
  }
}

export function writeBoost(state: BoostState): JsonObject {
  return {
    card_ids: [...state.cardIds],
    expires_at: state.expiresAt,
    clean: { ...state.clean },
    cleared: [...state.cleared],
  }
}

const NOT_RAISED: ReadonlySet<ImportanceLevel> = new Set<ImportanceLevel>([
  'urgent',
  'high',
  'paused',
])

/** The cards the raise may touch, and when it ends. */
export function planBoost(
  cards: readonly Pick<
    Card,
    'id' | 'itemId' | 'suspended' | 'importanceOverride' | 'importanceOverrideExpiresAt'
  >[],
  itemImportance: ReadonlyMap<string, ImportanceLevel>,
  now: Date,
  policy: Pick<RemediationPolicy, 'boostDays'> = REMEDIATION_POLICY,
): { readonly cardIds: readonly string[]; readonly expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + policy.boostDays * DAY_MS)
  const cardIds = cards
    .filter((card) => {
      if (card.suspended) return false
      const overridden =
        card.importanceOverride !== null &&
        (card.importanceOverrideExpiresAt === null ||
          card.importanceOverrideExpiresAt.getTime() > now.getTime())
      if (overridden) return false
      const level = itemImportance.get(card.itemId)
      return level === undefined || !NOT_RAISED.has(level)
    })
    .map((card) => card.id)
  return { cardIds, expiresAt }
}

/**
 * One review of a boosted card: a clean one (Good or Easy) counts toward the release, anything
 * else starts the count again. `release` is true exactly once per card — on the review that
 * reaches the policy's count.
 */
export function onBoostedReview(
  state: BoostState,
  cardId: string,
  rating: number,
  policy: Pick<RemediationPolicy, 'boostCleanReviews'> = REMEDIATION_POLICY,
): { readonly state: BoostState; readonly release: boolean } {
  if (!state.cardIds.includes(cardId) || state.cleared.includes(cardId) || rating === 0) {
    return { state, release: false }
  }
  const count = rating >= CLEAN_RATING ? (state.clean[cardId] ?? 0) + 1 : 0
  const release = count >= policy.boostCleanReviews
  return {
    state: {
      ...state,
      clean: { ...state.clean, [cardId]: count },
      cleared: release ? [...state.cleared, cardId] : state.cleared,
    },
    release,
  }
}

/** Whether a card's override is still the one this boost set, so releasing it is ours to do. */
export function isOurOverride(
  card: Pick<Card, 'importanceOverride' | 'importanceOverrideExpiresAt'>,
  state: BoostState,
  policy: Pick<RemediationPolicy, 'boostLevel'> = REMEDIATION_POLICY,
): boolean {
  return (
    state.expiresAt !== null &&
    card.importanceOverride === policy.boostLevel &&
    card.importanceOverrideExpiresAt !== null &&
    card.importanceOverrideExpiresAt.toISOString() === state.expiresAt
  )
}
