import type { Card, LeechAction } from '../entities'
import type { ImportanceLevelSettings } from './importance'

/**
 * Leeches (`docs/spec/02-memory-system.md` §4): cards that keep being forgotten.
 *
 * Anki tags and suspends at 8 lapses, warning every half-threshold; RemNote interrupts the
 * queue at 4. Ours is §4's synthesis — the threshold and the action are **per importance
 * level**, because what to do about a card you keep forgetting depends entirely on how much
 * you need it. Suspending an exam card two days before the exam is the wrong answer; so is
 * spending a daily budget forever on a maintenance card that is not working.
 *
 * Both knobs are columns of `importance_levels` and arrive through the catalog, so this
 * module holds no second policy table — `fsrs-rules` is explicit that `leech_action` is one
 * of the six things importance is allowed to affect.
 *
 * A leech decision never touches S or D. It tags, and at most suspends: the card's memory
 * state is a measurement, and the card being hard is exactly what it is measuring.
 */

export type LeechStage =
  /** Below half the threshold: nothing to say. */
  | 'none'
  /** At or past half the threshold, below it: warn, as Anki does. */
  | 'warning'
  /** At or past the threshold: the level's action applies. */
  | 'leech'

export interface LeechDecision {
  stage: LeechStage
  lapses: number
  threshold: number
  action: LeechAction
  /** Set `cards.leech`. False when it is already set — nothing to write. */
  tag: boolean
  /** Suspend the card now (`maintenance`). */
  suspend: boolean
  /** Offer the 7.x "rewrite this with AI" action (`high`). */
  suggestRewrite: boolean
  /** Put the card in front of the user to edit, without suspending it (`normal`). */
  offerEdit: boolean
}

/** Anki warns at every half-threshold; §4 keeps that. */
export function leechWarningThreshold(threshold: number): number {
  return Math.max(1, Math.ceil(threshold / 2))
}

/**
 * What to do about `card`, at the level `settings` describes.
 *
 * A total function over a small product — five actions × three stages — so the whole
 * decision is testable without a repository, and `review-card.ts` is left with one branch
 * instead of fifteen.
 */
export function evaluateLeech(input: {
  card: Pick<Card, 'lapses' | 'leech' | 'suspended'>
  settings: Pick<ImportanceLevelSettings, 'leechThreshold' | 'leechAction'>
}): LeechDecision {
  const { card, settings } = input
  const threshold = Math.max(1, Math.floor(settings.leechThreshold))
  const action = settings.leechAction
  const lapses = card.lapses
  const base = { lapses, threshold, action }

  if (action === 'none' || lapses < leechWarningThreshold(threshold)) {
    return {
      ...base,
      stage: 'none',
      tag: false,
      suspend: false,
      suggestRewrite: false,
      offerEdit: false,
    }
  }
  if (lapses < threshold) {
    // A warning is a message, not a state change: nothing is tagged yet.
    return {
      ...base,
      stage: 'warning',
      tag: false,
      suspend: false,
      suggestRewrite: false,
      offerEdit: false,
    }
  }
  return {
    ...base,
    stage: 'leech',
    tag: !card.leech,
    // `urgent` warns and never suspends (§7: it is never postponed either — the whole point
    // of the level is that the card keeps coming back until the date passes).
    suspend: action === 'suspend' && !card.suspended,
    suggestRewrite: action === 'warn_rewrite',
    offerEdit: action === 'edit',
  }
}
