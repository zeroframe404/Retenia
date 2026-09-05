import type { AttemptMode, ProgressionStage } from '../entities'
import { pickWithSeed } from '../memory/prng'
import { feedsScheduler } from '../memory/rating'
import type { SessionCardEntry } from '../memory/session'
import { DAY_MS } from '../memory/study-day'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type {
  ActivityOption,
  ActivitySelection,
  HostCapabilities,
  RelaxedRule,
} from './activity-option'
import { V1_CAPABILITIES } from './activity-option'
import type { SessionPolicy } from './policies'
import { policyAllowsType, resolvePresentation } from './policies'
import { ladderForEntry, stageForEntry } from './progression'

/**
 * The runtime activity selector — §5's *"the session generator chooses at run time which
 * type to render according to stability and available modality"*.
 *
 * The selection itself is a **pure function** of the entry, the candidates and the session's
 * history so far; `createActivitySelector` is a thin shell that holds that history.
 *
 * That split is not tidiness, it is a correctness requirement. `SessionRunner.next()` is
 * documented as pure — *"it starts the per-card timer but writes nothing"* — and the review
 * screen calls it again on every re-render. A selector that recorded its choice inside
 * `select` would double-count the media budget and poison the consecutive-type check every
 * time React re-rendered. So `next()` calls `select`, and only `answer()`/`skip()` call
 * `commit`.
 */

/** §12's budget: "≤ 2 with media". */
export const DEFAULT_MAX_MEDIA_PER_SESSION = 2

/** "Avoid … the same activity within 7 days" (sub-phase 5.6). */
export const DEFAULT_REPEAT_COOLDOWN_DAYS = 7

/** What the session has served so far. Everything the preference rules consult. */
export interface ActivitySelectionHistory {
  /** The type served immediately before, for the no-two-in-a-row rule. */
  readonly lastType: string | null
  /** How many media activities have been served. */
  readonly mediaUsed: number
  /** Every activity already served *in this session* — the within-session half of the
   *  cooldown, which `lastServedAt` cannot see because it was read before the session began. */
  readonly servedActivityIds: ReadonlySet<string>
}

export const EMPTY_ACTIVITY_HISTORY: ActivitySelectionHistory = Object.freeze({
  lastType: null,
  mediaUsed: 0,
  servedActivityIds: Object.freeze(new Set<string>()) as ReadonlySet<string>,
})

export interface ActivitySelectionInput {
  entry: SessionCardEntry
  /**
   * The activities that exercise this entry's skill. The caller resolves them — core has no
   * card → concept → activity join — so this is "already known to be about this card".
   */
  options: readonly ActivityOption[]
  history: ActivitySelectionHistory
  /** `SessionPlan.seed`: the same seed replays the same session exactly. */
  seed: string
  now: Date
  capabilities?: HostCapabilities
  mode?: AttemptMode
  policy?: SessionPolicy
  maxMediaPerSession?: number
  repeatCooldownDays?: number
}

/** One rung of the relaxation ladder. `stages` is `null` for "the whole ladder". */
interface Rung {
  readonly idealOnly: boolean
  readonly cooldown: boolean
  readonly consecutive: boolean
  readonly mediaCap: boolean
  readonly relaxed: readonly RelaxedRule[]
}

/**
 * The rungs, tried in order; the first that yields anything wins.
 *
 * The order the rules are given up in is the order they matter least:
 *
 * 1. **Stage adjacency** goes first because §5's bands are explicitly fuzzy ("medium", "high"
 *    stability) and a neighbouring rung is still pedagogically honest — whereas repeating the
 *    same shape is the failure §5 actually names, *"avoid memorizing the question's shape"*.
 * 2. **The 7-day cooldown** next: re-showing something from five days ago is nearly
 *    invisible to the learner.
 * 3. **The consecutive-type rule** after that: two identical shapes in a row is immediately
 *    obvious, so it is worth more than the media budget.
 * 4. **The media cap** last. It is an attention/bandwidth budget, the rule least tied to
 *    memory quality — and it has to be liftable, or a session of media-only cards would fall
 *    back to the flashcard on every single entry.
 *
 * Totality: every rung filters *within* the same hard-filtered set, and rung 4 imposes no
 * preference at all — so the union of the rungs is exactly that set. If anything survives the
 * hard filter some rung yields it; if nothing does, every rung is empty and the answer is
 * `null`. `selectActivity` therefore cannot throw and cannot return a filtered-out option.
 */
const LADDER: readonly Rung[] = Object.freeze([
  { idealOnly: true, cooldown: true, consecutive: true, mediaCap: true, relaxed: [] },
  { idealOnly: true, cooldown: false, consecutive: true, mediaCap: true, relaxed: ['cooldown'] },
  {
    idealOnly: false,
    cooldown: false,
    consecutive: true,
    mediaCap: true,
    relaxed: ['cooldown', 'stage'],
  },
  {
    idealOnly: false,
    cooldown: false,
    consecutive: false,
    mediaCap: true,
    relaxed: ['cooldown', 'stage', 'consecutive-type'],
  },
  {
    idealOnly: false,
    cooldown: false,
    consecutive: false,
    mediaCap: false,
    relaxed: ['cooldown', 'stage', 'consecutive-type', 'media-cap'],
  },
] as const)

function withinCooldown(
  option: ActivityOption,
  history: ActivitySelectionHistory,
  now: Date,
  cooldownDays: number,
): boolean {
  if (history.servedActivityIds.has(option.activityId)) return false
  if (option.lastServedAt === null) return true
  return now.getTime() - option.lastServedAt.getTime() >= cooldownDays * DAY_MS
}

/**
 * Choose the activity to render for one due entry, or `null` when none fits — in which case
 * the runner renders the plain flashcard, which is itself a production-stage self-rated
 * recall and so never *easier* than what the ladder refused.
 */
export function selectActivity(input: ActivitySelectionInput): ActivitySelection | null {
  const capabilities = input.capabilities ?? V1_CAPABILITIES
  const mode: AttemptMode = input.mode ?? 'review'
  const policy: SessionPolicy = input.policy ?? 'standard'
  const maxMedia = input.maxMediaPerSession ?? DEFAULT_MAX_MEDIA_PER_SESSION
  const cooldownDays = input.repeatCooldownDays ?? DEFAULT_REPEAT_COOLDOWN_DAYS

  const idealStage = stageForEntry(input.entry)
  const ladder = ladderForEntry(input.entry)

  // The hard filter: applied once, never relaxed. Anything it drops can never be served —
  // an ineligible type would write a review it has no evidence for, an unpresentable one
  // would render nothing, and a stage outside the ladder is the acceptance rule itself.
  const feasible = input.options.filter(
    (option) =>
      feedsScheduler({ eligible: option.eligible, rule: option.ratingStrategy }) &&
      (!option.needsMic || capabilities.mic) &&
      (!option.needsSandbox || capabilities.sandbox) &&
      (!option.hasMedia || capabilities.media) &&
      policyAllowsType(option.type, policy) &&
      ladder.includes(option.progression),
  )
  if (feasible.length === 0) return null

  for (let rung = 0; rung < LADDER.length; rung++) {
    const rules = LADDER[rung] as Rung
    const candidates = feasible.filter(
      (option) =>
        (!rules.idealOnly || option.progression === idealStage) &&
        (!rules.cooldown || withinCooldown(option, input.history, input.now, cooldownDays)) &&
        (!rules.consecutive || option.type !== input.history.lastType) &&
        (!rules.mediaCap || !option.hasMedia || input.history.mediaUsed < maxMedia),
    )
    if (candidates.length === 0) continue

    // Prefer something never served, then something at the ideal stage. Both terms are 0/1,
    // so ties are the norm rather than the exception — which is exactly why the tie-break
    // below has to be deterministic rather than "whatever the query returned first".
    const score = (option: ActivityOption): number =>
      (option.lastServedAt === null ? 2 : 0) + (option.progression === idealStage ? 1 : 0)
    const best = Math.max(...candidates.map(score))
    const tied = candidates
      .filter((option) => score(option) === best)
      // A total order before the seeded pick: without it, "deterministic given the seed"
      // would quietly also depend on the caller's array order, and a repository changing its
      // ORDER BY would change every user's session.
      .sort((a, b) => (a.activityId < b.activityId ? -1 : 1))

    const chosen = pickWithSeed(
      tied,
      `${input.seed}:${input.entry.card.id}:${input.entry.card.reps}`,
    ) as ActivityOption
    const presentation = resolvePresentation(mode, policy)
    return {
      option: chosen,
      idealStage,
      stage: chosen.progression as ProgressionStage,
      rung: rung as ActivitySelection['rung'],
      relaxed: rules.relaxed,
      mode: presentation.mode,
      hintsAllowed: presentation.hintsAllowed,
      deferFeedback: presentation.deferFeedback,
    }
  }

  /* c8 ignore next 2 -- unreachable: rung 4 imposes no preference, so it yields the whole
     non-empty feasible set. Kept so the function is total by construction, not by argument. */
  return null
}

/** Fold one served selection into the history. Pure: it returns a new history. */
export function applySelection(
  history: ActivitySelectionHistory,
  selection: ActivitySelection,
): ActivitySelectionHistory {
  const served = new Set(history.servedActivityIds)
  served.add(selection.option.activityId)
  return {
    lastType: selection.option.type,
    mediaUsed: history.mediaUsed + (selection.option.hasMedia ? 1 : 0),
    servedActivityIds: served,
  }
}

/**
 * Rebuild the history from the outcomes `review_sessions.progress` already persists.
 *
 * This is why `SessionOutcome.activityId` exists. Because the history is a *fold* over the
 * outcomes rather than a second piece of state, `undo` (which pops an outcome) and a resume
 * after a restart (which replays them) both restore the media budget and the last-served
 * type for free, with nothing that can fall out of sync.
 *
 * `lookup` answers what the outcome does not carry — whether that activity had media. An
 * activity the caller can no longer resolve is skipped rather than guessed: over-counting
 * the media budget from a stale row would silently starve the rest of the session.
 */
export function historyFromOutcomes(
  outcomes: readonly { activityId: string | null }[],
  lookup: (activityId: string) => ActivityOption | undefined,
): ActivitySelectionHistory {
  const served = new Set<string>()
  let mediaUsed = 0
  let lastType: string | null = null
  for (const outcome of outcomes) {
    if (outcome.activityId === null) continue
    const option = lookup(outcome.activityId)
    if (option === undefined) continue
    served.add(option.activityId)
    if (option.hasMedia) mediaUsed++
    lastType = option.type
  }
  return { lastType, mediaUsed, servedActivityIds: served }
}

export interface ActivitySelectorConfig {
  seed: string
  capabilities?: HostCapabilities
  mode?: AttemptMode
  policy?: SessionPolicy
  maxMediaPerSession?: number
  repeatCooldownDays?: number
  clock?: Clock
}

/**
 * The stateful shell the runner talks to. `select` is idempotent — call it as often as the
 * UI re-renders; `commit` is what actually spends the session's budgets.
 */
export interface ActivitySelector {
  select(entry: SessionCardEntry, options: readonly ActivityOption[]): ActivitySelection | null
  commit(selection: ActivitySelection): void
  history(): ActivitySelectionHistory
  /** Restore a history rebuilt from `review_sessions.progress` after a resume or an undo. */
  restore(history: ActivitySelectionHistory): void
}

export function createActivitySelector(config: ActivitySelectorConfig): ActivitySelector {
  const clock = config.clock ?? systemClock
  let history: ActivitySelectionHistory = EMPTY_ACTIVITY_HISTORY

  return {
    select: (entry, options) =>
      selectActivity({
        entry,
        options,
        history,
        seed: config.seed,
        now: clock.now(),
        ...(config.capabilities === undefined ? {} : { capabilities: config.capabilities }),
        ...(config.mode === undefined ? {} : { mode: config.mode }),
        ...(config.policy === undefined ? {} : { policy: config.policy }),
        ...(config.maxMediaPerSession === undefined
          ? {}
          : { maxMediaPerSession: config.maxMediaPerSession }),
        ...(config.repeatCooldownDays === undefined
          ? {}
          : { repeatCooldownDays: config.repeatCooldownDays }),
      }),
    commit: (selection) => {
      history = applySelection(history, selection)
    },
    history: () => history,
    restore: (next) => {
      history = next
    },
  }
}
