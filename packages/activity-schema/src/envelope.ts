import { ACTIVITY_FAMILIES, type ActivityFamily } from '@retenia/core'
import { z } from 'zod'
import {
  activityIdSchema,
  langSchema,
  mediaRefSchema,
  richTextSchema,
  sourceRefSchema,
} from './common'
import { PAYLOAD_SCHEMAS } from './families'
import { gradingSchema, reviewSchema } from './grading'
import { type ActivityType, type ActivityTypeOf, familyOf, typesOfFamily } from './registry'

/**
 * `ActivityBase<T, P>` of `docs/spec/03-activities.md` §7 as one zod discriminated union on
 * `family`: each branch is the shared envelope, `family` as a literal, `type` as the enum of
 * that family's types, and the family's payload. `type ∈ family` is therefore a parse error,
 * not a rule to remember.
 *
 * `familyBranch` is exported because the LLM-facing JSON Schema is one branch with `type`
 * narrowed further to the types a generation call may produce (§7: "with the `enum` of `type`
 * reduced to the allowed types"), and without `id` — a model cannot mint a UUIDv7.
 */

export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5] as const
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number]

export const envelopeShape = {
  id: activityIdSchema,
  schemaVersion: z.literal(1),
  lang: langSchema,
  prompt: richTextSchema.describe(
    'The question or instruction, in Markdown. Must not contain the answer.',
  ),
  instructions: z.string().min(1).optional().describe('How to interact, when not obvious.'),
  media: z.array(mediaRefSchema).optional(),
  hints: z.array(richTextSchema).optional().describe('Progressive hints, weakest first.'),
  explanation: richTextSchema.optional().describe('Static "Explain my answer".'),
  sources: z.array(sourceRefSchema).optional(),
  skills: z.array(z.string().min(1)).describe('Concept ids the scheduler schedules.'),
  difficulty: z.literal(DIFFICULTY_LEVELS),
  tags: z.array(z.string().min(1)).optional(),
  grading: gradingSchema,
  review: reviewSchema,
}

function assertTypesOfFamily(family: ActivityFamily, types: readonly ActivityType[]): void {
  if (types.length === 0) {
    throw new RangeError(`familyBranch: at least one type is required for family "${family}"`)
  }
  for (const type of types) {
    if (familyOf(type) !== family) {
      throw new RangeError(
        `familyBranch: type "${type}" belongs to family "${familyOf(type)}", not "${family}"`,
      )
    }
  }
}

/** The full schema of one family, with `type` limited to `types` (default: every type of the family). */
export function familyBranch<F extends ActivityFamily>(
  family: F,
  types: readonly ActivityTypeOf<F>[] = typesOfFamily(family),
) {
  assertTypesOfFamily(family, types)
  return z.object({
    ...envelopeShape,
    family: z.literal(family),
    type: z.enum(types as unknown as [ActivityTypeOf<F>, ...ActivityTypeOf<F>[]]),
    payload: PAYLOAD_SCHEMAS[family],
  })
}

/** The same branch without `id`: what a generator produces before an id is assigned. */
export function familyDraftBranch<F extends ActivityFamily>(
  family: F,
  types: readonly ActivityTypeOf<F>[] = typesOfFamily(family),
) {
  return familyBranch(family, types).omit({ id: true })
}

/** Homomorphic over a tuple of families, so the result is a tuple of branches, one per family. */
type BranchesOf<T extends readonly ActivityFamily[]> = {
  [K in keyof T]: T[K] extends ActivityFamily ? ReturnType<typeof familyBranch<T[K]>> : never
}
type DraftBranchesOf<T extends readonly ActivityFamily[]> = {
  [K in keyof T]: T[K] extends ActivityFamily ? ReturnType<typeof familyDraftBranch<T[K]>> : never
}
type Branches = BranchesOf<typeof ACTIVITY_FAMILIES>
type DraftBranches = DraftBranchesOf<typeof ACTIVITY_FAMILIES>

const branches = ACTIVITY_FAMILIES.map((family) => familyBranch(family)) as unknown as Branches
const draftBranches = ACTIVITY_FAMILIES.map((family) =>
  familyDraftBranch(family),
) as unknown as DraftBranches

/** Every activity of every family. */
export const activitySchema = z.discriminatedUnion('family', branches)
export type Activity<F extends ActivityFamily = ActivityFamily> = Extract<
  z.infer<typeof activitySchema>,
  { family: F }
>

/** An activity before it has an id. */
export const activityDraftSchema = z.discriminatedUnion('family', draftBranches)
export type ActivityDraft<F extends ActivityFamily = ActivityFamily> = Extract<
  z.infer<typeof activityDraftSchema>,
  { family: F }
>

export function parseActivity(json: unknown): Activity {
  return activitySchema.parse(json)
}

export function safeParseActivity(json: unknown) {
  return activitySchema.safeParse(json)
}

export function toActivityDraft(activity: Activity): ActivityDraft {
  const { id: _id, ...draft } = activity
  return draft as ActivityDraft
}
