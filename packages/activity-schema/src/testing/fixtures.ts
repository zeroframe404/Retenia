import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { gradeMetaSchema, perItemSchema } from '../grade-result'
import { ACTIVITY_TYPE_IDS, type ActivityType } from '../registry'

/**
 * The JSON fixtures under `packages/activity-schema/fixtures/<type>/`: the oracle every grader
 * and every validation rule is tested against (`docs/spec/03-activities.md` §10: "pure and
 * testable with fixtures"). Node-only, which is why it lives under `testing/`.
 */

export const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')

/** An expected score: exact, or a band when the exact figure would over-specify the grader. */
export const scoreExpectationSchema = z.union([
  z.number().min(0).max(1),
  z.object({ min: z.number().min(0).max(1).optional(), max: z.number().min(0).max(1).optional() }),
])
export type ScoreExpectation = z.infer<typeof scoreExpectationSchema>

export const fixtureAnswerSchema = z.object({
  name: z.string().min(1),
  response: z.unknown(),
  meta: gradeMetaSchema.partial().optional(),
  expect: z.object({
    score: scoreExpectationSchema,
    correct: z.boolean(),
    perItem: z.array(perItemSchema.partial().required({ id: true })).optional(),
    signals: z.object({ pairsOutOfOrder: z.int().min(0).optional() }).optional(),
    engine: z.string().optional(),
  }),
})
export type FixtureAnswer = z.infer<typeof fixtureAnswerSchema>

export const validFixtureSchema = z.object({
  activity: z.unknown(),
  answers: z.array(fixtureAnswerSchema).min(1),
  /** The warning codes `validateActivity` is expected to raise, exactly. */
  warnings: z.array(z.string()).optional(),
})
export type ValidFixture = z.infer<typeof validFixtureSchema>

export const invalidFixtureSchema = z.object({
  activity: z.unknown(),
  expect: z.object({
    layer: z.enum(['schema', 'rules']),
    codes: z.array(z.string()),
  }),
})
export type InvalidFixture = z.infer<typeof invalidFixtureSchema>

export interface FixtureFile<T> {
  type: ActivityType
  name: string
  path: string
  data: T
}

export interface LoadedFixtures {
  valid: FixtureFile<ValidFixture>[]
  invalid: FixtureFile<InvalidFixture>[]
}

/** Every fixture on disk, parsed against the fixture file shapes (not yet against the activity schema). */
export function loadFixtures(root: string = FIXTURES_ROOT): LoadedFixtures {
  const valid: FixtureFile<ValidFixture>[] = []
  const invalid: FixtureFile<InvalidFixture>[] = []
  const types = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const type of types) {
    if (!(ACTIVITY_TYPE_IDS as readonly string[]).includes(type)) {
      throw new Error(`fixtures/${type} is not an activity type`)
    }
    const files = readdirSync(join(root, type))
      .filter((file) => file.endsWith('.json'))
      .sort()
    for (const name of files) {
      const path = join(root, type, name)
      const json: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (name.startsWith('valid-')) {
        valid.push({ type: type as ActivityType, name, path, data: validFixtureSchema.parse(json) })
      } else if (name.startsWith('invalid-')) {
        invalid.push({
          type: type as ActivityType,
          name,
          path,
          data: invalidFixtureSchema.parse(json),
        })
      } else {
        throw new Error(`fixtures/${type}/${name}: file names start with valid- or invalid-`)
      }
    }
  }
  return { valid, invalid }
}

/** Whether `score` satisfies an exact or banded expectation (exact to 1e-6). */
export function scoreMatches(score: number, expectation: ScoreExpectation): boolean {
  if (typeof expectation === 'number') return Math.abs(score - expectation) < 1e-6
  const aboveMin = expectation.min === undefined || score >= expectation.min - 1e-9
  const belowMax = expectation.max === undefined || score <= expectation.max + 1e-9
  return aboveMin && belowMax
}
