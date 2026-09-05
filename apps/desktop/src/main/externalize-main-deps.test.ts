import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'

/**
 * The main bundle must inline every `@retenia/*` package it imports.
 *
 * Each of those packages points its `exports` straight at `./src/index.ts` and has no build
 * step, so a specifier left external survives into `out/main/index.js` as a bare import that
 * Node resolves to raw TypeScript and refuses to load. The main process then throws before
 * it opens a window.
 *
 * Nothing cheap catches that: `typecheck` and the unit tests resolve TypeScript natively, and
 * only a bundled build reproduces it. The one job that does — `e2e` — reports it as all ~46
 * Playwright tests failing at once with "Test timeout of 30000ms exceeded while setting up
 * electronApp", after ~50 minutes of a Windows runner. This test is here so the same mistake
 * costs seconds instead, in `lint-typecheck-test`, which gates `e2e`.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '../..')

/** The roots electron-vite builds with the `main` config: the app entry and the job worker. */
const MAIN_SOURCE_DIRS = ['src/main', 'src/worker', 'src/jobs']

function sourceFiles(dir: string): string[] {
  const absolute = path.join(desktopRoot, dir)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
    found.push(path.join(entry.parentPath, entry.name))
  }
  return found
}

/** `@retenia/db/migrations-bundled` is excluded as `@retenia/db`: the list names packages. */
function packageName(specifier: string): string {
  const [scope = '', name = ''] = specifier.split('/')
  return `${scope}/${name}`
}

/**
 * The `@retenia/*` packages a file imports **for their values**.
 *
 * `import type` is erased before the bundler sees it, so a type-only import needs no
 * exclusion and must not be demanded of one. Import statements here are Biome-formatted and
 * may span lines, so lines are joined from `import` up to the `from '…'` that closes them.
 */
function valueImports(file: string): string[] {
  const lines = readFileSync(file, 'utf-8').split('\n')
  const specifiers: string[] = []
  let statement: string | null = null

  for (const line of lines) {
    if (statement === null && !/^\s*import\b/.test(line)) continue
    statement = statement === null ? line : `${statement} ${line.trim()}`

    const match = statement.match(
      /^\s*import\s+(?<clause>[\s\S]*?)\bfrom\s+['"](?<from>[^'"]+)['"]/,
    )
    if (match === null) continue

    const { clause = '', from = '' } = match.groups ?? {}
    // `import type { … } from` is erased; `import { type A, b } from` is not.
    if (from.startsWith('@retenia/') && !/^\s*type\b/.test(clause)) {
      specifiers.push(packageName(from))
    }
    statement = null
  }

  return specifiers
}

function excludedFromExternalization(): readonly (string | RegExp)[] {
  const main = config.main
  if (typeof main !== 'object' || main === null) {
    throw new TypeError('electron.vite.config.ts: `main` is expected to be a config object')
  }
  // Typed `boolean | ExternalOptions`: `externalizeDeps: false` would turn the whole
  // mechanism off, which is a different (and equally broken) config, not an empty list.
  const externalizeDeps = main.build?.externalizeDeps
  if (typeof externalizeDeps !== 'object' || externalizeDeps === null) {
    throw new TypeError(
      'electron.vite.config.ts: expected `main.build.externalizeDeps` to be an options object',
    )
  }
  const exclude = externalizeDeps.exclude
  if (exclude === undefined) {
    throw new TypeError('electron.vite.config.ts: `main.build.externalizeDeps.exclude` is missing')
  }
  return exclude
}

describe('electron.vite.config.ts main externalization', () => {
  const imported = [...new Set(MAIN_SOURCE_DIRS.flatMap(sourceFiles).flatMap(valueImports))].sort()

  it('finds the workspace packages main actually imports', () => {
    // A guard on the guard: if the scan silently stopped matching, every assertion below
    // would pass vacuously.
    expect(imported).toContain('@retenia/core')
    expect(imported.length).toBeGreaterThanOrEqual(3)
  })

  // One case per package, so a missing one is named by its own failing test.
  it.each(imported)('bundles %s instead of leaving it external', (pkg) => {
    expect(excludedFromExternalization()).toContain(pkg)
  })
})
