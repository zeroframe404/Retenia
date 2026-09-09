import { z } from 'zod'
import { defineEvents } from '../define'

/**
 * The settings screen's budget banner/toast (`docs/spec/08-ux.md` §1). Fired once per
 * threshold per month — `apps/desktop/src/main/ai/client.ts`'s `ai.budget.lastAlertedThreshold`
 * latch is what keeps a duplicate crossing (two concurrent calls, or a restart) from
 * re-alerting.
 */
export const aiSettingsEvents = defineEvents({
  'ai.budgetAlert': z.object({
    /** `YYYY-MM`. */
    period: z.string(),
    threshold: z.union([z.literal(80), z.literal(100)]),
    spentUsd: z.number().nonnegative(),
    capUsd: z.number().nonnegative(),
  }),
})
