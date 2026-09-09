import type { JsonValue } from '../entities'
import type { EasyDates, EasyDayLevel, EasyDays } from '../memory/types'

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
  /**
   * §4/§15: within the fuzz window, book the day with the fewest cards already due.
   *
   * Anki 24.11's load balancer. Off means the plain seeded fuzz draw, which is what every
   * review before this setting existed used.
   */
  'review.loadBalance': boolean
  /** §4 "Easy days": per weekday, how much the scheduler may book. A day with no entry is
   *  `normal`. */
  'review.easyDays': EasyDays
  /** §4's "and specific dates": `YYYY-MM-DD` → level, beating that date's weekday. */
  'review.easyDates': EasyDates
  /** The monthly cap in USD. **0 means no cap**, not "block every call". */
  'ai.budget.monthlyUsd': number
  /**
   * Whether reaching the cap refuses further calls, or only warns
   * (`docs/spec/06-ai-providers.md` §6: "optional blocking"). On by default: a cap nothing
   * enforces is a number that only looks like a control. A caller with the user's explicit
   * consent for one call overrides it per call rather than by flipping this.
   */
  'ai.budget.hardBlock': boolean
  /** Profile ids `packages/ai` may route to. Empty means "all of them". */
  'ai.providers.allowlist': string[]
  /**
   * The local text-generation server (Ollama or LM Studio,
   * `docs/spec/06-ai-providers.md` §7), OpenAI-compatible on this base URL.
   *
   * Distinct from `retrieval.ollamaBaseUrl`: that one is the embedding server §6's RAG
   * pipeline reaches, and changing it triggers a reindex. This one only ever backs a
   * `packages/ai` chat/completion role, and changing it is free — there is nothing to
   * migrate.
   */
  'ai.providers.local.baseUrl': string
  /** The model tag that server has loaded. Empty means "no local provider is configured". */
  'ai.providers.local.model': string
  /**
   * Which `ProviderRole`s try the local model first, falling back to that role's ordinary
   * cloud chain on any error or timeout (`docs/spec/06-ai-providers.md` §7: "'local' is just
   * one more provider, opt-in, with a cloud fallback"). A plain `string[]` rather than
   * `ProviderRole[]`: `packages/core` cannot import `@retenia/ai`, whose package depends on
   * this one and not the other way around, so an entry that does not name a real role is
   * simply never matched by whoever composes the registry.
   */
  'ai.providers.local.preferRoles': string[]
  /**
   * Per-role model assignment from the settings screen, keyed by role name as a plain
   * string (same reasoning as `ai.providers.local.preferRoles`: `packages/core` cannot
   * import `@retenia/ai`'s `ProviderRole`/`RoleMap`). An absent or empty entry for a role
   * means "keep `DEFAULT_ROLES`", never "unset that role" — a user who never opens the
   * role editor keeps working exactly as before this setting existed.
   */
  'ai.roles': Record<string, RoleAssignmentValue>
  /**
   * User-edited overrides on top of the shipped `pricing.json`, keyed by
   * `${kind}:${modelId}`. Empty means "use the shipped table as-is"; this is what
   * "Restaurar" clears back to (`docs/spec/08-ux.md` §2: "Precios" editor).
   */
  'ai.pricing.overlay': Record<string, PricingOverlayEntryValue>
  /**
   * The last budget threshold (0/80/100) the user was already alerted about, and which
   * month that alert was for — so `onBudgetEvent` fires once per threshold per month
   * instead of on every call after the cap is crossed.
   */
  'ai.budget.lastAlertedThreshold': BudgetAlertLatch
  /**
   * Which embedding space the library is indexed in — a catalog model id
   * (`embeddinggemma-300m`, `bge-m3`) or `ollama` for a local server
   * (`docs/spec/05-ingestion-rag.md` §3).
   *
   * Changing it is a reindex: `sources.embedding_model_id` stops matching and the startup
   * sweep re-embeds every source, dropping the old vectors first. That is why it is a
   * setting and not a per-query argument — two spaces must never answer one query.
   */
  'retrieval.embeddingModel': string
  /** Base URL of the OpenAI-compatible server used when the model is `ollama`. */
  'retrieval.ollamaBaseUrl': string
  /** The tag that server knows the model by, and the width it returns. */
  'retrieval.ollamaModel': string
  'retrieval.ollamaDims': number
  /** Execution provider to try first for the local models; `auto` picks (see
   *  `resolveDevices`). */
  'retrieval.device': 'auto' | 'webgpu' | 'cuda' | 'dml' | 'cpu'
  /**
   * Keep the exact float vectors beside the int8 ones, so a KNN query can rescore its
   * candidates exactly. 4× the index on disk for the ~10 % of the true top-50 a quantized
   * scan misses (`packages/db/src/search.ts`).
   */
  'retrieval.preciseVectors': boolean
  /**
   * Run the local cross-encoder over the fused candidates. Off by default: it is the best
   * single lever on result quality and it costs 0.2–1 s per 20 documents on CPU, which the
   * user should opt into rather than discover.
   */
  'retrieval.rerankerEnabled': boolean
  /** Which reranker, when one is enabled. A catalog model id. */
  'retrieval.rerankerModel': string
  /** Whether repository mutations enqueue `outbox` rows. Off in v1 — there is nothing to
   *  sync to yet (`docs/spec/07-architecture.md` §6). */
  'sync.outboxEnabled': boolean
}

/** One role's primary + fallback profile/model choices, as stored under `ai.roles`. */
export interface RoleAssignmentValue {
  primary: { profileId: string; modelId: string } | null
  fallbacks: Array<{ profileId: string; modelId: string }>
}

/** One model's rate overrides, as stored under `ai.pricing.overlay`. `null` fields fall
 *  back to the shipped table's rate for that field — only the edited ones are set. */
export interface PricingOverlayEntryValue {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite5m: number | null
  cacheWrite1h: number | null
  batchDiscount: number | null
  /** ISO day (`YYYY-MM-DD`) the override was entered. */
  asOf: string
}

/** `threshold: 0` means "no alert issued yet this month". */
export interface BudgetAlertLatch {
  /** `YYYY-MM`, or `''` before the first alert ever fires. */
  period: string
  threshold: 0 | 80 | 100
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

const EASY_DAY_LEVEL_VALUES: readonly EasyDayLevel[] = ['normal', 'reduced', 'minimum']

function isEasyDayLevel(value: unknown): value is EasyDayLevel {
  return typeof value === 'string' && EASY_DAY_LEVEL_VALUES.includes(value as EasyDayLevel)
}

/**
 * Parse a `key → EasyDayLevel` map, keeping only the entries `isKey` accepts.
 *
 * Unreadable entries are dropped rather than rejecting the whole map: a single stray key —
 * a weekday 7 written by a bug, a date in a newer format — should cost the user that one
 * entry, not their entire easy-day configuration.
 */
function parseEasyDayMap(
  raw: JsonValue,
  isKey: (key: string) => boolean,
): Record<string, EasyDayLevel> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const kept: Record<string, EasyDayLevel> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isKey(key) && isEasyDayLevel(value)) kept[key] = value
  }
  return kept
}

/** `0`–`6`, the JavaScript weekday numbers, as JSON hands object keys back: strings. */
function isWeekdayKey(key: string): boolean {
  return /^[0-6]$/.test(key)
}

/** `YYYY-MM-DD`, and a real calendar date: `2026-02-30` is a typo, not a holiday. */
function isStudyDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const at = Date.parse(`${key}T00:00:00Z`)
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === key
}

function isProfileModelPair(value: unknown): value is { profileId: string; modelId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).profileId === 'string' &&
    typeof (value as Record<string, unknown>).modelId === 'string'
  )
}

function isRoleAssignmentValue(value: unknown): value is RoleAssignmentValue {
  if (typeof value !== 'object' || value === null) return false
  const { primary, fallbacks } = value as Record<string, unknown>
  const primaryOk = primary === null || isProfileModelPair(primary)
  const fallbacksOk = Array.isArray(fallbacks) && fallbacks.every(isProfileModelPair)
  return primaryOk && fallbacksOk
}

/** `key → RoleAssignmentValue`, dropping any entry that doesn't parse rather than
 *  rejecting the whole map — one corrupted role should not reset every role's assignment. */
const roleAssignmentsSetting: SettingSpec<Record<string, RoleAssignmentValue>> = {
  defaultValue: Object.freeze({}),
  decode: (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
    const kept: Record<string, RoleAssignmentValue> = {}
    for (const [role, value] of Object.entries(raw)) {
      if (isRoleAssignmentValue(value)) kept[role] = value
    }
    return kept
  },
  encode: (value) => value as unknown as JsonValue,
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isPricingOverlayEntryValue(value: unknown): value is PricingOverlayEntryValue {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    isNullableNumber(entry.input) &&
    isNullableNumber(entry.output) &&
    isNullableNumber(entry.cacheRead) &&
    isNullableNumber(entry.cacheWrite5m) &&
    isNullableNumber(entry.cacheWrite1h) &&
    isNullableNumber(entry.batchDiscount) &&
    typeof entry.asOf === 'string'
  )
}

/** `modelKey → PricingOverlayEntryValue`. Same drop-bad-entries reasoning as
 *  `roleAssignmentsSetting`. */
const pricingOverlaySetting: SettingSpec<Record<string, PricingOverlayEntryValue>> = {
  defaultValue: Object.freeze({}),
  decode: (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
    const kept: Record<string, PricingOverlayEntryValue> = {}
    for (const [modelKey, value] of Object.entries(raw)) {
      if (isPricingOverlayEntryValue(value)) kept[modelKey] = value
    }
    return kept
  },
  encode: (value) => value as unknown as JsonValue,
}

const BUDGET_THRESHOLDS = [0, 80, 100] as const

function isBudgetAlertLatch(value: unknown): value is BudgetAlertLatch {
  if (typeof value !== 'object' || value === null) return false
  const { period, threshold } = value as Record<string, unknown>
  return (
    typeof period === 'string' &&
    (period === '' || /^\d{4}-\d{2}$/.test(period)) &&
    typeof threshold === 'number' &&
    (BUDGET_THRESHOLDS as readonly number[]).includes(threshold)
  )
}

const budgetAlertLatchSetting: SettingSpec<BudgetAlertLatch> = {
  defaultValue: Object.freeze({ period: '', threshold: 0 }),
  decode: (raw) => (isBudgetAlertLatch(raw) ? raw : undefined),
  encode: (value) => ({ ...value }),
}

const easyDaysSetting: SettingSpec<EasyDays> = {
  defaultValue: Object.freeze({}),
  // The weekday keys are numbers in `EasyDays` and strings in JSON; the cast is that gap,
  // and `isWeekdayKey` is what makes it sound.
  decode: (raw) => parseEasyDayMap(raw, isWeekdayKey) as EasyDays | undefined,
  encode: (value) => ({ ...value }),
}

const easyDatesSetting: SettingSpec<EasyDates> = {
  defaultValue: Object.freeze({}),
  decode: (raw) => parseEasyDayMap(raw, isStudyDateKey),
  encode: (value) => ({ ...value }),
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
  'review.loadBalance': booleanSetting(true),
  'review.easyDays': easyDaysSetting,
  'review.easyDates': easyDatesSetting,
  'ai.budget.monthlyUsd': numberIn(0, 100000, 30),
  'ai.budget.hardBlock': booleanSetting(true),
  'ai.providers.allowlist': stringArray([]),
  'ai.providers.local.baseUrl': stringSetting('http://127.0.0.1:11434'),
  'ai.providers.local.model': stringSetting(''),
  'ai.providers.local.preferRoles': stringArray([]),
  'ai.roles': roleAssignmentsSetting,
  'ai.pricing.overlay': pricingOverlaySetting,
  'ai.budget.lastAlertedThreshold': budgetAlertLatchSetting,
  // The catalog itself lives in `packages/ingest` (Node-only), which `core` must not import,
  // so these are plain strings validated at the point of use — an unknown id degrades to "no
  // embedding provider is configured", which is exactly how a missing model already behaves.
  'retrieval.embeddingModel': stringSetting('embeddinggemma-300m'),
  'retrieval.ollamaBaseUrl': stringSetting('http://127.0.0.1:11434'),
  'retrieval.ollamaModel': stringSetting('bge-m3'),
  'retrieval.ollamaDims': numberIn(1, 8192, 1024),
  'retrieval.device': oneOf(['auto', 'webgpu', 'cuda', 'dml', 'cpu'], 'auto'),
  'retrieval.preciseVectors': booleanSetting(false),
  'retrieval.rerankerEnabled': booleanSetting(false),
  'retrieval.rerankerModel': stringSetting('bge-reranker-v2-m3'),
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
