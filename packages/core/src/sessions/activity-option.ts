import type { ActivityFamily, AttemptMode, BloomLevel, ProgressionStage } from '../entities'
import type { RatingRule } from '../memory/rating'

/**
 * What the session generator selects over.
 *
 * `docs/spec/03-activities.md` §5: *"A memory item ≠ an activity. The scheduler schedules
 * **skills**; the session generator chooses at run time which type to render according to
 * stability and available modality."* This is the shape of one thing it may choose.
 *
 * It is a **structural descriptor, not the activity itself**: `packages/core` may import no
 * internal package (`tooling/scripts/check-deps.mjs`, rule `core: []`), so the domain cannot
 * see `@retenia/activity-schema`'s envelope or `@retenia/activities`' registry. The adapter
 * that flattens those two into this lives in `packages/activities`, which may import both.
 * The upside is that the selection rules are testable without a renderer, a zod schema or a
 * database anywhere near them.
 */
export interface ActivityOption {
  /** `activities.id` — the row the attempt will point at. */
  activityId: string
  /** One of the 98 type ids (`mcq_single`, `cloze_typed`, …). Not an enum here: the closed
   *  list lives in the registry, which core cannot import. */
  type: string
  family: ActivityFamily
  /** §5's rung: how much help the type gives the learner. */
  progression: ProgressionStage
  /** §3's M-* rule, as core's own `RatingRule`. */
  ratingStrategy: RatingRule
  /** The generator's estimate, in seconds — `toRating`'s fallback before a personal median. */
  expectedSeconds: number
  /** `false` for the nine lesson-only types of §4. */
  eligible: boolean
  /**
   * Whether the activity carries any media asset at all.
   *
   * A boolean rather than a count because no rule reads a count: §12's budget is *"≤ 2
   * **with** media"*, which counts activities. A number would only invite a `> 0` versus
   * `>= 1` slip and add a branch to cover for nothing.
   */
  hasMedia: boolean
  needsMic: boolean
  needsSandbox: boolean
  /**
   * §4's 1–5 scale, or `null` when the generator did not label it — `Activity.difficulty`
   * in `../entities/paths.ts` is nullable, and a literal `1|2|3|4|5` here would force the
   * adapter to either invent a number or throw.
   */
  difficulty: number | null
  /** §11's Bloom level, for the lesson block's "≥ 1 at the apply level". */
  bloom: BloomLevel | null
  /** The concepts this activity exercises (`activities.concept_ids`). Core has no "skill"
   *  entity; a skill *is* a concept id here, as it is in the envelope's `skills`. */
  conceptIds: readonly string[]
  /** When this exact activity was last served, for the "not the same activity within 7
   *  days" rule. `null` when it has never been served. */
  lastServedAt: Date | null
}

/**
 * Which modalities this installation can actually present — §5's *"available modality
 * (microphone? image?)"*.
 *
 * `media` covers every generated or attached asset (image, audio, video), not images alone:
 * what the filter needs to know is whether the activity can be *presented*, and an audio
 * clip and a diagram fail that test for the same reason.
 *
 * It is a **parameter, not a constant read from the environment**. Hardcoding v1's "text
 * only" would make §12's ≤ 2 media budget unreachable dead code that a 100 % coverage gate
 * could never satisfy honestly; as a capability, a test turns it on and the rule is live and
 * proven on the day phase 2 ships it.
 */
export interface HostCapabilities {
  mic: boolean
  media: boolean
  sandbox: boolean
}

/**
 * v1: text only. `docs/spec/03-activities.md` §6 puts audio, image and code in phase 2, and
 * all 21 MVP types are text-only — so this filter excludes nothing today. That is the point:
 * the seam is written and tested before the types that need it exist, rather than after.
 */
export const V1_CAPABILITIES: HostCapabilities = Object.freeze({
  mic: false,
  media: false,
  sandbox: false,
})

/** Which preference rule the ladder had to give up to find an activity at all. */
export type RelaxedRule = 'stage' | 'cooldown' | 'consecutive-type' | 'media-cap'

/** The generator's answer for one due entry. */
export interface ActivitySelection {
  option: ActivityOption
  /** The rung the card's stability asked for. */
  idealStage: ProgressionStage
  /** The rung actually served — differs from `idealStage` only when `stage` was relaxed. */
  stage: ProgressionStage
  /** Which rung of the ladder produced it; `0` means every rule held. */
  rung: 0 | 1 | 2 | 3 | 4
  /** The rules given up, in the order the ladder dropped them. Empty is the happy path; a
   *  non-empty list is what a "why am I seeing this?" affordance would explain. */
  relaxed: readonly RelaxedRule[]
  /** How the activity is served: §12's study/test split, and Legendary's timer. */
  mode: AttemptMode
  /** Hints are offered (`false` under Legendary and in `test` mode). */
  hintsAllowed: boolean
  /** Feedback waits for the end of the run (`test` mode). */
  deferFeedback: boolean
}
