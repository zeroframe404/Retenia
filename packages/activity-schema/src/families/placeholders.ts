import type { ActivityFamily } from '@retenia/core'
import { z } from 'zod'

/**
 * The families without a payload schema yet. `family` is still a closed enum — an activity of
 * one of these parses, its payload is kept as-is, and nothing grades it until its sub-phase:
 *
 * - TODO(sub-phase 5.x / F11): `speech`, `dialogue` — `mode + targetText + engine + thresholds`, persona/scenario/goal.
 * - TODO(F12): `image_target`, `draw`, `media_checkpoints`, `code`, `math`, `graph`.
 * - TODO(phase 2/3): `scale`, `branching`, `grid_game`, `arcade`, `simulation`.
 */
export function placeholderPayloadSchema<F extends ActivityFamily>(family: F) {
  return z
    .looseObject({ family: z.literal(family) })
    .describe(`TODO: ${family} payload is not modelled yet; kept as an open object.`)
}
