import { z } from 'zod'
import { defineContract } from '../define'

/**
 * The AI **settings** screen's surface (`docs/spec/08-ux.md` §1: provider cards, role
 * assignment, budget, allow-list, the "Precios" editor, the usage dashboard). Kept apart
 * from `./ai`, which is scoped to the batch tray and predates this sub-phase.
 *
 * Every schema here is closed and carries no key material: a provider card answers
 * `hasKey`/`keyPreview`, never a value a caller could read back
 * (`apps/desktop/src/main/security/secrets-never-cross-ipc.test.ts` holds this file to it).
 */

/** Mirrors `PROVIDER_KINDS` in `packages/ai/src/profiles.ts`. Redeclared rather than
 *  imported: this package is a leaf by architectural rule (`tooling/scripts/
 *  check-deps.mjs` pins `ipc-contract: []`). `ai-settings.test.ts` asserts the two agree. */
export const PROVIDER_KIND_VALUES = ['anthropic', 'google', 'openai-compatible'] as const
export const providerKindSchema = z.enum(PROVIDER_KIND_VALUES)
export type ProviderKindDto = z.infer<typeof providerKindSchema>

/** Mirrors `ProviderRole` in `packages/ai/src/provider-port.ts`. Same leaf-package reason. */
export const PROVIDER_ROLE_VALUES = ['smart', 'cheap', 'vision', 'audio', 'embed', 'local'] as const
export const providerRoleSchema = z.enum(PROVIDER_ROLE_VALUES)
export type ProviderRoleDto = z.infer<typeof providerRoleSchema>

/** Mirrors `AI_CALL_STATUSES` in `packages/core/src/entities/enums.ts`. Same leaf-package
 *  reason `./ai.ts`'s `AI_BATCH_STATUSES` already documents. */
export const AI_CALL_STATUS_VALUES = ['ok', 'error'] as const
export const aiCallStatusSchema = z.enum(AI_CALL_STATUS_VALUES)
export type AiCallStatusDto = z.infer<typeof aiCallStatusSchema>

/** One provider, as the "Inteligencia artificial" screen's cards see it. Never `apiKey`. */
export const providerCardSchema = z.object({
  id: z.string(),
  kind: providerKindSchema,
  label: z.string(),
  models: z.array(z.string()),
  /** USD per million tokens, per model listed above — the role picker's price hint. `null`
   *  for a model `pricing.json` does not price yet. */
  perMillionUsd: z.record(
    z.string(),
    z.object({ input: z.number(), output: z.number() }).nullable(),
  ),
  local: z.boolean(),
  hasKey: z.boolean(),
  /** `••••` plus the last 4 characters, or `null` — the same shape `secrets.get` answers. */
  keyPreview: z.string().nullable(),
  baseUrl: z.string().nullable(),
})
export type ProviderCardDto = z.infer<typeof providerCardSchema>

const modelRefSchema = z.object({ profileId: z.string(), modelId: z.string() })

export const roleAssignmentSchema = z.object({
  role: providerRoleSchema,
  primary: modelRefSchema.nullable(),
  fallbacks: z.array(modelRefSchema),
})
export type RoleAssignmentDto = z.infer<typeof roleAssignmentSchema>

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** One model's user-edited rates. `null` in a field means "no edit — keep the shipped
 *  table's rate", mirroring `packages/ai/src/pricing/overlay.ts`'s `PricingOverlayEntry`. */
export const pricingOverlayEntrySchema = z.object({
  modelKey: z.string(),
  input: z.number().nonnegative().nullable(),
  output: z.number().nonnegative().nullable(),
  cacheRead: z.number().nonnegative().nullable(),
  cacheWrite5m: z.number().nonnegative().nullable(),
  cacheWrite1h: z.number().nonnegative().nullable(),
  batchDiscount: z.number().min(0).max(1).nullable(),
  asOf: z.string().regex(ISO_DAY),
})
export type PricingOverlayEntryDto = z.infer<typeof pricingOverlayEntrySchema>

const resolvedRateSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().nullable(),
  cacheWrite5m: z.number().nonnegative().nullable(),
  cacheWrite1h: z.number().nonnegative().nullable(),
  batchDiscount: z.number().min(0).max(1).nullable(),
})

/** One row of the "Precios" table: the model's current effective rate (shipped table plus
 *  any overlay already applied), and the raw overlay entry if one exists — so the editor
 *  can show both the value in effect and which fields, if any, are a user edit. */
export const pricingRowSchema = z.object({
  modelKey: z.string(),
  label: z.string(),
  resolved: resolvedRateSchema,
  overlay: pricingOverlayEntrySchema.nullable(),
})
export type PricingRowDto = z.infer<typeof pricingRowSchema>

/** A projection of `ai_calls` for the usage dashboard's "last 100 calls" table. No error
 *  message field: a free-text detail column is not what this list is for, matching the
 *  batch tray's `aiBatchSummarySchema` precedent of a narrow, display-only projection. */
export const usageCallRowSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  provider: z.string(),
  model: z.string(),
  role: z.string().nullable(),
  purpose: z.string(),
  status: aiCallStatusSchema,
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative().nullable(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
})
export type UsageCallRowDto = z.infer<typeof usageCallRowSchema>

export const usageSummarySchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  totalUsd: z.number().nonnegative(),
  byPurpose: z.array(
    z.object({
      purpose: z.string(),
      provider: z.string(),
      costUsd: z.number().nonnegative(),
      calls: z.number().nonnegative(),
    }),
  ),
  byModel: z.array(
    z.object({ provider: z.string(), model: z.string(), costUsd: z.number().nonnegative() }),
  ),
})
export type UsageSummaryDto = z.infer<typeof usageSummarySchema>

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/)

export const aiSettingsChannels = defineContract({
  /** Every configured provider, key presence only — never a key value. */
  'ai.listProviderCards': {
    input: z.object({}),
    output: z.object({ cards: z.array(providerCardSchema) }),
  },

  /**
   * "Probar conexión": a real, minimal call plus a best-effort model list. The one channel
   * here that touches the network — every other channel in this file is a local read or a
   * settings write.
   */
  'ai.probeProvider': {
    input: z.object({ profileId: z.string() }),
    output: z.object({
      ok: z.boolean(),
      models: z.array(z.string()),
      error: z.string().nullable(),
      latencyMs: z.number().nonnegative(),
    }),
  },

  'ai.getRoles': {
    input: z.object({}),
    output: z.object({ roles: z.array(roleAssignmentSchema) }),
  },

  /** Rejects an assignment naming a keyless profile or an unlisted model — the handler
   *  validates against the live registry rather than persisting an assignment that would
   *  silently never resolve. */
  'ai.setRoles': {
    input: z.object({ roles: z.array(roleAssignmentSchema) }),
    output: z.object({ ok: z.literal(true) }),
  },

  'ai.getPricingOverlay': {
    input: z.object({}),
    output: z.object({
      revision: z.string(),
      isOverridden: z.boolean(),
      rows: z.array(pricingRowSchema),
    }),
  },

  /** Rejects an entry naming a model key the shipped table does not have. */
  'ai.setPricingOverlay': {
    input: z.object({ entries: z.array(pricingOverlayEntrySchema) }),
    output: z.object({ ok: z.literal(true) }),
  },

  /** Clears the overlay back to the shipped table — the "Restaurar" button. */
  'ai.restorePricing': {
    input: z.object({}),
    output: z.object({ ok: z.literal(true) }),
  },

  'ai.getUsageSummary': {
    input: z.object({ month: monthSchema }),
    output: usageSummarySchema,
  },

  'ai.listRecentCalls': {
    input: z.object({ limit: z.int().min(1).max(100).default(100) }),
    output: z.object({ calls: z.array(usageCallRowSchema) }),
  },

  /**
   * The monthly summary, written to a file the user picks — never the CSV bytes as a
   * renderer-visible string, matching `backups.exportCopy`'s pattern.
   */
  'ai.exportUsageCsv': {
    input: z.object({ month: monthSchema }),
    output: z.object({ savedTo: z.string().nullable() }),
  },
})
