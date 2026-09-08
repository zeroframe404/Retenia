#!/usr/bin/env node

/**
 * Point git at the tracked hooks in `.githooks/` (`core.hooksPath`), so `.githooks/pre-push`
 * runs the local CI gate (`tooling/scripts/ci-local.mjs`) before every push from this clone.
 *
 * Runs as the root `prepare` script — on every `pnpm install`, so a fresh clone is gated as soon
 * as it is installed — and by hand via `pnpm hooks:install`. It never fails the install: outside
 * a git checkout, or when git is missing, it says so and exits 0. A `core.hooksPath` that already
 * points somewhere else (a personal hooks directory) is left alone and reported, not overwritten.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const hooksDir = '.githooks'

const git = (...args) => spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' })

// `.git` is a directory in a normal clone and a file in a worktree; both count.
if (!existsSync(path.join(projectRoot, '.git'))) {
  console.log('install-hooks: not a git checkout, nothing to do')
  process.exit(0)
}

const probe = git('rev-parse', '--is-inside-work-tree')
if (probe.error || probe.status !== 0) {
  console.log('install-hooks: git is not available, skipping (the pre-push gate is not installed)')
  process.exit(0)
}

const current = git('config', '--get', 'core.hooksPath')
const value = current.status === 0 ? current.stdout.trim() : ''

if (value && value !== hooksDir) {
  console.warn(
    `install-hooks: core.hooksPath is already "${value}", leaving it alone. To enable the pre-push CI gate run: git config core.hooksPath ${hooksDir}`,
  )
} else if (value !== hooksDir) {
  const set = git('config', 'core.hooksPath', hooksDir)
  if (set.status !== 0) {
    console.warn(`install-hooks: could not set core.hooksPath: ${set.stderr.trim()}`)
    process.exit(0)
  }
  console.log(`install-hooks: core.hooksPath → ${hooksDir} (pre-push runs the local CI gate)`)
}

// Git on Windows runs hooks through sh regardless of the mode bit; POSIX needs it set, and a
// clone made on Windows (core.filemode=false) may not carry it.
if (process.platform !== 'win32') {
  const dir = path.join(projectRoot, hooksDir)
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.md')) continue
    try {
      chmodSync(path.join(dir, name), 0o755)
    } catch (error) {
      console.warn(`install-hooks: could not chmod ${hooksDir}/${name}: ${error.message}`)
    }
  }
}
