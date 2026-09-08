import { z } from 'zod'
import { AiError } from '../errors'
import type { ProviderProfile } from '../profiles'
import raw from './pricing.json' with { type: 'json' }
import type { ModelKey, PricingTable, Rates, ResolvedRates } from './types'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

const nonNegative = z.number().nonnegative()

const ratesShape = {
  input: nonNegative,
  output: nonNegative,
  cacheRead: nonNegative.nullable(),
  cacheWrite5m: nonNegative.nullable(),
  cacheWrite1h: nonNegative.nullable(),
  /** A fraction off, not a multiplier: 0.5 means -50 %. */
  batchDiscount: z.number().min(0).max(1).nullable(),
}

const windowSchema = z
  .strictObject({
    id: z.string().min(1),
    startUtc: z.string().regex(HH_MM),
    endUtc: z.string().regex(HH_MM),
    input: nonNegative.optional(),
    output: nonNegative.optional(),
    cacheRead: nonNegative.nullable().optional(),
    cacheWrite5m: nonNegative.nullable().optional(),
    cacheWrite1h: nonNegative.nullable().optional(),
    batchDiscount: z.number().min(0).max(1).nullable().optional(),
  })
  // A zero-length window would read as "always in force" under the midnight-wrap branch,
  // which is the opposite of what someone writing `18:00`-`18:00` means.
  .refine((w) => w.startUtc !== w.endUtc, {
    message: 'a window must not start and end at the same minute',
  })

const periodSchema = z.strictObject({
  ...ratesShape,
  from: z.string().regex(ISO_DAY).nullable(),
  verifiedOn: z.string().regex(ISO_DAY).optional(),
  unverified: z.boolean().optional(),
  note: z.string().optional(),
  windows: z.array(windowSchema).optional(),
})

const modelSchema = z
  .strictObject({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    label: z.string().min(1),
    periods: z.array(periodSchema).min(1).optional(),
    aliasOf: z.string().min(1).optional(),
    aggregator: z.string().min(1).optional(),
    overrides: z.strictObject(ratesShape).partial().optional(),
  })
  .refine((m) => (m.periods === undefined) !== (m.aliasOf === undefined), {
    message: 'a model has either its own periods or an aliasOf, never both and never neither',
  })
  .refine(
    (m) =>
      m.periods === undefined ||
      // The tiling invariant: the first period reaches back forever and each later one
      // starts strictly after its predecessor. Together they make "no period covers this
      // instant" unreachable, which is what stops a call resolving to a silent zero.
      (m.periods[0]?.from === null &&
        m.periods.every(
          (p, i) => i === 0 || (p.from !== null && p.from > (m.periods?.[i - 1]?.from ?? '')),
        )),
    { message: 'periods must start with from:null and then increase strictly' },
  )

export const pricingTableSchema = z
  .strictObject({
    version: z.int().positive(),
    revision: z.string().regex(ISO_DAY),
    currency: z.literal('USD'),
    unit: z.literal('per_million_tokens'),
    source: z.string(),
    notes: z.array(z.string()),
    models: z.record(z.string(), modelSchema),
    aggregators: z.record(z.string(), z.strictObject({ feePct: z.number().min(0) })),
  })
  .refine(
    (t) =>
      Object.values(t.models).every(
        (m) => m.aggregator === undefined || Object.hasOwn(t.aggregators, m.aggregator),
      ),
    { message: 'every aggregator named by a model must be declared in `aggregators`' },
  )
  .refine(
    (t) =>
      Object.values(t.models).every(
        (m) =>
          m.aliasOf === undefined ||
          // No chains: an alias must point at a model that carries real periods, so
          // resolution is one hop and cannot cycle.
          (Object.hasOwn(t.models, m.aliasOf) && t.models[m.aliasOf]?.periods !== undefined),
      ),
    { message: 'aliasOf must name a model that has its own periods' },
  )

/**
 * The shipped table, parsed at module load.
 *
 * A malformed table is a startup crash rather than a degraded mode, and that is correct:
 * this is our file, not user input. The editable overlay 7.5 adds is a *separate*
 * argument to `createAiClient`, so a bad user edit can be rejected without taking the app
 * down with it.
 */
export const SHIPPED_PRICING: PricingTable = pricingTableSchema.parse(raw)

export const PRICING_REVISION: string = SHIPPED_PRICING.revision

export function modelKey(profile: Pick<ProviderProfile, 'kind'>, modelId: string): ModelKey {
  return `${profile.kind}:${modelId}`
}

function toMinutes(hhmm: string): number {
  const hours = Number(hhmm.slice(0, 2))
  const minutes = Number(hhmm.slice(3, 5))
  return hours * 60 + minutes
}

/**
 * Is `at` inside `[startUtc, endUtc)`? An end at or before the start wraps midnight, which
 * is how a night-time off-peak band like DeepSeek's 16:30–00:30 is expressed.
 */
export function inUtcWindow(at: Date, startUtc: string, endUtc: string): boolean {
  const now = at.getUTCHours() * 60 + at.getUTCMinutes()
  const start = toMinutes(startUtc)
  const end = toMinutes(endUtc)
  return end > start ? now >= start && now < end : now >= start || now < end
}

/**
 * The rates in force for `key` at `at`.
 *
 * Throws `model_not_priced` for a key the table does not know — never for a *date*. A
 * routing bug must not be answered with a cost of zero, because `sumCost` cannot tell a
 * zero that means "free" from one that means "we lost track of the money".
 */
export function resolveRates(table: PricingTable, key: ModelKey, at: Date): ResolvedRates {
  const entry = table.models[key]
  if (entry === undefined) {
    throw new AiError(
      'model_not_priced',
      `no pricing row for "${key}" (revision ${table.revision}); add one to pricing.json`,
    )
  }

  const baseModelKey = entry.aliasOf ?? key
  const base = entry.aliasOf === undefined ? entry : table.models[entry.aliasOf]
  const periods = base?.periods
  if (periods === undefined || periods.length === 0) {
    throw new AiError(
      'model_not_priced',
      `"${key}" resolves to "${baseModelKey}", which has no periods`,
    )
  }

  const day = at.toISOString().slice(0, 10)
  // The schema guarantees periods[0].from === null and ascending `from`s, so the first
  // entry always matches and `chosen` is never left unset.
  let chosen = periods[0]
  for (const period of periods) {
    if (period.from === null || period.from <= day) chosen = period
    else break
  }
  if (chosen === undefined) {
    throw new AiError('model_not_priced', `"${baseModelKey}" has no period covering ${day}`)
  }

  const window = chosen.windows?.find((w) => inUtcWindow(at, w.startUtc, w.endUtc))

  // Overlay order: period -> time-of-day window -> the alias listing's own overrides.
  // Each layer is more specific than the last, and `undefined` in a layer means "inherit".
  const layered: Rates = {
    input: entry.overrides?.input ?? window?.input ?? chosen.input,
    output: entry.overrides?.output ?? window?.output ?? chosen.output,
    cacheRead: pick(entry.overrides?.cacheRead, window?.cacheRead, chosen.cacheRead),
    cacheWrite5m: pick(entry.overrides?.cacheWrite5m, window?.cacheWrite5m, chosen.cacheWrite5m),
    cacheWrite1h: pick(entry.overrides?.cacheWrite1h, window?.cacheWrite1h, chosen.cacheWrite1h),
    batchDiscount: pick(
      entry.overrides?.batchDiscount,
      window?.batchDiscount,
      chosen.batchDiscount,
    ),
  }

  return {
    ...layered,
    modelKey: key,
    baseModelKey,
    periodFrom: chosen.from,
    windowId: window?.id ?? null,
    aggregator: entry.aggregator ?? null,
    unverified: chosen.unverified === true,
  }
}

/** `??` alone cannot express this: a layer may legitimately set a rate to `null`. */
function pick(
  override: number | null | undefined,
  window: number | null | undefined,
  period: number | null,
): number | null {
  if (override !== undefined) return override
  if (window !== undefined) return window
  return period
}
