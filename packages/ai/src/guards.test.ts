import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards over this package's own source.
 *
 * Each returns offenders as `path:line: text` compared with `.toEqual([])`, so a failure
 * names the exact line; and each carries a guard on the guard, because an empty scan would
 * otherwise satisfy every assertion here vacuously.
 */

const SRC = path.dirname(fileURLToPath(import.meta.url))

/** Repo-relative paths with `/`, so an offender reads the same on Windows and on Linux. */
function posix(file: string): string {
  return file.split(/[\\/]/).join('/')
}

function sourceFiles(options: { tests: boolean }): string[] {
  const found: string[] = []
  for (const entry of readdirSync(SRC, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const isTest = entry.name.endsWith('.test.ts')
    if (isTest !== options.tests) continue
    found.push(path.join(entry.parentPath, entry.name))
  }
  return found
}

/**
 * A comment naming the thing a scan forbids is not an instance of it — the same exemption
 * `apps/desktop/src/main/import-shaped-strings.test.ts` makes, and for the same reason:
 * without it, documenting the rule breaks the rule.
 */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/

function scan(files: readonly string[], pattern: RegExp): string[] {
  const hits: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n')
    for (const [index, line] of lines.entries()) {
      if (COMMENT_LINE.test(line)) continue
      if (pattern.test(line))
        hits.push(`${posix(path.relative(SRC, file))}:${index + 1}: ${line.trim()}`)
    }
  }
  return hits
}

describe('no mocks in this package', () => {
  const tests = sourceFiles({ tests: true })

  it('scans every test file', () => {
    expect(tests.length).toBeGreaterThan(8)
  })

  it('uses injected seams rather than vi.mock or fake timers', () => {
    // Everything impure arrives as an argument: the SDK through `bindModel`, the provider
    // through `ProviderInvoker`, delays through `Timers`, jitter through `Random`. A
    // `vi.mock` here would mean a seam is missing, and `vi.useFakeTimers()` would mean a
    // delay is being measured rather than asserted.
    expect(scan(tests, /\bvi\.mock\(|\bvi\.useFakeTimers\(/)).toEqual([])
  })
})

describe('the pure entry point', () => {
  const all = sourceFiles({ tests: false })
  const outsideProviders = all.filter((file) => !path.relative(SRC, file).startsWith('providers'))

  it('scans the whole package', () => {
    expect(all.length).toBeGreaterThan(15)
    expect(outsideProviders.length).toBeGreaterThan(12)
  })

  it('reaches the AI SDK from src/providers and nowhere else', () => {
    // `@retenia/ingest` and `@retenia/activity-ai` import this package for its types and
    // must not pull a provider SDK into their graphs.
    expect(scan(outsideProviders, /from '(ai|ai\/[\w-]+|@ai-sdk\/[\w-]+)'/)).toEqual([])
  })

  it('never reaches src/providers from the pure graph', () => {
    // The import scan above is per file; this one is the graph, walked from the entry
    // point, so a pure module cannot smuggle the SDK in through a chain of re-exports.
    const seen = new Set<string>()
    const queue = [path.join(SRC, 'index.ts')]
    while (queue.length > 0) {
      const file = queue.pop()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      const source = readFileSync(file, 'utf-8')
      for (const match of source.matchAll(/from '(\.[^']*)'/g)) {
        const specifier = match[1]
        if (specifier === undefined) continue
        const resolved = path.resolve(path.dirname(file), specifier)
        for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
          try {
            readFileSync(candidate, 'utf-8')
            queue.push(candidate)
            break
          } catch {
            // Not this shape; try the next.
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(10)
    const leaked = [...seen]
      .map((file) => path.relative(SRC, file))
      .filter((file) => file.startsWith('providers'))
    expect(leaked).toEqual([])
  })
})

describe('the SDK call site', () => {
  const providers = sourceFiles({ tests: false }).filter((file) =>
    path.relative(SRC, file).startsWith('providers'),
  )

  it('scans the providers directory', () => {
    expect(providers.length).toBeGreaterThan(3)
  })

  it('disables the SDK own retries at every generate call site', () => {
    // Ours is the loop that writes one `ai_calls` row per attempt. A `generateText` left at
    // the SDK's default of `maxRetries: 2` would retry underneath it, so the attempts would
    // be invisible to the log and the sub-phase's second acceptance criterion — "both
    // attempts are logged" — would be false while still appearing to pass.
    const callSites: string[] = []
    for (const file of providers) {
      const lines = readFileSync(file, 'utf-8').split('\n')
      for (const [index, line] of lines.entries()) {
        if (!/\b(generateText|streamText)\s*\(/.test(line)) continue
        const window = lines.slice(index, index + 40).join('\n')
        if (!/maxRetries:\s*0/.test(window)) {
          callSites.push(`${posix(path.relative(SRC, file))}:${index + 1}: ${line.trim()}`)
        }
      }
    }
    expect(callSites).toEqual([])
  })
})
