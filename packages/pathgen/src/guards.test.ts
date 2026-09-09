import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WARNING_CODES } from './schemas/warnings'

/**
 * Structural guards, in the shape of `packages/ai/src/guards.test.ts`: the pure stages must
 * stay pure, and the warning vocabulary must stay alive.
 */

const SRC = join(import.meta.dirname, '.')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const sources = (dir: string): string[] =>
  walk(join(SRC, dir)).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))

describe('the deterministic stages', () => {
  const files = ['graph', 'validate', 'sequencing'].flatMap(sources)

  it('scan the three directories', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each([
    ['Math.random', /Math\.random/],
    ['Date.now', /Date\.now/],
    ['a clock read', /new Date\(\)/],
    ['localeCompare', /\.localeCompare\(/],
    ['node built-ins', /from ['"]node:/],
    ['crypto', /\bcrypto\b/],
    ['the AI layer', /@retenia\/ai/],
  ])('never reach for %s', (_, pattern) => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(pattern)
    }
  })
})

describe('the warning vocabulary', () => {
  const tests = walk(SRC).filter((file) => file.endsWith('.test.ts'))
  const corpus = tests.map((file) => readFileSync(file, 'utf8')).join('\n')

  it.each(WARNING_CODES)('has a test that names %s', (code) => {
    expect(corpus).toContain(`'${code}'`)
  })
})
