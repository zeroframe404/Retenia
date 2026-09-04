import type { Card, ImportanceLevel } from '../entities'
import {
  DEFAULT_IMPORTANCE_CATALOG,
  type ImportanceCatalog,
  type ImportancePolicy,
} from './importance'
import { DAY_MS } from './study-day'

/**
 * Overload protection: `docs/spec/02-memory-system.md` §7 rule 3 and §12's closing note.
 *
 * > if `due_today × median_time > capacity`, postpone with factor 1.1 starting with
 * > Mantenimiento and with the highest-S items (least damage); never Urgente; log every
 * > postpone with `rating = Manual`.
 *
 * Pure and read-only: this **selects** what to postpone and says what that costs. Applying
 * it is `applyPostponements` in `session.ts`, which goes through `reviewCard` so every
 * postpone lands as a rating-`Manual` row in `review_logs` and S and D are never touched
 * (`.claude/skills/fsrs-rules/SKILL.md`).
 *
 * Why highest stability first: a card with S = 400 d loses almost nothing by moving 40 days,
 * while a card with S = 2 d moves 1 day and is genuinely at risk of being forgotten. Sorting
 * by S descending sacrifices the least memory per card removed from the day.
 */

export interface PostponeCandidate {
  card: Card
  /** The card's *effective* level, as `resolveImportance` worked it out. */
  level: ImportanceLevel
}

export interface PostponeProposal {
  cardId: string
  level: ImportanceLevel
  /** Why this card was chosen — the queue is ordered by it, descending. */
  stability: number
  currentDue: Date
  newDue: Date
  /** `max(1, ceil(scheduledDays × (factor − 1)))`; factor 1.1 ⇒ a tenth of the interval. */
  addedDays: number
}

/** What the session tells the user, as data. The Spanish sentence §12 quotes — "hoy hiciste
 *  80 %, pospuse 40 tarjetas de mantenimiento" — is rendered from these fields by i18n; core
 *  never holds UI copy (`docs/spec/00-conventions.md`). */
export interface OverloadSummary {
  /** Reviews the day held before protection ran. */
  plannedCards: number
  keptCards: number
  postponedCards: number
  /** `keptCards / plannedCards`, in `[0, 1]` — the "hoy hiciste 80 %". `1` when the day
   *  already fitted, and `1` (not `NaN`) when there was nothing to do. */
  completedShare: number
  /** Only levels that actually lost cards, in the order they were sacrificed. */
  byLevel: readonly { readonly level: ImportanceLevel; readonly count: number }[]
  budgetMinutes: number
  /** What the kept queue is expected to take. */
  estimatedMinutes: number
  overloaded: boolean
  /** True when every postponable card was taken and the day is still over budget — §7's
   *  "Urgente may exceed the daily limit (catch-up)". */
  stillOverBudget: boolean
}

export interface PostponeSelection {
  proposals: readonly PostponeProposal[]
  summary: OverloadSummary
}

export interface OverloadInput {
  candidates: readonly PostponeCandidate[]
  now: Date
  /** Seconds the median card takes, as measured or as §12's 8 s fallback. */
  medianSeconds: number
  budgetMinutes: number
  /** Days of backlog, which is what gates `high` (`backlogDaysBeforePostpone`). */
  backlogDays: number
  catalog?: ImportanceCatalog
}

/**
 * The order levels are sacrificed in: §7's "Under overload" column, read off the policy
 * rather than hard-coded, so changing `IMPORTANCE_POLICIES` changes this too.
 *
 * `never` (urgent) and `not_queued` (paused) are absent by construction — that is the
 * acceptance criterion "postponed cards never include `urgent`", enforced here rather than
 * checked afterwards.
 */
const SACRIFICE_ORDER: Readonly<Record<ImportancePolicy['postpone'], number>> = Object.freeze({
  first: 0,
  standard: 1,
  backlog_only: 2,
  never: Number.POSITIVE_INFINITY,
  not_queued: Number.POSITIVE_INFINITY,
})

function isPostponable(policy: ImportancePolicy, backlogDays: number): boolean {
  if (!Number.isFinite(SACRIFICE_ORDER[policy.postpone])) return false
  // `high` waits until the backlog is more than two days deep; `normal` and `maintenance`
  // have a threshold of 0, so any overload reaches them.
  return backlogDays > policy.backlogDaysBeforePostpone
}

/**
 * `max(1, ceil(scheduledDays × (factor − 1)))`: never a no-op, so a card postponed today is
 * never proposed again in the same breath.
 *
 * The epsilon is not decoration. `1.1 - 1` is `0.10000000000000009` in binary floating
 * point, so a 30-day interval gives `3.0000000000000027` and a bare `ceil` would return 4 —
 * an extra day of delay on every round-numbered interval, for no reason a user could ever
 * make sense of. Nudging down by a nanosecond of a day rounds the representation error away
 * without touching a genuine fraction.
 */
export function postponeDays(scheduledDays: number, factor: number): number {
  const extra = Math.max(0, scheduledDays) * Math.max(0, factor - 1)
  return Math.max(1, Math.ceil(extra - 1e-9))
}

export function selectPostponements(input: OverloadInput): PostponeSelection {
  const catalog = input.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const medianSeconds = input.medianSeconds > 0 ? input.medianSeconds : 1
  const budgetSeconds = Math.max(0, input.budgetMinutes) * 60
  const planned = input.candidates.length
  const perMinute = medianSeconds / 60

  const capacity = Math.max(0, Math.floor(budgetSeconds / medianSeconds))
  const overloaded = planned * medianSeconds > budgetSeconds

  const summaryFor = (proposals: readonly PostponeProposal[]): OverloadSummary => {
    const kept = planned - proposals.length
    const counts = new Map<ImportanceLevel, number>()
    for (const proposal of proposals) {
      counts.set(proposal.level, (counts.get(proposal.level) ?? 0) + 1)
    }
    return {
      plannedCards: planned,
      keptCards: kept,
      postponedCards: proposals.length,
      completedShare: planned === 0 ? 1 : kept / planned,
      byLevel: Object.freeze([...counts].map(([level, count]) => Object.freeze({ level, count }))),
      budgetMinutes: input.budgetMinutes,
      estimatedMinutes: kept * perMinute,
      overloaded,
      stillOverBudget: kept > capacity,
    }
  }

  if (!overloaded) return { proposals: Object.freeze([]), summary: summaryFor([]) }

  // Eligible cards, worst-first: least important level, then most stable, then id so the
  // selection is total and a given backlog always postpones the same cards.
  const eligible = input.candidates
    .filter((candidate) => isPostponable(catalog.get(candidate.level), input.backlogDays))
    .sort((a, b) => {
      const byLevel =
        SACRIFICE_ORDER[catalog.get(a.level).postpone] -
        SACRIFICE_ORDER[catalog.get(b.level).postpone]
      if (byLevel !== 0) return byLevel
      if (a.card.stability !== b.card.stability) return b.card.stability - a.card.stability
      return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0
    })

  const wanted = Math.min(Math.max(0, planned - capacity), eligible.length)
  const proposals: PostponeProposal[] = []
  for (let index = 0; index < wanted; index++) {
    const { card, level } = eligible[index] as PostponeCandidate
    const added = postponeDays(card.scheduledDays, catalog.get(level).postponeFactor)
    proposals.push({
      cardId: card.id,
      level,
      stability: card.stability,
      currentDue: card.due,
      newDue: new Date(input.now.getTime() + added * DAY_MS),
      addedDays: added,
    })
  }

  return { proposals: Object.freeze(proposals), summary: summaryFor(proposals) }
}
