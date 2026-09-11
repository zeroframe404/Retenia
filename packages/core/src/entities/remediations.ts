import type { Entity, JsonObject } from './_common'
import type { RemediationRefusal, RemediationStatus, RemediationTrigger } from './enums'

/**
 * One remediation decision (`docs/spec/04-path-generation.md` §11): a trigger that fired on a
 * concept, what the limits made of it, the `L07.r1` detour it became when it was inserted,
 * and — for tuning the thresholds — what happened to the concept afterwards.
 *
 * Refusals are rows too. §11's traceability ("every remediation records its trigger and its
 * effect") is about tuning, and a threshold cannot be tuned from the triggers that passed
 * alone: the ones the weekly limit turned away are the other half of the evidence.
 */
export interface Remediation extends Entity {
  pathVersionId: string
  /** The module the detour sits in (the anchor lesson's); `null` when nothing could anchor it. */
  moduleId: string | null
  /** The knowledge-graph concept the detour is about — §11's dedupe key. */
  conceptId: string
  /** The `X001` behind the errors, when one is known. */
  misconceptionId: string | null
  trigger: RemediationTrigger
  status: RemediationStatus
  refusal: RemediationRefusal | null
  /** The core lesson the detour hangs off: `L07` of `L07.r1`. Never renumbered. */
  anchorLessonId: string | null
  /** The `kind = 'remediation'` lesson, once written. */
  lessonId: string | null
  /** `L07.r1` — derived from the anchor, never reused, even after a dismissal. */
  specId: string | null
  /** What the trigger saw: accuracies, lapses, the item and the option chosen, … */
  evidence: JsonObject
  /**
   * The temporary importance raise: `{ card_ids, expires_at, clean, cleared }` — which cards
   * went to `high`, until when, how many clean reviews each has had since, and which were
   * already let go after two of them.
   */
  boost: JsonObject
  /** Subsequent accuracy on the concept — `{ attempts, correct, reviews, clean_reviews,
   *  accuracy, measured_at }` — for tuning the thresholds. */
  outcome: JsonObject | null
  /** When the learner completed or dismissed it, or when it was refused or failed. */
  resolvedAt: Date | null
}
