import type { ImportanceLevel, ImportanceLevelConfig, LeechAction } from '../entities'
import { IMPORTANCE_LEVELS } from '../entities'
import type { StepUnit } from './types'

/**
 * The five importance levels as a scheduling policy (`docs/spec/02-memory-system.md` §7).
 *
 * **Importance never changes S, D or R** — those are properties of the item-user pair. It
 * changes what is *asked of* the scheduler (desired retention, interval cap), what is
 * sacrificed under overload (order, postpone policy) and how much of the daily budget the
 * level consumes (new-item quota, leech policy). That is the whole of it
 * (`.claude/skills/fsrs-rules/SKILL.md`).
 *
 * The numbers live in `importance_levels` (seeded by migration `0001`) because the user can
 * tune them; the *semantics* of §7's "Under overload" and "New/day" columns are richer than
 * a boolean and an integer, so the code owns them here and merges the two into an
 * `ImportanceCatalog`.
 */

// --- §7's numeric bounds ----------------------------------------------------------------

/** §6: `ts-fsrs` allows 0.70–0.99; the schema CHECKs the same range. */
export const DESIRED_RETENTION_MIN = 0.7
export const DESIRED_RETENTION_MAX = 0.99

/** §7: "0.80–0.85 the floor of maintenance; below 0.80 the user perceives 'it is making me
 *  forget'." */
export const MAINTENANCE_RETENTION_MIN = 0.8
export const MAINTENANCE_RETENTION_MAX = 0.85

/** §7 rule 5: urgent mode's ceiling. Above this, "spaced repetition turns into massed
 *  repetition" (§6). */
export const URGENT_MODE_RETENTION = 0.97

/** §7 rule 5: urgent mode reviews the same day, twice. */
export const URGENT_MODE_STEPS: readonly StepUnit[] = Object.freeze(['10m', '1h'])

/** §7, urgent row: the desired retention rises to 0.97 inside the last week before the
 *  exam. */
export const URGENT_EXAM_WINDOW_DAYS = 7

/** §7 rule 4: "if everything is urgent, nothing is" — warn past this share of items. */
export const PRIORITY_BIAS_THRESHOLD = 0.3

/** §7 rule 3: overload protection multiplies the interval by this before postponing. */
export const POSTPONE_FACTOR = 1.1

// --- the policy the code owns -----------------------------------------------------------

/**
 * §7's "Under overload" column. `postpone_allowed` alone cannot say *when* or *in what
 * order*, and the daily session composer (sub-phase 4.3) needs both.
 */
export type PostponePolicy =
  /** Urgent: never postponed; may exceed the daily limit to catch up. */
  | 'never'
  /** Alta: only once the backlog is more than two days deep. */
  | 'backlog_only'
  /** Normal: factor 1.1, most stable items first (least damage). */
  | 'standard'
  /** Mantenimiento: postponed before anything else — SuperMemo's Mercy. */
  | 'first'
  /** Pausado: never in the queue, so there is nothing to postpone. */
  | 'not_queued'

/** §7's "New/day" column. The count itself is `newPerDay` on the row. */
export type NewItemPolicy =
  /** Urgent: no cap — the exam date drives how many must be introduced. */
  | 'unlimited'
  /** Alta: introduced before the other levels, within the quota. */
  | 'priority'
  /** Normal: the standard 10–20 a day. */
  | 'quota'
  /** Mantenimiento and Pausado: review only. */
  | 'none'

export interface ImportancePolicy {
  readonly level: ImportanceLevel
  readonly postpone: PostponePolicy
  readonly newItems: NewItemPolicy
  /** `false` for `paused`: out of the queue, but the clock keeps running. */
  readonly queued: boolean
  /** What the interval is multiplied by when overload protection postpones this level. */
  readonly postponeFactor: number
  /** Days of backlog before this level may be postponed at all. `Infinity` = never. */
  readonly backlogDaysBeforePostpone: number
}

export const IMPORTANCE_POLICIES: Readonly<Record<ImportanceLevel, ImportancePolicy>> =
  Object.freeze({
    urgent: Object.freeze({
      level: 'urgent',
      postpone: 'never',
      newItems: 'unlimited',
      queued: true,
      postponeFactor: 1,
      backlogDaysBeforePostpone: Number.POSITIVE_INFINITY,
    }),
    high: Object.freeze({
      level: 'high',
      postpone: 'backlog_only',
      newItems: 'priority',
      queued: true,
      postponeFactor: POSTPONE_FACTOR,
      backlogDaysBeforePostpone: 2,
    }),
    normal: Object.freeze({
      level: 'normal',
      postpone: 'standard',
      newItems: 'quota',
      queued: true,
      postponeFactor: POSTPONE_FACTOR,
      backlogDaysBeforePostpone: 0,
    }),
    maintenance: Object.freeze({
      level: 'maintenance',
      postpone: 'first',
      newItems: 'none',
      queued: true,
      postponeFactor: POSTPONE_FACTOR,
      backlogDaysBeforePostpone: 0,
    }),
    paused: Object.freeze({
      level: 'paused',
      postpone: 'not_queued',
      newItems: 'none',
      queued: false,
      postponeFactor: 1,
      backlogDaysBeforePostpone: Number.POSITIVE_INFINITY,
    }),
  } satisfies Record<ImportanceLevel, ImportancePolicy>)

// --- the stored half --------------------------------------------------------------------

/** The columns of `importance_levels` the catalog reads. */
export type ImportanceLevelValues = Pick<
  ImportanceLevelConfig,
  | 'desiredRetention'
  | 'maxIntervalDays'
  | 'orderRank'
  | 'postponeAllowed'
  | 'newPerDay'
  | 'leechThreshold'
  | 'leechAction'
>

/**
 * The seeded values of migration `0001`, duplicated here so `packages/core` — which cannot
 * reach a database — still has a working catalog, and so a test pins the two against each
 * other. §7's table, column for column.
 */
export const DEFAULT_IMPORTANCE_LEVELS: Readonly<Record<ImportanceLevel, ImportanceLevelValues>> =
  Object.freeze({
    urgent: Object.freeze({
      desiredRetention: 0.95,
      maxIntervalDays: 180,
      orderRank: 1,
      postponeAllowed: false,
      newPerDay: null,
      leechThreshold: 8,
      leechAction: 'warn' as LeechAction,
    }),
    high: Object.freeze({
      desiredRetention: 0.92,
      maxIntervalDays: 365,
      orderRank: 2,
      postponeAllowed: true,
      newPerDay: 20,
      leechThreshold: 8,
      leechAction: 'warn_rewrite' as LeechAction,
    }),
    normal: Object.freeze({
      desiredRetention: 0.9,
      maxIntervalDays: 1825,
      orderRank: 3,
      postponeAllowed: true,
      newPerDay: 15,
      leechThreshold: 8,
      leechAction: 'edit' as LeechAction,
    }),
    maintenance: Object.freeze({
      desiredRetention: 0.85,
      maxIntervalDays: 3650,
      orderRank: 4,
      postponeAllowed: true,
      newPerDay: 0,
      leechThreshold: 8,
      leechAction: 'suspend' as LeechAction,
    }),
    paused: Object.freeze({
      desiredRetention: null,
      maxIntervalDays: null,
      orderRank: 5,
      postponeAllowed: false,
      newPerDay: 0,
      leechThreshold: 8,
      leechAction: 'none' as LeechAction,
    }),
  } satisfies Record<ImportanceLevel, ImportanceLevelValues>)

/** The level the scheduler falls back to whenever nothing else says otherwise (§7: "Normal
 *  — default"). Also what `paused` borrows its arithmetic from, since it stores no
 *  retention of its own. */
export const DEFAULT_IMPORTANCE_LEVEL: ImportanceLevel = 'normal'

/** A level's stored numbers merged with the policy the code owns. */
export interface ImportanceLevelSettings extends ImportancePolicy, ImportanceLevelValues {}

export interface ImportanceCatalog {
  get(level: ImportanceLevel): ImportanceLevelSettings
  /** Every level, review order first — sub-phase 4.3's queue order (§12 step 2). */
  ordered(): readonly ImportanceLevelSettings[]
  /** Negative when `a` is reviewed before `b`. Ties break on the level's name so the sort
   *  is total and deterministic. */
  compare(a: ImportanceLevel, b: ImportanceLevel): number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Retentions are clamped into §7's range for the level, so a hand-edited or imported row
 *  can never produce options `assertSchedulingOptions` would reject. */
function normalizeRetention(level: ImportanceLevel, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return level === 'maintenance'
    ? clamp(value, MAINTENANCE_RETENTION_MIN, MAINTENANCE_RETENTION_MAX)
    : clamp(value, DESIRED_RETENTION_MIN, DESIRED_RETENTION_MAX)
}

/** `SchedulingOptions.maxIntervalDays` must be an integer ≥ 1 (`parameters.ts`). */
function normalizeMaxInterval(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.max(1, Math.floor(value))
}

function normalizeCount(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function settingsFor(
  level: ImportanceLevel,
  values: ImportanceLevelValues,
): ImportanceLevelSettings {
  const policy = IMPORTANCE_POLICIES[level]
  const fallback = DEFAULT_IMPORTANCE_LEVELS[level]
  return Object.freeze({
    ...policy,
    desiredRetention: normalizeRetention(level, values.desiredRetention),
    maxIntervalDays: normalizeMaxInterval(values.maxIntervalDays),
    orderRank: Number.isFinite(values.orderRank)
      ? Math.max(1, Math.floor(values.orderRank))
      : fallback.orderRank,
    postponeAllowed: values.postponeAllowed,
    newPerDay: normalizeCount(values.newPerDay),
    leechThreshold: Number.isFinite(values.leechThreshold)
      ? Math.max(1, Math.floor(values.leechThreshold))
      : fallback.leechThreshold,
    leechAction: values.leechAction,
  })
}

/**
 * Build the catalog. Stored rows win where they exist; any level the caller did not supply
 * falls back to §7's seeded numbers, so a catalog is always complete — a missing row can
 * never leave a card with no retention to aim at.
 *
 * Soft-deleted rows are ignored: a level is vocabulary, and "deleting" one means "fall back
 * to the spec", not "these cards are unschedulable".
 */
export function createImportanceCatalog(
  rows: readonly ImportanceLevelConfig[] = [],
): ImportanceCatalog {
  const settings = new Map<ImportanceLevel, ImportanceLevelSettings>()
  for (const level of IMPORTANCE_LEVELS) {
    settings.set(level, settingsFor(level, DEFAULT_IMPORTANCE_LEVELS[level]))
  }
  for (const row of rows) {
    if (row.deletedAt !== null) continue
    if (!settings.has(row.name)) continue
    settings.set(row.name, settingsFor(row.name, row))
  }

  const ordered = Object.freeze(
    [...settings.values()].sort(
      (a, b) => a.orderRank - b.orderRank || a.level.localeCompare(b.level),
    ),
  )
  const rank = new Map(ordered.map((entry, index) => [entry.level, index]))

  return {
    get: (level) => settings.get(level) as ImportanceLevelSettings,
    ordered: () => ordered,
    compare: (a, b) => (rank.get(a) as number) - (rank.get(b) as number),
  }
}

/** The catalog §7 describes, with no database behind it. */
export const DEFAULT_IMPORTANCE_CATALOG: ImportanceCatalog = createImportanceCatalog()
