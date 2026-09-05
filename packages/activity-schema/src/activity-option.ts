import type { ActivityOption, BloomLevel } from '@retenia/core'
import type { Activity } from './envelope'
import { capabilitiesOf, progressionOf } from './registry'

/**
 * One stored activity, flattened into the descriptor the session generator selects over.
 *
 * `@retenia/core`'s `selectActivity` chooses over a flat `ActivityOption` because `core` may
 * import no internal package (`tooling/scripts/check-deps.mjs`, rule `core: []`) — it can see
 * neither this envelope nor the type catalogue. So this is where the two halves of a
 * candidate are joined: what the **content** says (its skills, its difficulty, whether it
 * carries media) and what the **type** says (its progression stage, what hardware it needs).
 *
 * It lives in `activity-schema` rather than in `packages/activities` because the Electron
 * main process is what serves a review, and `packages/activities` is React.
 */
/**
 * The types §5 excludes from the scheduler by name: *"types with chance or noise (memory
 * game, word search, arcade with moving distractors, board) **do not feed the scheduler**;
 * they serve as reward and variety"*.
 *
 * `memory_game` and `word_search` need no entry — §4 already gives them rating rule `none`,
 * so `feedsScheduler` rejects them. These three do not: §4's table rates `arcade_select` as
 * `M-pct (no chance)`, `gameshow_ladder` as `M-pct` and `board_puzzle` as `M-bin`, which
 * contradicts §5. §5 is the more specific statement — it is the section about what may feed
 * the scheduler — so it wins, and the resolution is recorded here rather than left as a rule
 * the code quietly does not enforce.
 *
 * None of the three has a renderer yet (all are phase 3), so today this changes nothing; it
 * is written now so the rule is not rediscovered the day one of them ships.
 */
export const CHANCE_TYPES: readonly string[] = Object.freeze([
  'arcade_select',
  'gameshow_ladder',
  'board_puzzle',
])

export interface ActivityOptionContext {
  /** When this activity was last served, from the attempt history. */
  lastServedAt?: Date | null
  /** §11's Bloom level, which lives on the `activities` row rather than in the envelope. */
  bloom?: BloomLevel | null
}

export function toActivityOption(
  activity: Activity,
  context: ActivityOptionContext = {},
): ActivityOption {
  const capabilities = capabilitiesOf(activity.type)
  return {
    activityId: activity.id,
    type: activity.type,
    family: activity.family,
    progression: progressionOf(activity.type),
    ratingStrategy: activity.review.ratingStrategy,
    expectedSeconds: activity.review.expectedSeconds ?? 0,
    eligible: activity.review.eligible && !CHANCE_TYPES.includes(activity.type),
    // The envelope's `media` array, not the type's "can carry media": what the session's
    // budget counts is whether *this activity* actually does.
    hasMedia: (activity.media?.length ?? 0) > 0,
    needsMic: capabilities.needsMic,
    needsSandbox: capabilities.needsSandbox,
    difficulty: activity.difficulty,
    bloom: context.bloom ?? null,
    conceptIds: activity.skills,
    lastServedAt: context.lastServedAt ?? null,
  }
}
