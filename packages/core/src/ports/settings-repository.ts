import type { JsonValue } from '../entities'

/**
 * Application settings: a key/value store with a typed key registry.
 *
 * Secrets never live here. API keys and tokens go through Electron's `safeStorage` in the
 * main process (CLAUDE.md); `settings` is a plain JSON table that ends up in every backup
 * and, one day, in sync.
 */

/** The keys the app knows about, and the type each one holds. */
export interface SettingsMap {
  /** Stamped into every row's `device_id`; minted once on first run. */
  'app.deviceId': string
  'app.locale': 'es-AR' | 'en'
  'app.telemetryEnabled': boolean
  'ui.theme': 'light' | 'dark' | 'system'
  /** Gamification off: no XP toasts, no mascot, no confetti (`docs/spec/08-ux.md` §3). */
  'ui.soberMode': boolean
  'review.dailyNewLimit': number
  'review.dailyReviewLimit': number
  /** How many minutes a day the user wants to spend reviewing — the budget overload
   *  protection measures the queue against (`docs/spec/02-memory-system.md` §12). */
  'review.budgetMinutes': number
  /** The "bad day" floor: the smallest number of cards that still keeps the streak (§12). */
  'review.streakGoalCards': number
  /** §12 step 4: one new card every N reviews. The spec's range is 3–5. */
  'review.newEveryNReviews': number
  /** §12 step 2: relative overdueness, or ascending retrievability (Anki 24.11's
   *  "better when there is a backlog"). */
  'review.queueOrder': 'relative_overdueness' | 'retrievability'
  /** §12 step 6: everything graded Again/Hard today comes back at the end. Urgent mode
   *  turns it on regardless. */
  'review.finalDrill': boolean
  /** The hour a "day" rolls over, so a 1 a.m. session counts as the previous day. */
  'review.dayStartHour': number
  /** Two-button review screen (Forgot/Remembered, mapped to Again/Good) instead of the four
   *  FSRS grades (`docs/spec/02-memory-system.md` §6 "Mochi (2 buttons)"). */
  'review.simpleGrading': boolean
  'ai.budget.monthlyUsd': number
  'ai.providers.allowlist': string[]
  /** Whether repository mutations enqueue `outbox` rows. Off in v1 — there is nothing to
   *  sync to yet (`docs/spec/07-architecture.md` §6). */
  'sync.outboxEnabled': boolean
}

export type SettingsKey = keyof SettingsMap

/**
 * How one key is stored and what it falls back to. `decode` returns `undefined` for
 * anything that is not a valid value, so a row written by a newer version — or corrupted —
 * degrades to the default instead of poisoning the caller.
 */
export interface SettingSpec<T> {
  readonly defaultValue: T
  decode(raw: JsonValue): T | undefined
  encode(value: T): JsonValue
}

function booleanSetting(defaultValue: boolean): SettingSpec<boolean> {
  return {
    defaultValue,
    decode: (raw) => (typeof raw === 'boolean' ? raw : undefined),
    encode: (value) => value,
  }
}

function stringSetting(defaultValue: string): SettingSpec<string> {
  return {
    defaultValue,
    decode: (raw) => (typeof raw === 'string' ? raw : undefined),
    encode: (value) => value,
  }
}

function numberIn(min: number, max: number, defaultValue: number): SettingSpec<number> {
  return {
    defaultValue,
    decode: (raw) =>
      typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? raw : undefined,
    encode: (value) => value,
  }
}

function oneOf<const T extends string>(values: readonly T[], defaultValue: T): SettingSpec<T> {
  return {
    defaultValue,
    decode: (raw) =>
      typeof raw === 'string' && values.includes(raw as T) ? (raw as T) : undefined,
    encode: (value) => value,
  }
}

function stringArray(defaultValue: string[]): SettingSpec<string[]> {
  return {
    defaultValue,
    decode: (raw) =>
      Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')
        ? (raw as string[])
        : undefined,
    encode: (value) => [...value],
  }
}

/**
 * The registry. Being a *total* mapped type over `SettingsMap`, adding a key to the
 * interface without adding its spec here is a compile error.
 */
export const SETTINGS: { readonly [K in SettingsKey]: SettingSpec<SettingsMap[K]> } = {
  'app.deviceId': stringSetting(''),
  'app.locale': oneOf(['es-AR', 'en'], 'es-AR'),
  'app.telemetryEnabled': booleanSetting(false),
  'ui.theme': oneOf(['light', 'dark', 'system'], 'system'),
  'ui.soberMode': booleanSetting(false),
  'review.dailyNewLimit': numberIn(0, 9999, 15),
  'review.dailyReviewLimit': numberIn(0, 99999, 200),
  'review.budgetMinutes': numberIn(1, 1440, 20),
  'review.streakGoalCards': numberIn(1, 9999, 10),
  'review.newEveryNReviews': numberIn(3, 5, 4),
  'review.queueOrder': oneOf(['relative_overdueness', 'retrievability'], 'relative_overdueness'),
  'review.finalDrill': booleanSetting(false),
  'review.dayStartHour': numberIn(0, 23, 4),
  'review.simpleGrading': booleanSetting(false),
  'ai.budget.monthlyUsd': numberIn(0, 100000, 30),
  'ai.providers.allowlist': stringArray([]),
  'sync.outboxEnabled': booleanSetting(false),
}

/** What `get` returns when a key was never written (or holds an unreadable value). */
export const SETTINGS_DEFAULTS: { readonly [K in SettingsKey]: SettingsMap[K] } = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTINGS).map(([key, spec]) => [
      key,
      (spec as SettingSpec<unknown>).defaultValue,
    ]),
  ),
) as { readonly [K in SettingsKey]: SettingsMap[K] }

export interface SettingsRepository {
  /** Never throws and never returns undefined: falls back to the key's default when the
   *  row is missing or holds a value `decode` rejects. */
  get<K extends SettingsKey>(key: K): Promise<SettingsMap[K]>
  /** Only the registered keys that are actually stored — what the settings screen marks
   *  as "modified". */
  getStored(): Promise<Partial<SettingsMap>>
  /** Raw access for keys outside the registry (feature flags, a newer version's settings).
   *  Returns `undefined` rather than a default. */
  getRaw(key: string): Promise<JsonValue | undefined>
  set<K extends SettingsKey>(key: K, value: SettingsMap[K]): Promise<void>
  setRaw(key: string, value: JsonValue): Promise<void>
  /** Every live setting, registered or not, for "export diagnostics". Unknown keys are
   *  preserved, never pruned: a downgrade must not destroy the newer version's settings. */
  all(): Promise<Record<string, JsonValue>>
  /** Soft-deletes the key, so `get` returns the default again. */
  unset(key: string): Promise<void>
}
