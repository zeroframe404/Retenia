/**
 * Claude strict-mode dry run over the activity JSON Schemas
 * (`docs/spec/03-activities.md` §7, `docs/spec/04-path-generation.md` §8).
 *
 * For every MVP family: export the schema with the family's MVP types as the `type`
 * allow-list, lint it against the strict-mode subset, compile it with ajv (draft 2020-12,
 * ajv strict mode) and validate every valid fixture draft of those types against it.
 * Exits 1 on any lint issue, compile error, rejected fixture or family without fixtures.
 *
 * Run from the package so its dependencies resolve: `pnpm run schema:check` at the root.
 */
import {
  activityJsonSchema,
  familyOf,
  lintStrictJsonSchema,
  MVP_FAMILIES,
  MVP_TYPES,
  parseActivity,
  strictSchemaStats,
  toActivityDraft,
} from '../packages/activity-schema/src/index'
import { compileStrictSchema, loadFixtures } from '../packages/activity-schema/src/testing/index'

interface Row {
  family: string
  types: number
  objects: number
  unions: number
  optional: string
  lint: number
  fixtures: string
  ok: boolean
}

const fixtures = loadFixtures()
const rows: Row[] = []
const problems: string[] = []

for (const family of MVP_FAMILIES) {
  const types = MVP_TYPES.filter((type) => familyOf(type) === family)
  const schema = activityJsonSchema(family, { types: types as never })
  const issues = lintStrictJsonSchema(schema)
  for (const issue of issues)
    problems.push(`${family}: ${issue.code} at /${issue.path.join('/')} — ${issue.message}`)

  const stats = strictSchemaStats(schema)
  const typeEnum = (schema.properties as Record<string, { enum?: unknown }>).type?.enum
  if (JSON.stringify(typeEnum) !== JSON.stringify(types)) {
    problems.push(
      `${family}: type enum ${JSON.stringify(typeEnum)} ≠ allow-list ${JSON.stringify(types)}`,
    )
  }

  let passed = 0
  let total = 0
  try {
    const validate = compileStrictSchema(schema)
    for (const fixture of fixtures.valid.filter((f) => types.includes(f.type))) {
      total += 1
      const draft = toActivityDraft(parseActivity(fixture.data.activity))
      const outcome = validate(draft)
      if (outcome.ok) passed += 1
      else
        problems.push(
          `${family}: ${fixture.type}/${fixture.name} rejected: ${outcome.errors.join('; ')}`,
        )
    }
  } catch (error) {
    problems.push(
      `${family}: schema failed to compile — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (total === 0) problems.push(`${family}: no valid fixtures`)

  rows.push({
    family,
    types: types.length,
    objects: stats.objects,
    unions: stats.unions,
    optional: `${stats.maxOptionalPerObject}/obj (${stats.optionalTotal})`,
    lint: issues.length,
    fixtures: `${passed}/${total}`,
    ok: issues.length === 0 && total > 0 && passed === total,
  })
}

const header = ['family', 'types', 'objects', 'unions', 'optional', 'lint', 'fixtures', 'ok']
const table = [header, ...rows.map((row) => header.map((key) => String(row[key as keyof Row])))]
const widths = header.map((_, i) => Math.max(...table.map((line) => (line[i] ?? '').length)))
for (const line of table) {
  console.log(line.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  '))
}
console.log()

if (problems.length > 0) {
  for (const problem of problems) console.error(`✘ ${problem}`)
  console.error(`\n${problems.length} problem(s): the activity schemas are not strict-mode clean.`)
  process.exitCode = 1
} else {
  console.log(
    `✓ ${rows.length} family schemas are Claude strict-mode clean and accept ${fixtures.valid.length} fixtures.`,
  )
}
