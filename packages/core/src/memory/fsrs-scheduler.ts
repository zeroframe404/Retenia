import {
  type FSRS,
  type Card as FsrsCard,
  type Grade as FsrsGrade,
  fsrs,
  type RecordLogItem,
} from 'ts-fsrs'
import type { Card } from '../entities'
import { resolveEasyDayCalendar } from './easy-days'
import { clampParameters, forgettingCurve, fuzzRange, intervalForRetention } from './formulas'
import { fromFsrsCard, toFsrsCard, toFsrsReviewLog } from './mappers'
import { assertSchedulingOptions, DEFAULT_FSRS_W, DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { fuzzSeed, mulberry32 } from './prng'
import {
  DAY_MS,
  type DayBoundary,
  HOUR_MS,
  resolveDayBoundary,
  timeZoneOffsetAtMs,
} from './study-day'
import {
  CARD_STATE,
  GRADES,
  type Grade,
  type MemoryState,
  type ReviewHistoryEntry,
  type ReviewLogDraft,
  SCHEDULER_ALGORITHM_VERSION,
  type Scheduler,
  type SchedulingOptions,
  type SchedulingPreview,
  type SchedulingResult,
} from './types'

/**
 * FSRS-6 via `ts-fsrs` 5.4.2 (`docs/spec/02-memory-system.md` §1, §5, §15).
 *
 * What the wrapper adds to `ts-fsrs`:
 *
 * - **One `fsrs()` per distinct `SchedulingOptions`**, memoized by a stable key. Every
 *   importance level and every active exam asks for its own retention and cap (§7 rule 1:
 *   "instantiating one `fsrs()` per level is cheap"), and the parameters `w` are fixed per
 *   scheduler (one per `scheduler_profiles` row).
 * - **Day boundaries.** `ts-fsrs` counts elapsed days on UTC calendar dates. Retenia counts
 *   study days that roll over at `day_start_hour` in the user's zone (§14). Every timestamp
 *   is shifted into that frame before `ts-fsrs` sees it and shifted back after, so "same
 *   day" for the short-term formulas is the study day, and a 1 a.m. review still belongs
 *   to the evening before.
 * - **Deterministic fuzz, load balancing and easy days** (§3.2 (i), §4, §15). `ts-fsrs`
 *   runs with its own fuzz off; the wrapper applies the window of `fuzzRange` itself, with
 *   mulberry32 seeded per card and review, so the same review lands on the same day on
 *   every device. Within that window the load balancer and easy days choose the day, as
 *   Anki does — after the interval, never touching S or D.
 * - **The log rows** carry `algorithm_version = 'fsrs6'` and the domain card's own
 *   before-values, which the schema (`review_logs`) and `rollback` rely on.
 */

export interface FsrsSchedulerConfig {
  /** `w0…w20`; the FSRS-6 defaults unless a profile was optimized. Clamped to §3.3. */
  w?: readonly number[]
  /** `enable_short_term`: apply the same-day formulas and (re)learning steps. Default on. */
  enableShortTerm?: boolean
  /** `day_start_hour`, 0–23. Default 4 (§14). */
  dayStartHour?: number
  /** IANA zone the study day is computed in. Default `UTC`. */
  timeZone?: string
}

/** Bounds the memoized `fsrs()` instances: an exam that ramps its retention daily would
 *  otherwise leave one behind per day. Plenty for the five levels plus every live exam. */
const INSTANCE_CACHE_LIMIT = 64

/** `ts-fsrs` does not fuzz an interval under 2.5 days; neither is there a window to
 *  balance inside. */
const FUZZ_THRESHOLD_DAYS = 2.5

interface ReviewContext {
  readonly card: Card
  readonly nowMs: number
  /** `now` in the study frame — what `ts-fsrs` was handed as the review time. */
  readonly shiftedNow: Date
  readonly options: SchedulingOptions
  /** Whole study days since the last review; negative if the clock stepped back. */
  readonly elapsedDays: number
}

type GradeItems = Partial<Record<Grade, RecordLogItem>>

function assertGrade(grade: unknown): asserts grade is Grade {
  if (grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) {
    throw new RangeError(`grade must be 1 (Again) … 4 (Easy), got ${String(grade)}`)
  }
}

function assertDate(name: string, date: Date): number {
  const ms = date instanceof Date ? date.getTime() : Number.NaN
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be a valid Date`)
  return ms
}

function assertCard(card: Card): void {
  if (
    card.state !== CARD_STATE.New &&
    card.state !== CARD_STATE.Learning &&
    card.state !== CARD_STATE.Review &&
    card.state !== CARD_STATE.Relearning
  ) {
    throw new RangeError(`card ${card.id} has an unknown state ${String(card.state)}`)
  }
  assertDate('card.due', card.due)
  if (card.lastReview !== null) assertDate('card.lastReview', card.lastReview)
}

export class FsrsScheduler implements Scheduler {
  readonly id = 'fsrs6'
  /** The parameters in force, clamped. */
  readonly w: readonly number[]
  readonly enableShortTerm: boolean
  readonly dayBoundary: DayBoundary
  private readonly instances = new Map<string, FSRS>()
  /** Options objects are configuration — a level's, an exam's — and are treated as
   *  immutable: their validated cache key is remembered per object. */
  private readonly optionKeys = new WeakMap<SchedulingOptions, string>()

  constructor(config: FsrsSchedulerConfig = {}) {
    this.w = Object.freeze(clampParameters(config.w ?? DEFAULT_FSRS_W))
    this.enableShortTerm = config.enableShortTerm ?? true
    this.dayBoundary = resolveDayBoundary({
      dayStartHour: config.dayStartHour,
      timeZone: config.timeZone,
    })
  }

  /** How many `fsrs()` instances are alive — one per distinct options seen so far. */
  get instanceCount(): number {
    return this.instances.size
  }

  preview(card: Card, now: Date, options: SchedulingOptions): SchedulingPreview {
    const ctx = this.prepare(card, now, options)
    const items = this.previewItems(ctx)
    this.finalize(items, ctx)
    return {
      1: this.toResult(items[1] as RecordLogItem, ctx),
      2: this.toResult(items[2] as RecordLogItem, ctx),
      3: this.toResult(items[3] as RecordLogItem, ctx),
      4: this.toResult(items[4] as RecordLogItem, ctx),
    }
  }

  apply(card: Card, now: Date, grade: Grade, options: SchedulingOptions): SchedulingResult {
    assertGrade(grade)
    const ctx = this.prepare(card, now, options)
    // In `Review`, ts-fsrs computes all four buttons anyway and orders their intervals
    // (Hard < Good < Easy); the fuzz pass has to see all four to keep that order.
    const items: GradeItems =
      card.state === CARD_STATE.Review
        ? this.previewItems(ctx)
        : { [grade]: this.instanceFor(options).next(ctx.input, ctx.shiftedNow, grade as FsrsGrade) }
    this.finalize(items, ctx)
    return this.toResult(items[grade] as RecordLogItem, ctx)
  }

  retrievability(card: Card, at: Date): number {
    assertCard(card)
    assertDate('at', at)
    if (card.state === CARD_STATE.New || card.lastReview === null || !(card.stability > 0)) {
      return 0
    }
    const elapsed = Math.max(0, this.elapsedDays(card, at))
    return forgettingCurve(elapsed, card.stability, this.w[20] as number)
  }

  intervalFor(retention: number, state: Pick<MemoryState, 'stability'>): number {
    return intervalForRetention(retention, state.stability, this.w[20] as number)
  }

  reschedule(card: Card, history: readonly ReviewHistoryEntry[], options: SchedulingOptions): Card {
    assertCard(card)
    assertSchedulingOptions(options)
    const graded = history.filter((entry) => entry.rating !== 0)
    for (const entry of graded) assertGrade(entry.rating)
    if (graded.length === 0) return card
    const ordered = [...graded].sort((a, b) => a.review.getTime() - b.review.getTime())

    let current: Card = {
      ...card,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: CARD_STATE.New,
      lastReview: null,
    }
    for (const entry of ordered) {
      current = this.apply(current, entry.review, entry.rating as Grade, options).card
    }
    return current
  }

  rollback(card: Card, log: ReviewLogDraft): Card {
    assertCard(card)
    if (log.rating === 0) {
      throw new RangeError('A manual entry (postpone or forget) cannot be rolled back')
    }
    const previous = this.instanceFor(DEFAULT_SCHEDULING_OPTIONS).rollback(
      toFsrsCard(card),
      toFsrsReviewLog(log),
    )
    return fromFsrsCard(previous, card)
  }

  forget(card: Card, now: Date, resetCounts: boolean): SchedulingResult {
    assertCard(card)
    const nowMs = assertDate('now', now)
    const item = this.instanceFor(DEFAULT_SCHEDULING_OPTIONS).forget(
      toFsrsCard(card),
      new Date(nowMs),
      resetCounts,
    )
    return {
      card: fromFsrsCard(item.card, card),
      log: {
        cardId: card.id,
        rating: 0,
        state: card.state,
        due: new Date(card.due.getTime()),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsedDays: 0,
        // ts-fsrs writes the days between the old due date and now here, which can be
        // negative; the schema (and every other log) wants the interval that was booked.
        scheduledDays: card.scheduledDays,
        learningSteps: card.learningSteps,
        review: new Date(nowMs),
        algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
      },
    }
  }

  postpone(card: Card, now: Date, due: Date): SchedulingResult {
    assertCard(card)
    const nowMs = assertDate('now', now)
    const dueMs = assertDate('due', due)
    return {
      card: {
        ...card,
        due: new Date(dueMs),
        scheduledDays: Math.max(0, this.dayNumber(dueMs) - this.dayNumber(nowMs)),
      },
      log: {
        cardId: card.id,
        rating: 0,
        state: card.state,
        due: new Date((card.lastReview ?? card.due).getTime()),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsedDays: this.elapsedDays(card, now),
        scheduledDays: card.scheduledDays,
        learningSteps: card.learningSteps,
        review: new Date(nowMs),
        algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
      },
    }
  }

  /** Whole study days since the card's last review, 0 for a card never reviewed. May be
   *  negative when the clock stepped back — the log keeps the truth (`07a-schema.md`). */
  elapsedDays(card: Card, now: Date): number {
    if (card.state === CARD_STATE.New || card.lastReview === null) return 0
    return this.dayNumber(assertDate('now', now)) - this.dayNumber(card.lastReview.getTime())
  }

  /** The study day of an instant, as `studyDayNumber` counts it, over a validated
   *  boundary and a timestamp already known to be valid. */
  private dayNumber(ms: number): number {
    return Math.floor(this.shift(ms) / DAY_MS)
  }

  /** The validated cache key of an options object, remembered per object. */
  private keyFor(options: SchedulingOptions): string {
    let key = this.optionKeys.get(options)
    if (key === undefined) {
      assertSchedulingOptions(options)
      key = [
        options.desiredRetention,
        options.maxIntervalDays,
        options.learningSteps.join(','),
        options.relearningSteps.join(','),
      ].join('|')
      this.optionKeys.set(options, key)
    }
    return key
  }

  /** One `fsrs()` per distinct options, built on first use and kept. */
  private instanceFor(options: SchedulingOptions): FSRS {
    const key = this.keyFor(options)
    let instance = this.instances.get(key)
    if (instance === undefined) {
      if (this.instances.size >= INSTANCE_CACHE_LIMIT) {
        const oldest = this.instances.keys().next().value as string
        this.instances.delete(oldest)
      }
      instance = fsrs({
        w: [...this.w],
        request_retention: options.desiredRetention,
        maximum_interval: options.maxIntervalDays,
        learning_steps: [...options.learningSteps],
        relearning_steps: [...options.relearningSteps],
        // The wrapper fuzzes (seeded per card) — see `finalize`.
        enable_fuzz: false,
        enable_short_term: this.enableShortTerm,
      })
      this.instances.set(key, instance)
    }
    return instance
  }

  /** Into the study frame: UTC calendar dates there are study days here. */
  private shift(ms: number): number {
    const { dayStartHour, timeZone } = this.dayBoundary
    return ms + timeZoneOffsetAtMs(ms, timeZone) - dayStartHour * HOUR_MS
  }

  private prepare(
    card: Card,
    now: Date,
    options: SchedulingOptions,
  ): ReviewContext & { input: FsrsCard } {
    assertCard(card)
    const nowMs = assertDate('now', now)
    this.keyFor(options)
    const shiftedNowMs = this.shift(nowMs)

    // A last review after `now` is a clock step, not the future: ts-fsrs would refuse a
    // negative delta, so it sees a same-day review while the log keeps the real value.
    let elapsedDays = 0
    let shiftedLastReview: Date | null = null
    if (card.state !== CARD_STATE.New && card.lastReview !== null) {
      const lastReviewMs = card.lastReview.getTime()
      const shiftedLastMs = this.shift(lastReviewMs)
      elapsedDays = Math.floor(shiftedNowMs / DAY_MS) - Math.floor(shiftedLastMs / DAY_MS)
      shiftedLastReview = new Date(Math.min(shiftedLastMs, shiftedNowMs))
    } else if (card.lastReview !== null) {
      shiftedLastReview = new Date(Math.min(this.shift(card.lastReview.getTime()), shiftedNowMs))
    }
    const input = toFsrsCard({
      ...card,
      due: new Date(this.shift(card.due.getTime())),
      lastReview: shiftedLastReview,
    })
    return { card, nowMs, shiftedNow: new Date(shiftedNowMs), options, elapsedDays, input }
  }

  private previewItems(ctx: ReviewContext & { input: FsrsCard }): GradeItems {
    const preview = this.instanceFor(ctx.options).repeat(ctx.input, ctx.shiftedNow)
    return { 1: preview[1], 2: preview[2], 3: preview[3], 4: preview[4] }
  }

  /**
   * The window pass: fuzz, load balancing and easy days over every day-based interval,
   * then ts-fsrs's Hard < Good < Easy ordering for a card that was in `Review`.
   */
  private finalize(items: GradeItems, ctx: ReviewContext): void {
    const { options } = ctx
    if (
      !options.fuzz &&
      options.loadBalance === undefined &&
      options.easyDays === undefined &&
      options.easyDates === undefined
    ) {
      return
    }
    const elapsedForFuzz = Math.max(0, ctx.elapsedDays)
    let draw: (() => number) | undefined
    const random = (): number => {
      draw ??= mulberry32(fuzzSeed(ctx.card.id, ctx.card.reps))
      return draw()
    }

    const chosen: Partial<Record<Grade, number>> = {}
    for (const grade of GRADES) {
      const item = items[grade]
      if (item === undefined) continue
      const { state, scheduled_days: base } = item.card
      if (state !== CARD_STATE.Review || base < 1) continue
      if (base < FUZZ_THRESHOLD_DAYS) {
        chosen[grade] = base
        continue
      }
      const window = fuzzRange(base, elapsedForFuzz, options.maxIntervalDays)
      chosen[grade] = this.pickDay(base, window.min, window.max, ctx, random)
    }

    if (ctx.card.state === CARD_STATE.Review) {
      // ts-fsrs books Hard, Good and Easy of a reviewed card by days, always (its
      // `reviewState`), so all three are in `chosen`; the parity tests pin that.
      const hard = Math.min(chosen[2] as number, chosen[3] as number)
      const good = Math.max(chosen[3] as number, hard + 1)
      chosen[2] = hard
      chosen[3] = good
      chosen[4] = Math.max(chosen[4] as number, good + 1)
    }

    for (const grade of GRADES) {
      const item = items[grade]
      const days = chosen[grade]
      if (item === undefined || days === undefined) continue
      item.card.scheduled_days = days
      item.card.due = new Date(ctx.shiftedNow.getTime() + days * DAY_MS)
    }
  }

  /**
   * A day in `[min, max]` for an interval ts-fsrs booked as `base`: the balancer's choice
   * when it names a day of the window; otherwise a seeded uniform draw when fuzz is on, or
   * the allowed day nearest to `base` when it is off — easy days then move a due date by
   * the smallest margin that avoids the user's minimum days, and never at random.
   */
  private pickDay(
    base: number,
    min: number,
    max: number,
    ctx: ReviewContext,
    random: () => number,
  ): number {
    const { options } = ctx
    if (
      options.easyDays === undefined &&
      options.easyDates === undefined &&
      options.loadBalance === undefined
    ) {
      // Plain fuzz (only reached with fuzz on): ts-fsrs's own draw over the window.
      return Math.min(max, min + Math.floor(random() * (max - min + 1)))
    }
    let candidates: number[] = []
    for (let day = min; day <= max; day++) candidates.push(day)

    if (options.easyDays !== undefined || options.easyDates !== undefined) {
      // `minimum` needs no tier of its own: every candidate is exactly one of the three
      // levels, so once `normal` and `reduced` are both empty the remaining candidates
      // *are* the minimum days, and the fallback already returns them. A card whose whole
      // window is minimum still has to land somewhere.
      const calendar = resolveEasyDayCalendar(options, this.dayBoundary)
      const level = (day: number) => calendar.levelFor(new Date(ctx.nowMs + day * DAY_MS))
      const normal = candidates.filter((day) => level(day) === 'normal')
      const reduced = candidates.filter((day) => level(day) === 'reduced')
      candidates = normal.length > 0 ? normal : reduced.length > 0 ? reduced : candidates
    }

    if (options.loadBalance !== undefined) {
      const dates = candidates.map((day) => new Date(ctx.nowMs + day * DAY_MS))
      const picked = options.loadBalance(dates)
      const pickedMs = picked instanceof Date ? picked.getTime() : Number.NaN
      const index = dates.findIndex((date) => date.getTime() === pickedMs)
      if (index >= 0) return candidates[index] as number
    }

    if (options.fuzz) {
      return candidates[
        Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
      ] as number
    }
    let nearest = candidates[0] as number
    for (const day of candidates) {
      if (Math.abs(day - base) < Math.abs(nearest - base)) nearest = day
    }
    return nearest
  }

  private toResult(item: RecordLogItem, ctx: ReviewContext): SchedulingResult {
    const { card, nowMs } = ctx
    // ts-fsrs stamps `last_review = now` and books `due` relative to it, both in the
    // study frame; the same shift takes them back, so `due − now` is preserved exactly.
    const delta = ctx.shiftedNow.getTime() - nowMs
    const after = fromFsrsCard(
      {
        ...item.card,
        due: new Date(item.card.due.getTime() - delta),
        last_review: new Date(nowMs),
      },
      card,
    )
    return {
      card: after,
      log: {
        cardId: card.id,
        rating: item.log.rating as Grade,
        state: card.state,
        // As in ts-fsrs: the previous `last_review`, or the due date of a card never
        // reviewed — what `rollback` restores.
        due: new Date((card.lastReview ?? card.due).getTime()),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsedDays: ctx.elapsedDays,
        scheduledDays: card.scheduledDays,
        learningSteps: card.learningSteps,
        review: new Date(nowMs),
        algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
      },
    }
  }
}

/** `new FsrsScheduler(config)`, for callers that prefer a factory. */
export function createFsrsScheduler(config: FsrsSchedulerConfig = {}): FsrsScheduler {
  return new FsrsScheduler(config)
}
