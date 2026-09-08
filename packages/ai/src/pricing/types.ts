/**
 * The shape of the versioned pricing table (`docs/spec/06-ai-providers.md` §6: "a
 * versioned, editable pricing table").
 *
 * The spec sketches `pricing { in, out, cachedIn, batch, date }`. Three things force a
 * richer shape, and all three are load-bearing rather than speculative:
 *
 * 1. **Cache writes are billed separately.** AI SDK 7 reports
 *    `inputTokenDetails.cacheWriteTokens` distinctly from `cacheReadTokens`, and Anthropic
 *    charges 1.25x (5 min) or 2x (1 h) to write where it charges 0.1x to read. A single
 *    `cachedIn` cannot express that, and `@retenia/ingest`'s `ContextualizationPricing`
 *    already carries `cacheWriteUsdPerMillion` for exactly this reason.
 * 2. **A price has a timeline, not a date.** Gemini 3.7 Flash doubles on 2027-01-01 and the
 *    change is already published. A single `date` field would silently under-count the
 *    highest-volume role by 2x from New Year's Day; `periods` makes the flip a fact about
 *    the table rather than an edit someone has to remember to make.
 * 3. **Some prices depend on the hour.** DeepSeek V4 bills peak and off-peak differently.
 *
 * Rates are USD per million tokens throughout, matching how §1's tables print them.
 */

/** `${ProviderKind}:${modelId}`, e.g. `anthropic:claude-sonnet-5`. */
export type ModelKey = string

/** Which Anthropic cache tier a call wrote to. 7.3 is what starts passing it. */
export type CacheTtl = '5m' | '1h'

export interface Rates {
  readonly input: number
  readonly output: number
  /**
   * Reading a cached prefix. `null` means the provider has no cache tier, in which case
   * cached tokens bill at `input` — never at zero, which would under-report a real charge.
   */
  readonly cacheRead: number | null
  readonly cacheWrite5m: number | null
  readonly cacheWrite1h: number | null
  /** `0.5` = the Batch API's -50 %. `null` = the provider has no Batch API. */
  readonly batchDiscount: number | null
}

/** A time-of-day override inside a period, for providers that bill peak and off-peak. */
export interface PricingWindow extends Partial<Rates> {
  readonly id: string
  /** `HH:MM` UTC. The interval is `[startUtc, endUtc)`; `endUtc <= startUtc` wraps midnight. */
  readonly startUtc: string
  readonly endUtc: string
}

export interface PricingPeriod extends Rates {
  /**
   * Inclusive `YYYY-MM-DD` in UTC. `null` on the **first** period only, meaning "since
   * forever" — a loader invariant (`table.test.ts` enforces it) so the timeline is always
   * tiled and no call can fall through to a silent zero.
   */
  readonly from: string | null
  readonly verifiedOn?: string
  /** `docs/spec/06-ai-providers.md` marks figures it could not confirm; carry that through. */
  readonly unverified?: boolean
  readonly note?: string
  readonly windows?: readonly PricingWindow[]
}

export interface ModelPricing {
  readonly provider: string
  readonly modelId: string
  readonly label: string
  /** Absent exactly when `aliasOf` is set. */
  readonly periods?: readonly PricingPeriod[]
  /**
   * Inherit the base model's rates rather than copying them, so an aggregator listing has
   * exactly one place to fix a price. Chains are not allowed: an alias's target must have
   * its own periods.
   */
  readonly aliasOf?: ModelKey
  /** A key in `PricingTable.aggregators`; its fee multiplies the whole total. */
  readonly aggregator?: string
  /** Applied on top of the inherited rates, for a listing that genuinely differs. */
  readonly overrides?: Partial<Rates>
}

export interface PricingTable {
  readonly version: number
  /**
   * Stamped into `ai_calls.meta.pricingRevision`, so a charge stays explicable after the
   * table has moved on.
   */
  readonly revision: string
  readonly models: Readonly<Record<ModelKey, ModelPricing>>
  readonly aggregators: Readonly<Record<string, { readonly feePct: number }>>
}

/** What `resolveRates` answers: the rates in force, plus how it got to them. */
export interface ResolvedRates extends Rates {
  readonly modelKey: ModelKey
  readonly baseModelKey: ModelKey
  readonly periodFrom: string | null
  readonly windowId: string | null
  readonly aggregator: string | null
  readonly unverified: boolean
}
