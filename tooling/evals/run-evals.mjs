#!/usr/bin/env node
/**
 * `pnpm evals`: runs `tooling/evals/promptfooconfig.yaml` and writes
 * `docs/evals/<YYYY-MM-DD>.md`. Real API spend — **skipped in CI** by design, per
 * `docs/spec/06-ai-providers.md` §6's "build a 50-item Spanish eval before fixing the
 * commercial model (< USD 2 per run)".
 *
 * The spend cap is enforced inside `providers/role-provider.mjs`, not here: promptfoo runs
 * every test case in one Node process, so a real-time cap there can refuse the *next* call
 * before it dials out. This script only reads the ledger that provider writes, and best-effort
 * summarizes promptfoo's own JSON report — degrading to "unknown" for anything whose shape
 * changed under it, rather than crashing a run that otherwise succeeded.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const LEDGER_PATH = path.join(HERE, '.spend-ledger.json')
const RESULTS_PATH = path.join(HERE, '.last-results.json')
const REPORTS_DIR = path.join(REPO_ROOT, 'docs', 'evals')

function today() {
  return new Date().toISOString().slice(0, 10)
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return undefined
  }
}

/**
 * A defensive scan for `{pass, cost}`-shaped result entries, wherever they live in
 * promptfoo's JSON — this is deliberately shape-tolerant rather than pinned to one version's
 * exact schema (`results.results[]`, `results.table.body[]`… promptfoo has used more than
 * one of these across releases).
 */
function summarizeResults(json) {
  const found = []
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    const pass =
      typeof node.pass === 'boolean'
        ? node.pass
        : typeof node.success === 'boolean'
          ? node.success
          : typeof node.gradingResult?.pass === 'boolean'
            ? node.gradingResult.pass
            : undefined

    if (pass !== undefined) {
      // A matched result is a leaf for this scan's purposes: recursing into it too (its own
      // `gradingResult`, say) would count the same test case twice.
      found.push({ pass })
      return
    }
    for (const value of Object.values(node)) visit(value)
  }
  visit(json)

  if (found.length === 0) return undefined
  const passed = found.filter((r) => r.pass).length
  return { total: found.length, passed, rate: passed / found.length }
}

/** Whether this run should skip the real eval entirely — the whole CI-skip mechanism, as one
 *  pure, testable check rather than an inline `if` `main` no test can reach. */
export function shouldSkipForCi(env) {
  return Boolean(env.CI)
}

/** Would the next call be allowed to spend, given what has been spent so far? The same rule
 *  `providers/role-provider.mjs` enforces in-process; kept here too as a pure function so the
 *  cap logic itself has a test that needs no real AI client. */
export function hasSpendRemaining(spentUsd, capUsd) {
  return spentUsd < capUsd
}

export { summarizeResults }

function main() {
  if (shouldSkipForCi(process.env)) {
    console.log('[evals] CI=1 — skipping (this suite spends real money; run it locally).')
    process.exit(0)
  }

  rmSync(LEDGER_PATH, { force: true })
  rmSync(RESULTS_PATH, { force: true })

  console.log('[evals] running promptfoo…')
  const result = spawnSync(
    'pnpm',
    ['exec', 'promptfoo', 'eval', '-c', 'promptfooconfig.yaml', '-o', '.last-results.json'],
    { cwd: HERE, stdio: 'inherit', shell: process.platform === 'win32' },
  )

  const ledger = readJsonSafe(LEDGER_PATH)
  const resultsJson = readJsonSafe(RESULTS_PATH)
  const summary = resultsJson ? summarizeResults(resultsJson) : undefined

  const spentUsd = ledger?.spentUsd
  const capUsd = ledger?.capUsd

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true })
  const reportPath = path.join(REPORTS_DIR, `${today()}.md`)
  const lines = [
    `# AI evals — ${today()}`,
    '',
    `- Exit code: ${result.status ?? 'unknown'}`,
    `- Total spend: ${spentUsd === undefined ? 'unknown (ledger not written)' : `USD ${spentUsd.toFixed(4)} of a USD ${capUsd.toFixed(2)} cap`}`,
    summary
      ? `- Pass rate: ${summary.passed}/${summary.total} (${(summary.rate * 100).toFixed(1)}%)`
      : '- Pass rate: could not be read from promptfoo’s JSON output this run',
    '',
    'Datasets: theory-quality.es.json, grading-agreement.es.json, tone.es.json — see `tooling/evals/datasets/`.',
    '',
    `Full promptfoo JSON: \`tooling/evals/.last-results.json\` (not committed — regenerate with \`pnpm evals\`).`,
    '',
  ]
  writeFileSync(reportPath, `${lines.join('\n')}\n`)
  console.log(`[evals] wrote ${path.relative(REPO_ROOT, reportPath)}`)

  process.exit(result.status ?? 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
