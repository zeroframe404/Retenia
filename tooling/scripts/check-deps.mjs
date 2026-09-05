#!/usr/bin/env node

/**
 * Enforce the monorepo's dependency-boundary rules (docs/spec/07-architecture.md §3):
 * `core` imports nothing internal; `db`/`ai`/`ingest`/`importers` import `core`;
 * `ui`/`activities`/`editor`/`readers` import `core` and `ui`; `apps/desktop` imports
 * everything. `ipc-contract`, `i18n` and `config` are leaves: no internal deps.
 * The activity engine (docs/spec/03-activities.md §8): `activity-schema` imports `core`,
 * `activity-graders` imports `core` and `activity-schema`, `activity-ai` adds `ai` on top of
 * those two, and `activities` (the React host) may import the schema and the graders on top of
 * `core` and `ui` — but never `activity-ai`, which is main-process/provider territory.
 *
 * Usage: node check-deps.mjs
 */

import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

// name (without the @retenia/ scope) -> allowed internal deps, or '*' for "anything"
const ALLOWED = {
  core: [],
  db: ['core'],
  ai: ['core'],
  ingest: ['core'],
  importers: ['core'],
  ui: ['core'],
  activities: ['core', 'ui', 'activity-schema', 'activity-graders'],
  'activity-schema': ['core'],
  'activity-graders': ['core', 'activity-schema'],
  'activity-ai': ['core', 'activity-schema', 'activity-graders', 'ai'],
  editor: ['core', 'ui'],
  readers: ['core', 'ui'],
  'ipc-contract': [],
  i18n: [],
  config: [],
  desktop: '*',
}

const SCOPE = '@retenia/'

/**
 * Given a package.json's parsed contents, return the internal (`@retenia/*`) package
 * names it depends on at runtime (`dependencies` only). `devDependencies` is where every
 * package pulls in `@retenia/config` for its shared tsconfig/vitest base — that's dev
 * tooling, not an architectural edge, so it's intentionally exempt from the boundary rules.
 */
export function internalDeps(pkgJson) {
  const all = { ...pkgJson.dependencies }
  return Object.keys(all)
    .filter((name) => name.startsWith(SCOPE))
    .map((name) => name.slice(SCOPE.length))
}

/**
 * Validate one package's internal deps against the rules map.
 * Returns a list of violation messages (empty if none).
 */
export function checkPackage(name, deps) {
  const allowed = ALLOWED[name]
  if (allowed === undefined) {
    return [`unknown package "${name}" has no boundary rule defined in check-deps.mjs`]
  }
  if (allowed === '*') {
    return []
  }
  return deps
    .filter((dep) => !allowed.includes(dep))
    .map(
      (dep) =>
        `${SCOPE}${name} imports ${SCOPE}${dep}, which is not allowed ` +
        `(allowed: ${allowed.length ? allowed.map((d) => SCOPE + d).join(', ') : 'none'})`,
    )
}

function findPackageJsonFiles() {
  return [
    ...globSync('packages/*/package.json', { cwd: projectRoot }),
    ...globSync('apps/*/package.json', { cwd: projectRoot }),
  ]
}

function main() {
  console.log('Checking package dependency boundaries...\n')

  const files = findPackageJsonFiles()
  const violations = []

  for (const relPath of files) {
    const absPath = path.join(projectRoot, relPath)
    const pkgJson = JSON.parse(readFileSync(absPath, 'utf-8'))
    const name = pkgJson.name?.startsWith(SCOPE) ? pkgJson.name.slice(SCOPE.length) : pkgJson.name
    const deps = internalDeps(pkgJson)
    const pkgViolations = checkPackage(name, deps)

    if (pkgViolations.length === 0) {
      console.log(`  ✓ ${pkgJson.name}`)
    } else {
      for (const message of pkgViolations) {
        console.log(`  ✘ ${message}`)
        violations.push(message)
      }
    }
  }

  console.log()

  if (violations.length > 0) {
    console.error(`❌ Found ${violations.length} dependency boundary violation(s).`)
    process.exit(1)
  }

  console.log('✓ All package dependencies respect the boundary rules')
  process.exit(0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
