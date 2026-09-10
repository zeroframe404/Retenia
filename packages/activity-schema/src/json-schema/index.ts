import { type ActivityFamily, BLOOM_LEVELS } from '@retenia/core'
import { z } from 'zod'
import { familyDraftBranch } from '../envelope'
import { type ActivityTypeOf, isMvpFamily, typesOfFamily } from '../registry'
import { type JsonSchema, strictOverride } from './strict'

export * from './strict'

export interface ActivityJsonSchemaOptions<F extends ActivityFamily> {
  /** The `enum` of `type`: the types this generation call may produce. Default: all of the family. */
  types?: readonly ActivityTypeOf<F>[]
}

/**
 * The JSON Schema a structured-output call receives for one family
 * (`docs/spec/03-activities.md` §7: "on each LLM call only the schema of the family to be
 * generated is passed, with the enum of `type` reduced to the allowed types").
 *
 * It describes an `ActivityDraft` — no `id`, which the pipeline assigns — and is strict-mode
 * clean: every constraint zod enforces that strict mode cannot express is in a description.
 * Draft 2020-12, no `$ref` (every reused schema is inlined) and no `$schema` key.
 */
export function activityJsonSchema<F extends ActivityFamily>(
  family: F,
  options: ActivityJsonSchemaOptions<F> = {},
): JsonSchema {
  if (!isMvpFamily(family)) {
    throw new RangeError(`activityJsonSchema: family "${family}" has no payload schema yet`)
  }
  const branch = familyDraftBranch(family, options.types ?? typesOfFamily(family))
  const generated = z.toJSONSchema(branch, {
    target: 'draft-2020-12',
    io: 'input',
    cycles: 'throw',
    reused: 'inline',
    unrepresentable: 'any',
    override: strictOverride,
  })
  const schema = JSON.parse(JSON.stringify(generated)) as JsonSchema
  delete schema.$schema
  return schema
}

/**
 * The same branch, wrapped in the two fields the `activities` row carries and the envelope
 * does not: `bloom` (`docs/spec/04-path-generation.md` §1.4 — *"every activity declares its
 * level"*, and §4's *"≥ 1 activity at the 'apply' level"* is checked against it) and
 * `misconception_ids` (§4: *"distractors derived from misconceptions"*).
 *
 * A wrapper rather than two more envelope fields: the envelope is `schemaVersion: 1` across
 * 107 committed fixtures and every importer, and growing it to carry two columns that only
 * the generation pipeline writes would be a migration for nothing. `packages/db/src/schema/
 * paths.ts` already models both as columns beside `config`, which is where they end up.
 */
export function authoringBranch<F extends ActivityFamily>(
  family: F,
  types: readonly ActivityTypeOf<F>[] = typesOfFamily(family),
) {
  return z.object({
    activity: familyDraftBranch(family, types),
    bloom: z
      .enum(BLOOM_LEVELS)
      .describe("The revised-Bloom level this activity reaches, from its objective's verb."),
    misconception_ids: z
      .array(z.string().min(1))
      .describe('Ids of the listed misconceptions the distractors are built from; [] if none.'),
  })
}
