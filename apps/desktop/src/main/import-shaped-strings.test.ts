import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'

/**
 * No string in the code bundled into main may read like an ES import statement.
 *
 * electron-vite gives the ESM main bundle its `__dirname`/`__filename`/`require` by inserting
 * a shim block right after what a regex takes to be the chunk's last import statement. A log
 * message such as `could not import "${file}"` satisfies that regex, so the shim was inserted
 * inside the string and `__dirname` was never defined at module scope: main threw before it
 * opened a window. As with `externalize-main-deps.test.ts`, nothing cheap notices — only the
 * built bundle reproduces it, and the one job that runs that, `e2e`, reports it as every
 * Playwright test timing out in `electronApp` setup, ~50 minutes into a Windows runner. This
 * test makes the same mistake cost seconds instead.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '../..')
const repoRoot = path.resolve(desktopRoot, '../..')

/** The roots electron-vite builds with the `main` config: the app entry and the job worker. */
const MAIN_SOURCE_DIRS = ['src/main', 'src/worker', 'src/jobs']

/**
 * The word `import` followed by an optional binding clause and a quoted specifier — the shape
 * electron-vite's shim placement looks for. A dynamic `import(...)` has no whitespace before
 * its parenthesis and does not match.
 */
const IMPORT_SHAPED = /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"`]/

/** Real statements and comments: the former are what the regex is meant to find, the latter
 *  never reach the bundle. */
const NOT_A_STRING_LINE = /^\s*(?:import\b|export\b|\/\/|\/\*|\*)/

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.(?:test|stories|d)\.tsx?$/.test(entry.name)) continue
    found.push(path.join(entry.parentPath, entry.name))
  }
  return found
}

/** Every directory whose TypeScript ends up in the main bundle: the desktop roots above plus
 *  the `src/` of each workspace package the config excludes from externalization. */
function bundledSourceDirs(): string[] {
  const main = config.main
  if (typeof main !== 'object' || main === null) {
    throw new TypeError('electron.vite.config.ts: `main` is expected to be a config object')
  }
  const externalizeDeps = main.build?.externalizeDeps
  if (typeof externalizeDeps !== 'object' || externalizeDeps === null) {
    throw new TypeError(
      'electron.vite.config.ts: expected `main.build.externalizeDeps` to be an options object',
    )
  }
  const bundledPackages = (externalizeDeps.exclude ?? [])
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((name) => name.startsWith('@retenia/'))
    .map((name) => path.join(repoRoot, 'packages', name.slice('@retenia/'.length), 'src'))
  return [...MAIN_SOURCE_DIRS.map((dir) => path.join(desktopRoot, dir)), ...bundledPackages]
}

function importShapedLines(file: string): string[] {
  const offenders: string[] = []
  readFileSync(file, 'utf-8')
    .split('\n')
    .forEach((line, index) => {
      if (NOT_A_STRING_LINE.test(line)) return
      if (!IMPORT_SHAPED.test(line)) return
      offenders.push(`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`)
    })
  return offenders
}

describe('strings in the main bundle', () => {
  const dirs = bundledSourceDirs()
  const files = dirs.flatMap(sourceFiles)

  it('scans the desktop main roots and every bundled workspace package', () => {
    // A guard on the guard: an empty scan would pass the assertion below vacuously.
    expect(dirs.length).toBeGreaterThan(MAIN_SOURCE_DIRS.length)
    expect(files.length).toBeGreaterThan(50)
  })

  it('contain nothing shaped like an import statement', () => {
    expect(files.flatMap(importShapedLines)).toEqual([])
  })
})
