import type { Card, ImportanceLevel, KnowledgeItem } from '../entities'
import {
  DEFAULT_IMPORTANCE_CATALOG,
  type ImportanceCatalog,
  type ImportanceLevelSettings,
} from './importance'
import type { OverloadSummary, PostponeCandidate, PostponeProposal } from './overload'
import { selectPostponements } from './overload'
import type { ImportanceResolution } from './scheduling-policy'
import type { ExamQueueEntry, ReinforcementNode } from './session-ports'
import { DAY_MS, type DayBoundary, resolveDayBoundary, studyDayNumber } from './study-day'
import { CARD_STATE, type Scheduler, type SchedulingOptions } from './types'

/**
 * The daily session composer — `docs/spec/02-memory-system.md` §12.
 *
 * ```
 * 1. Active exams: queue by ascending R_E, then topic weight            ← always first
 * 2. Due by level: Urgente → Alta → Normal → Mantenimiento; within the level, "relative
 *    overdueness" or ascending R, siblings dispersed
 * 3. Relearning interleaved according to its steps (10 min)
 * 4. New: quota per level; 1 new every 3–5 reviews; if backlog > 1.5 days of capacity → 0
 *    new except Urgente
 * 5. Path reinforcement module if it is due today
 * 6. Final drill (optional / urgent mode): everything graded Again/Hard today comes back
 * ```
 *
 * `composeSession` is **pure and synchronous**: it takes candidates that have already been
 * read and resolved, and returns a plan. It writes nothing — not even the sibling burials
 * and overload postponements it proposes, which are returned as *proposals* so that
 * `session.plan` can be a safe preview and `session.start` is what applies them. That is the
 * same simulate-then-confirm split as `simulateReschedule` / `rescheduleNow`.
 *
 * `createComposeSession` in `./session-service.ts` is the I/O half.
 */

// --- settings ----------------------------------------------------------------------------

/** §12: "the minimum not to break the streak". */
export const DEFAULT_STREAK_GOAL_CARDS = 10

/** §12 input 3: the fallback when `review_logs` has no measured duration yet. */
export const FALLBACK_MEDIAN_SECONDS = 8

/** §12 step 4: "1 new every 3–5 reviews". */
export const NEW_EVERY_N_REVIEWS_MIN = 3
export const NEW_EVERY_N_REVIEWS_MAX = 5
export const DEFAULT_NEW_EVERY_N_REVIEWS = 4

/** §12 step 4: "if backlog > 1.5 days of capacity → 0 new except Urgente". */
export const NEW_GATING_BACKLOG_DAYS = 1.5

/** §12 step 2: relative overdueness, or Anki 24.11's ascending-R backlog mode. */
export type SessionOrder = 'relative_overdueness' | 'retrievability'

export interface SessionSettings {
  budgetMinutes?: number
  streakGoalCards?: number
  /** Measured from `review_logs`; falls back to `FALLBACK_MEDIAN_SECONDS`. */
  medianSecondsPerCard?: number
  newEveryNReviews?: number
  order?: SessionOrder
  /** §12 step 6. Urgent mode turns it on regardless of this flag. */
  finalDrill?: boolean
  /** The user's overall cap, on top of the per-level quotas. */
  dailyNewLimit?: number
  dailyReviewLimit?: number
  /** Per-level new-item quota; `null` means uncapped. Defaults to the catalog's `newPerDay`. */
  newQuotas?: Readonly<Partial<Record<ImportanceLevel, number | null>>>
  /** Fixes every tie-break, so a given day always composes the same plan. */
  seed?: string
}

export interface ResolvedSessionSettings {
  budgetMinutes: number
  streakGoalCards: number
  medianSecondsPerCard: number
  newEveryNReviews: number
  order: SessionOrder
  finalDrill: boolean
  dailyNewLimit: number
  dailyReviewLimit: number
  newQuotas: Readonly<Record<ImportanceLevel, number | null>>
  seed: string
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

export function resolveSessionSettings(
  settings: SessionSettings = {},
  catalog: ImportanceCatalog = DEFAULT_IMPORTANCE_CATALOG,
): ResolvedSessionSettings {
  const quotas = {} as Record<ImportanceLevel, number | null>
  for (const level of catalog.ordered()) {
    const override = settings.newQuotas?.[level.level]
    quotas[level.level] = override === undefined ? level.newPerDay : override
  }
  return {
    budgetMinutes: positive(settings.budgetMinutes, 20),
    streakGoalCards: Math.max(
      1,
      nonNegativeInt(settings.streakGoalCards, DEFAULT_STREAK_GOAL_CARDS),
    ),
    medianSecondsPerCard: positive(settings.medianSecondsPerCard, FALLBACK_MEDIAN_SECONDS),
    newEveryNReviews: Math.min(
      NEW_EVERY_N_REVIEWS_MAX,
      Math.max(
        NEW_EVERY_N_REVIEWS_MIN,
        nonNegativeInt(settings.newEveryNReviews, DEFAULT_NEW_EVERY_N_REVIEWS),
      ),
    ),
    order: settings.order ?? 'relative_overdueness',
    finalDrill: settings.finalDrill ?? false,
    dailyNewLimit: nonNegativeInt(settings.dailyNewLimit, 15),
    dailyReviewLimit: nonNegativeInt(settings.dailyReviewLimit, 200),
    newQuotas: Object.freeze(quotas),
    seed: settings.seed ?? '',
  }
}

// --- the plan ----------------------------------------------------------------------------

/** Which of §12's steps put this entry in the queue. */
export type SessionEntryKind = 'exam' | 'due' | 'relearning' | 'new' | 'reinforcement'

export interface SessionCardEntry {
  kind: Exclude<SessionEntryKind, 'reinforcement'>
  card: Card
  level: ImportanceLevel
  /** What the policy resolved for this card; the runner hands it straight to the scheduler. */
  options: SchedulingOptions
  /** `R` now — the "today you recall this at ~82 %" of §7 rule 6. */
  retrievability: number
  /** `elapsed / scheduled`. `null` for a new card, `Infinity` for one with no interval yet. */
  relativeOverdueness: number | null
  examId: string | null
}

export interface SessionReinforcementEntry {
  kind: 'reinforcement'
  node: ReinforcementNode
}

export type SessionEntry = SessionCardEntry | SessionReinforcementEntry

/** §4's sibling bury, as a proposal: `session.start` is what calls `buryUntil`. */
export interface SiblingBurial {
  cardId: string
  itemId: string
  until: Date
}

export interface SessionCounts {
  exam: number
  due: number
  relearning: number
  new: number
  reinforcement: number
  total: number
  /** `due`, broken down by level — the Today card's "35 urgentes, 12 altas…" (§12
   *  Presentation). Every catalog level is present, `paused` always `0` (it never queues). */
  byLevel: Readonly<Record<ImportanceLevel, number>>
}

export interface SessionPlan {
  entries: readonly SessionEntry[]
  counts: SessionCounts
  /** Cards overload protection proposes to move; empty when the day fits the budget. */
  postponements: readonly PostponeProposal[]
  /** Siblings held back to tomorrow because the item was already reviewed today. */
  burials: readonly SiblingBurial[]
  overload: OverloadSummary
  /** What the queue is expected to take, the reinforcement node included. */
  estimatedMinutes: number
  budgetMinutes: number
  streakGoalCards: number
  medianSecondsPerCard: number
  /** `dueCount / capacity`, where `capacity = budget ÷ median`. Gates new cards at 1.5. */
  backlogDays: number
  /** New cards were withheld because of the backlog (urgent excepted). */
  newGated: boolean
  finalDrill: boolean
  order: SessionOrder
  seed: string
  composedAt: Date
}

// --- input -------------------------------------------------------------------------------

/** One card the composer may queue, with everything already resolved for it. */
export interface SessionCandidate {
  card: Card
  item: KnowledgeItem | null
  resolution: ImportanceResolution
}

export interface SessionInput {
  now: Date
  settings: ResolvedSessionSettings
  /** Due, live, unsuspended cards. New-state cards are ignored here; pass them as `newCards`. */
  due: readonly SessionCandidate[]
  /** Candidates for introduction — cards in state `New`. */
  newCards: readonly SessionCandidate[]
  /** §12 step 1. Cards named here are queued as `exam` and skipped in `due`. */
  examQueue?: readonly ExamQueueEntry[]
  /** §12 step 5. */
  reinforcement?: ReinforcementNode | null
  /** Items with a review logged earlier today — the sibling-bury trigger (§4). */
  reviewedTodayItemIds?: ReadonlySet<string>
  /** Cards reviewed earlier today; a card is never buried because of its own review. */
  reviewedTodayCardIds?: ReadonlySet<string>
  scheduler: Pick<Scheduler, 'retrievability'>
  catalog?: ImportanceCatalog
  dayBoundary?: Partial<DayBoundary>
}

// --- ordering ----------------------------------------------------------------------------

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * `elapsed / scheduled` (§12 step 2).
 *
 * A card with no interval to be overdue *against* — a learning card, or one that has never
 * been reviewed — is treated as maximally overdue and sorts first within its level. Its
 * step has already elapsed, which is exactly what makes it due; there is nothing to divide
 * by, and putting it last would strand short-step cards behind a month-long backlog.
 */
export function relativeOverdueness(card: Card, now: Date): number {
  if (card.lastReview === null || card.scheduledDays <= 0) return Number.POSITIVE_INFINITY
  const elapsedDays = (now.getTime() - card.lastReview.getTime()) / DAY_MS
  return elapsedDays / card.scheduledDays
}

function orderWithinLevel(entries: SessionCardEntry[], order: SessionOrder): SessionCardEntry[] {
  return entries.sort((a, b) => {
    if (order === 'retrievability') {
      if (a.retrievability !== b.retrievability) return a.retrievability - b.retrievability
      return compareIds(a.card.id, b.card.id)
    }
    const ao = a.relativeOverdueness ?? 0
    const bo = b.relativeOverdueness ?? 0
    // Descending: the most overdue first. Two `Infinity`s subtract to `NaN`, so compare
    // before subtracting.
    if (ao !== bo) return ao > bo ? -1 : 1
    if (a.retrievability !== b.retrievability) return a.retrievability - b.retrievability
    return compareIds(a.card.id, b.card.id)
  })
}

/**
 * §12 step 2's "siblings dispersed": no two cards of the same knowledge item may sit next to
 * each other, because one reveals the other.
 *
 * A stable single pass. An entry that would clash with the one just emitted is held back and
 * retried as soon as something else has been emitted, so the primary ordering is preserved
 * except where adjacency forces a swap. When only clashing entries remain — every card left
 * belongs to the same item — they are emitted in order: adjacency is unavoidable then, and
 * dropping them would be worse than showing them.
 */
export function disperseSiblings(entries: readonly SessionCardEntry[]): SessionCardEntry[] {
  const out: SessionCardEntry[] = []
  const held: SessionCardEntry[] = []
  let index = 0
  let lastItemId: string | null = null

  while (index < entries.length || held.length > 0) {
    const releasable = held.findIndex((entry) => entry.card.itemId !== lastItemId)
    if (releasable !== -1) {
      const [entry] = held.splice(releasable, 1) as [SessionCardEntry]
      out.push(entry)
      lastItemId = entry.card.itemId
      continue
    }
    if (index < entries.length) {
      const entry = entries[index] as SessionCardEntry
      index += 1
      if (entry.card.itemId === lastItemId) {
        held.push(entry)
        continue
      }
      out.push(entry)
      lastItemId = entry.card.itemId
      continue
    }
    const entry = held.shift() as SessionCardEntry
    out.push(entry)
    lastItemId = entry.card.itemId
  }
  return out
}

// --- composition -------------------------------------------------------------------------

function cardEntry(
  kind: SessionCardEntry['kind'],
  candidate: SessionCandidate,
  input: SessionInput,
  examId: string | null,
): SessionCardEntry {
  const { card, resolution } = candidate
  return {
    kind,
    card,
    level: resolution.level,
    options: resolution.options,
    retrievability: input.scheduler.retrievability(card, input.now),
    relativeOverdueness:
      card.state === CARD_STATE.New ? null : relativeOverdueness(card, input.now),
    examId,
  }
}

/**
 * §12 step 3: a relearning card comes back when its step timer fires, not at the end.
 *
 * The queue is the clock: each entry ahead of it costs one median card, so a card whose step
 * fires in ten minutes belongs `600 / median` entries in. That keeps the interleave honest
 * without the composer having to know real wall-clock time.
 */
function insertByStepTimer(
  sequence: SessionCardEntry[],
  relearning: readonly SessionCardEntry[],
  now: Date,
  medianSeconds: number,
): SessionCardEntry[] {
  const out = [...sequence]
  const ordered = [...relearning].sort(
    (a, b) => a.card.due.getTime() - b.card.due.getTime() || compareIds(a.card.id, b.card.id),
  )
  for (const entry of ordered) {
    const waitSeconds = Math.max(0, (entry.card.due.getTime() - now.getTime()) / 1000)
    const position = Math.min(out.length, Math.round(waitSeconds / medianSeconds))
    out.splice(position, 0, entry)
  }
  return out
}

/**
 * §12 step 4's quota, level by level.
 *
 * Levels are taken in `newItems`-policy order — `unlimited` (urgent) before `priority`
 * (high) before `quota` (normal) — because §7 gives urgent "no cap (by date)" and high
 * "introduction priority". `none` levels (maintenance, paused) never introduce.
 */
const NEW_POLICY_ORDER: Readonly<Record<ImportanceLevelSettings['newItems'], number>> =
  Object.freeze({
    unlimited: 0,
    priority: 1,
    quota: 2,
    none: Number.POSITIVE_INFINITY,
  })

function selectNewCards(
  input: SessionInput,
  catalog: ImportanceCatalog,
  gated: boolean,
): SessionCardEntry[] {
  const { settings } = input
  const perLevel = new Map<ImportanceLevel, number>()
  const chosen: SessionCardEntry[] = []

  const eligible = input.newCards
    .filter((candidate) => {
      const level = catalog.get(candidate.resolution.level)
      if (!Number.isFinite(NEW_POLICY_ORDER[level.newItems])) return false
      // §12 step 4: under a real backlog only urgent keeps introducing.
      return !gated || level.newItems === 'unlimited'
    })
    .sort((a, b) => {
      const byPolicy =
        NEW_POLICY_ORDER[catalog.get(a.resolution.level).newItems] -
        NEW_POLICY_ORDER[catalog.get(b.resolution.level).newItems]
      if (byPolicy !== 0) return byPolicy
      if (a.card.due.getTime() !== b.card.due.getTime()) {
        return a.card.due.getTime() - b.card.due.getTime()
      }
      return compareIds(a.card.id, b.card.id)
    })

  for (const candidate of eligible) {
    if (chosen.length >= settings.dailyNewLimit) break
    const level = candidate.resolution.level
    const quota = settings.newQuotas[level]
    const taken = perLevel.get(level) ?? 0
    if (quota !== null && taken >= quota) continue
    perLevel.set(level, taken + 1)
    chosen.push(cardEntry('new', candidate, input, null))
  }
  return chosen
}

/** §12 step 4: one new card every `newEveryNReviews` reviews. Any new cards left once the
 *  review sequence runs out are appended — the day is short, not the introduction. */
function interleaveNew(
  reviews: readonly SessionCardEntry[],
  newEntries: readonly SessionCardEntry[],
  everyN: number,
): SessionCardEntry[] {
  if (newEntries.length === 0) return [...reviews]
  const out: SessionCardEntry[] = []
  let pending = 0
  let next = 0
  for (const entry of reviews) {
    out.push(entry)
    pending += 1
    if (pending >= everyN && next < newEntries.length) {
      out.push(newEntries[next] as SessionCardEntry)
      next += 1
      pending = 0
    }
  }
  for (; next < newEntries.length; next++) out.push(newEntries[next] as SessionCardEntry)
  return out
}

export function composeSession(input: SessionInput): SessionPlan {
  const catalog = input.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const boundary = resolveDayBoundary(input.dayBoundary)
  const { settings, now } = input
  const median = settings.medianSecondsPerCard
  // The plan's identity, defaulting to the study day. Every order below is a *total* order —
  // ties fall through to the card id — so the seed is recorded rather than consumed: a plan
  // is deterministic outright, and the seed is what lets a resumed session prove it is the
  // same plan it started as. Sub-phase 4.6's load balancer is what will draw from it.
  const seed =
    settings.seed !== ''
      ? settings.seed
      : `${studyDayNumber(now, boundary.dayStartHour, boundary.timeZone)}`

  const reviewedItems = input.reviewedTodayItemIds ?? new Set<string>()
  const reviewedCards = input.reviewedTodayCardIds ?? new Set<string>()
  const examQueue = input.examQueue ?? []
  const examCardIds = new Set(examQueue.map((entry) => entry.card.id))

  // --- step 1: exams, ascending R_E then blueprint weight ---
  const examEntries: SessionCardEntry[] = [...examQueue]
    .sort(
      (a, b) =>
        a.examRetrievability - b.examRetrievability ||
        b.topicWeight - a.topicWeight ||
        compareIds(a.card.id, b.card.id),
    )
    .map((entry) => ({
      kind: 'exam' as const,
      card: entry.card,
      level: entry.level,
      options: entry.options,
      retrievability: input.scheduler.retrievability(entry.card, now),
      relativeOverdueness: relativeOverdueness(entry.card, now),
      examId: entry.examId,
    }))

  // --- step 2 and 3: due and relearning, minus buried siblings ---
  const burials: SiblingBurial[] = []
  const dueByLevel = new Map<ImportanceLevel, SessionCardEntry[]>()
  const relearning: SessionCardEntry[] = []

  for (const candidate of input.due) {
    const { card, resolution } = candidate
    if (!resolution.queued) continue
    if (examCardIds.has(card.id)) continue
    // §4 sibling bury: another card of this item was already reviewed today, so this one
    // waits until tomorrow rather than giving its sibling away. Only cards in `Review` are
    // held back — a card mid-way through its learning steps must not lose them.
    if (
      card.state === CARD_STATE.Review &&
      reviewedItems.has(card.itemId) &&
      !reviewedCards.has(card.id)
    ) {
      burials.push({
        cardId: card.id,
        itemId: card.itemId,
        until: new Date(now.getTime() + DAY_MS),
      })
      continue
    }
    const entry = cardEntry(
      card.state === CARD_STATE.Relearning ? 'relearning' : 'due',
      candidate,
      input,
      card.examId,
    )
    if (entry.kind === 'relearning') {
      relearning.push(entry)
      continue
    }
    const bucket = dueByLevel.get(resolution.level)
    if (bucket === undefined) dueByLevel.set(resolution.level, [entry])
    else bucket.push(entry)
  }

  const dueEntries: SessionCardEntry[] = []
  for (const level of catalog.ordered()) {
    const bucket = dueByLevel.get(level.level)
    if (bucket === undefined) continue
    dueEntries.push(...disperseSiblings(orderWithinLevel(bucket, settings.order)))
  }

  // --- overload protection (§7 rule 3) over everything that is a *review* ---
  const reviewEntries = [...examEntries, ...dueEntries, ...relearning]
  const capacity = Math.max(1, Math.floor((settings.budgetMinutes * 60) / median))
  const backlogDays = reviewEntries.length / capacity

  const postponeCandidates: PostponeCandidate[] = reviewEntries.map((entry) => ({
    card: entry.card,
    level: entry.level,
  }))
  const { proposals, summary } = selectPostponements({
    candidates: postponeCandidates,
    now,
    medianSeconds: median,
    budgetMinutes: settings.budgetMinutes,
    backlogDays,
    catalog,
  })
  const postponed = new Set(proposals.map((proposal) => proposal.cardId))

  const keptExam = examEntries.filter((entry) => !postponed.has(entry.card.id))
  const keptDue = dueEntries.filter((entry) => !postponed.has(entry.card.id))
  const keptRelearning = relearning.filter((entry) => !postponed.has(entry.card.id))

  const sequence = insertByStepTimer([...keptExam, ...keptDue], keptRelearning, now, median)

  // --- step 4: new cards ---
  const newGated = backlogDays > NEW_GATING_BACKLOG_DAYS
  const newEntries = selectNewCards(input, catalog, newGated)
  const withNew = interleaveNew(sequence, newEntries, settings.newEveryNReviews)

  // --- step 5: the path's reinforcement node ---
  const entries: SessionEntry[] = [...withNew]
  const reinforcement = input.reinforcement ?? null
  if (reinforcement !== null) entries.push({ kind: 'reinforcement', node: reinforcement })

  const byLevel = {} as Record<ImportanceLevel, number>
  for (const level of catalog.ordered()) byLevel[level.level] = 0
  for (const entry of keptDue) byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1

  const counts: SessionCounts = {
    exam: keptExam.length,
    due: keptDue.length,
    relearning: keptRelearning.length,
    new: newEntries.length,
    reinforcement: reinforcement === null ? 0 : 1,
    total: entries.length,
    byLevel: Object.freeze(byLevel),
  }
  const cardCount = counts.exam + counts.due + counts.relearning + counts.new

  return {
    entries: Object.freeze(entries),
    counts,
    postponements: proposals,
    burials: Object.freeze(burials),
    overload: summary,
    estimatedMinutes:
      (cardCount * median) / 60 + (reinforcement === null ? 0 : reinforcement.estimatedMinutes),
    budgetMinutes: settings.budgetMinutes,
    streakGoalCards: settings.streakGoalCards,
    medianSecondsPerCard: median,
    backlogDays,
    newGated,
    finalDrill: settings.finalDrill,
    order: settings.order,
    seed,
    composedAt: now,
  }
}
