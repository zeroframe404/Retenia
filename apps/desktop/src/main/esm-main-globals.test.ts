import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `src/main/**` may not reach for CommonJS globals.
 *
 * `apps/desktop` is `"type": "module"` and electron-vite emits the main bundle as ESM, where
 * `__dirname`, `__filename` and `require` do not exist. They nevertheless *worked* for a long
 * time, because electron-vite prepends a shim — `const __dirname = import.meta.dirname`, a
 * `createRequire` — whenever the graph it bundles needs CJS interop. That shim is a side
 * effect of the dependencies, not a guarantee: sub-phase 7.1 changed the module graph, the
 * shim stopped being emitted, and the five `__dirname` call sites in `index.ts` and `paths.ts`
 * became a `ReferenceError` thrown before `app.whenReady()` — no window, no log, nothing.
 *
 * Nothing cheap catches that. `typecheck` is happy (`@types/node` declares these globals for
 * the whole project), and the unit tests import the TypeScript directly, where Vitest supplies
 * them. Only a bundled build reproduces it, and the one job that runs one — `e2e` — reports it
 * as all 49 Playwright tests failing at once with "Test timeout of 30000ms exceeded while
 * setting up electronApp", after ~45 minutes of a Windows runner and a job cancelled on its
 * cap. This test is here so the same mistake costs seconds instead, in `lint-typecheck-test`,
 * which gates `e2e`.
 *
 * `import.meta.dirname` and `import.meta.filename` are the replacements, and
 * `node:module`'s `createRequire` the one for `require`. `src/preload` is deliberately not
 * scanned: a sandboxed preload is bundled as CommonJS (`index.cjs`), so there these are real.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '../..')

/** The roots electron-vite builds with the `main` config — the same list the sibling
 *  externalization test scans, and for the same reason. */
const MAIN_SOURCE_DIRS = ['src/main', 'src/worker', 'src/jobs']

/** Globals CommonJS defines and an ES module does not. */
const CJS_GLOBALS = [
  { name: '__dirname', pattern: /(?<![\w$.])__dirname\b/, use: 'import.meta.dirname' },
  { name: '__filename', pattern: /(?<![\w$.])__filename\b/, use: 'import.meta.filename' },
  {
    name: 'require()',
    // `createRequire(...)` and `foo.require(...)` are not the bare global.
    pattern: /(?<![\w$.])require\s*\(/,
    use: "createRequire(import.meta.url) from 'node:module'",
  },
] as const

function sourceFiles(dir: string): string[] {
  const absolute = path.join(desktopRoot, dir)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
    // Tests run under Vitest, not in the bundle, and several of them talk *about* these
    // globals — including this file.
    if (/\.test\.tsx?$/.test(entry.name)) continue
    found.push(path.join(entry.parentPath, entry.name))
  }
  return found
}

/**
 * Blank out comments and string literals, preserving offsets and line breaks.
 *
 * Every one of these globals is named in prose somewhere in `src/main` — `paths.ts` explains
 * which directory it resolves against, `ipc/handlers.ts` recounts an earlier run-in with the
 * shim — so a plain text search reports the documentation and never the bug. A scanner is
 * used rather than a regex per comment form because the two nest: a `//` inside a string and
 * a quote inside a comment each break the naive version, in opposite directions.
 */
function stripCommentsAndStrings(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  let out = ''
  let i = 0

  while (i < source.length) {
    const rest = source.slice(i)

    if (rest.startsWith('//')) {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }

    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }

    const quote = rest[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      let j = i + 1
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === quote) {
          j += 1
          break
        }
        j += 1
      }
      // The quotes themselves stay, so an empty string literal is still syntactically visible.
      out += quote + blank(source.slice(i + 1, j - 1)) + (source[j - 1] ?? '')
      i = j
      continue
    }

    out += source[i]
    i += 1
  }

  return out
}

describe('the main bundle is ESM, so its sources may not use CommonJS globals', () => {
  const files = MAIN_SOURCE_DIRS.flatMap(sourceFiles)

  it('finds the files it is supposed to scan', () => {
    // A guard on the guard: a scan that silently stopped matching would pass vacuously.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((file) => file.endsWith('paths.ts'))).toBe(true)
  })

  it.each(CJS_GLOBALS)('no source uses $name — use $use', ({ pattern }) => {
    const offenders: string[] = []
    for (const file of files) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf-8'))
      code.split('\n').forEach((line, index) => {
        if (pattern.test(line)) {
          offenders.push(`${path.relative(desktopRoot, file)}:${index + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('stripCommentsAndStrings', () => {
  it('blanks line and block comments but keeps code', () => {
    const stripped = stripCommentsAndStrings(
      'const a = 1 // __dirname\n/* __dirname */ const b = 2',
    )
    expect(stripped).not.toMatch(/__dirname/)
    expect(stripped).toContain('const a = 1')
    expect(stripped).toContain('const b = 2')
  })

  it('blanks string contents, including a quote inside a comment', () => {
    expect(stripCommentsAndStrings('const p = "__dirname/x"')).not.toMatch(/__dirname/)
    expect(stripCommentsAndStrings("// it's about __dirname\nconst a = 1")).toContain('const a = 1')
  })

  it('keeps line numbers stable, so an offender is reported at its own line', () => {
    const source = '/* a\n b */\nconst x = __dirname'
    const stripped = stripCommentsAndStrings(source)
    expect(stripped.split('\n')).toHaveLength(3)
    expect(stripped.split('\n')[2]).toContain('__dirname')
  })

  it('does not mistake createRequire for the bare require global', () => {
    const pattern = CJS_GLOBALS[2].pattern
    expect(pattern.test('const require2 = createRequire(import.meta.url)')).toBe(false)
    expect(pattern.test('const x = require("node:fs")')).toBe(true)
  })
})
