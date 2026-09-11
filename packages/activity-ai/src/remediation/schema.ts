import { REMEDIATION_BLOCK_TYPES } from '@retenia/core'
import { z } from 'zod'
import { itemCandidateSchema } from '../make-items/schema'

/**
 * `remediate@1` — what P11 returns for one detour (`docs/spec/04-path-generation.md` §9 P11,
 * §11). The `schema:` line of `packages/ai/prompts/P11_remediation/1.md` names this version,
 * and it is the `schemaVersion` half of every P11 `custom_id`.
 *
 * The items are P9's item shape (`itemCandidateSchema`), because they are validated by the
 * same rules and end up beside the bank's own `remediation` items in the same lesson.
 */

export const REMEDIATE_SCHEMA_NAME = 'remediate'
export const REMEDIATE_SCHEMA_VERSION = '1'
export const REMEDIATE_SCHEMA_ID = `${REMEDIATE_SCHEMA_NAME}@${REMEDIATE_SCHEMA_VERSION}`

/** §9 asks for three; twice that is room for the collector to drop a bad one. */
export const MAX_REMEDIATION_ITEMS = 6

const citeIds = (max: number) => z.array(z.string().min(1).max(64)).max(max)

export function remediateOutputSchema() {
  return z.object({
    title: z.string().min(1).max(160),
    blocks: z
      .array(
        z.object({
          type: z.enum(REMEDIATION_BLOCK_TYPES),
          content: z.string().min(1).max(4_000).describe('Markdown; [cite:B01] markers go inline.'),
          citations: citeIds(8),
        }),
      )
      .min(1)
      .max(6),
    items: z.array(itemCandidateSchema()).max(MAX_REMEDIATION_ITEMS),
    contrast_card: z
      .object({
        front: z.string().min(1).max(300),
        back: z.string().min(1).max(300),
        citations: citeIds(4),
      })
      .nullable(),
    notes: z.array(z.string().min(1).max(300)).max(6),
  })
}

export type RemediateOutput = z.infer<ReturnType<typeof remediateOutputSchema>>
