import type { ActivityFamily } from '@retenia/core'
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
