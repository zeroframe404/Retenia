import type { ProgressionStage } from '../entities'
import type { SessionCardEntry } from '../memory/session'

/**
 * §5's *"progression per skill"*: which rung of the recognition → assisted → free-production
 * ladder a skill has earned, and which rungs may substitute for it.
 *
 * > 1st exposure → recognition (`mcq` / `true_false` / `cloze_dropdown`); medium stability →
 * > assisted production (`cloze_wordbank`, `sentence_builder`, `matching`); high stability →
 * > free production (`cloze_typed`, `short_answer`, `free_recall`) and "no hints" variants.
 */

/**
 * The band edges, in days of stability.
 *
 * Named constants in the style of `RATING_THRESHOLDS` (`../memory/rating.ts`) because they
 * are heuristics that will move: §5 says only "medium" and "high" — it gives no numbers at
 * all — so these come from sub-phase 5.6's brief, not from the specification.
 *
 * The bands are **closed at the top**: `S < 3` is recognition, `3 ≤ S ≤ 21` is assisted, and
 * `S > 21` is production. That is the brief's own wording ("3–21 d → assisted production;
 * > 21 d → free production"), so 21 days is the last day of assisted, not the first day of
 * production.
 */
export const PROGRESSION_STABILITY = Object.freeze({
  /** From this many days, recognition is no longer the right ask. */
  assisted: 3,
  /** Above this many days, free production. */
  production: 21,
})

/**
 * The stage a stability has earned.
 *
 * A non-finite or negative stability — an unmigrated import, a corrupt row — reads as
 * `recognition`. "We do not know how well this is known" must never be mistaken for "this is
 * known very well": the failure direction that asks too little is recoverable, the one that
 * demands free recall of something never seen is not.
 */
export function stageForStability(stability: number): ProgressionStage {
  if (!Number.isFinite(stability) || stability < PROGRESSION_STABILITY.assisted) {
    return 'recognition'
  }
  return stability > PROGRESSION_STABILITY.production ? 'production' : 'assisted'
}

/**
 * The stage for a queued card, which is `stageForStability` with one correction: a card in
 * **relearning** is demoted one rung.
 *
 * Not in §5 — it is this module's own reading of §10's *"a lapse never increases
 * stability"*. A card whose stability still says 60 days but which the learner failed
 * minutes ago should not immediately be asked to produce it from nothing; the honest ask is
 * the rung below.
 *
 * The demotion alone is **not** enough to keep the acceptance rule ("a skill with S = 60 d
 * never gets a recognition type"): demoting it to `assisted` would put it on a ladder that
 * *does* reach `recognition`. `ladderForEntry` is what closes that, by reading the card's
 * real stability rather than the rung it was demoted to.
 */
export function stageForEntry(entry: SessionCardEntry): ProgressionStage {
  const stage = stageForStability(entry.card.stability)
  if (entry.kind !== 'relearning') return stage
  if (stage === 'production') return 'assisted'
  return 'recognition'
}

/**
 * The stages that may serve a skill whose ideal stage is `ideal`, best first.
 *
 * **This table is what makes the acceptance criterion structural.** `production` does not
 * list `recognition`, so a skill at S = 60 d cannot be served a recognition type at any
 * relaxation level — not merely "when a production activity exists", but ever. It is a
 * property of the ladder rather than a rule the selector has to remember.
 *
 * That strictness is affordable because the fallback is *not* recognition: when nothing in
 * the ladder fits, the selector returns `null` and the runner renders the plain flashcard —
 * and `flashcard_basic` is itself a production-stage, self-rated free recall. Degrading a
 * high-stability skill to a flashcard is right; degrading it to multiple choice is not.
 *
 * For the same reason `recognition` does not list `production`: it would buy nothing the
 * flashcard fallback does not already give, while spending the session's variety budget on a
 * type too hard for a one-day-old skill.
 *
 * `theory` appears in no ladder — the lesson-only types are not review material (§4).
 */
/**
 * The ladder for one queued card: `stageLadder` of its (possibly demoted) stage, with
 * `recognition` removed whenever the card's own stability puts it in the production band.
 *
 * This — not `stageForEntry` — is what makes the acceptance rule structural. A relearning
 * card at S = 60 d is demoted to `assisted`, and `stageLadder('assisted')` legitimately
 * includes `recognition` for a skill that genuinely sits in that band; a 60-day skill does
 * not, whatever rung it was temporarily demoted to. The filter is on **stability**, because
 * that is what the rule is about.
 */
export function ladderForEntry(entry: SessionCardEntry): readonly ProgressionStage[] {
  const ladder = stageLadder(stageForEntry(entry))
  if (stageForStability(entry.card.stability) !== 'production') return ladder
  return ladder.filter((stage) => stage !== 'recognition')
}

export function stageLadder(ideal: ProgressionStage): readonly ProgressionStage[] {
  switch (ideal) {
    case 'recognition':
      return ['recognition', 'assisted']
    case 'assisted':
      return ['assisted', 'production', 'recognition']
    case 'production':
      return ['production', 'assisted']
    // `theory` is never an ideal stage: `stageForEntry` cannot return it. Kept total so a
    // future stage cannot silently fall through to an empty ladder.
    default:
      return []
  }
}
