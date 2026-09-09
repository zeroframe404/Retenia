import { z } from 'zod'
import type { ModelKey, PricingTable, Rates } from './types'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * One model's user-edited rates, as the settings screen's "Precios" table stores them.
 *
 * `null` in any field means "no edit here — keep the shipped table's rate", not "force this
 * rate to null". A shipped `Rates.cacheRead` of `null` (the provider has no cache tier) is a
 * fact about the provider; this overlay only ever narrows what a user typed, so it cannot
 * express "turn caching off" for a provider that has it — that would need a different
 * control, and isn't asked for here.
 */
export const pricingOverlayEntrySchema = z.strictObject({
  input: z.number().nonnegative().nullable(),
  output: z.number().nonnegative().nullable(),
  cacheRead: z.number().nonnegative().nullable(),
  cacheWrite5m: z.number().nonnegative().nullable(),
  cacheWrite1h: z.number().nonnegative().nullable(),
  batchDiscount: z.number().min(0).max(1).nullable(),
  /** ISO day the override was entered — shown next to the row, per `docs/spec/08-ux.md`
   *  §1's "Precios" editor (`as_of` and a "restaurar" button). */
  asOf: z.string().regex(ISO_DAY),
})

export type PricingOverlayEntry = z.infer<typeof pricingOverlayEntrySchema>

export const pricingOverlaySchema = z.record(z.string(), pricingOverlayEntrySchema)

/** `modelKey -> PricingOverlayEntry`. Empty means "use the shipped table as-is" — what
 *  "Restaurar" clears back to. */
export type PricingOverlay = z.infer<typeof pricingOverlaySchema>

const RATE_FIELDS = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite5m',
  'cacheWrite1h',
  'batchDiscount',
] as const satisfies readonly (keyof Rates)[]

/** Every model key the overlay names that the base table does not know. `apps/desktop`
 *  rejects a write that names one rather than accepting it silently; this is the check it
 *  calls to decide that, and `mergePricingOverlay` uses it too as a defense-in-depth skip. */
export function unknownOverlayKeys(base: PricingTable, overlay: PricingOverlay): ModelKey[] {
  return Object.keys(overlay).filter((key) => !Object.hasOwn(base.models, key))
}

/**
 * Splice the overlay's edited fields into each named model's `overrides`, on top of a clone
 * of `base` — the same `overrides` field `resolveRates` already layers on top of the
 * period/window rates, so this adds no second precedence rule. An overlay entry naming a
 * model `base` doesn't have is skipped rather than thrown on: the settings-write boundary
 * (`ai.setPricingOverlay`'s handler, via `unknownOverlayKeys`) is where that's rejected.
 */
export function mergePricingOverlay(base: PricingTable, overlay: PricingOverlay): PricingTable {
  const entries = Object.entries(overlay)
  if (entries.length === 0) return base

  const models = { ...base.models }
  for (const [key, entry] of entries) {
    const model = models[key]
    if (model === undefined) continue

    const overrides: { -readonly [K in keyof Rates]?: Rates[K] } = { ...model.overrides }
    for (const field of RATE_FIELDS) {
      const value = entry[field]
      if (value !== null) overrides[field] = value
    }
    models[key] = { ...model, overrides }
  }

  return { ...base, models }
}
