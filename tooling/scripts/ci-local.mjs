#!/usr/bin/env node

/**
 * Run the GitHub Actions PR gate on this machine: the same steps as `.github/workflows/ci.yml`,
 * in the same order, with the same commands, under `CI=true` like a GitHub runner — so a push
 * never turns red on GitHub for something that could have been caught here first.
 *
 * Mirrors the `lint-typecheck-test` matrix job (install → licenses → i18n → contrast → lint →
 * typecheck → schema → test → coverage) and then the `e2e` job (`pnpm e2e`, which builds the
 * desktop app first through Turborepo's `e2e → build` dependency). `build-desktop` only runs on a
 * push to `main`, never on a pull request, so it is opt-in here (`--build`).
 *
 * The default run is the windows-latest leg plus the e2e job — everything CI runs on Windows, which
 * is also the platform the app targets. `--wsl` runs the ubuntu-latest leg inside WSL (see
 * tooling/scripts/ci-local-wsl.sh): same script, Linux toolchain, the Windows-only jobs skipped.
 *
 * Every step is one line of the workflow: when CI changes, this list changes with it.
 *
 * Usage: pnpm ci:local [options]        (= node tooling/scripts/ci-local.mjs [options])
 *   --list            print the steps and exit
 *   --wsl             run the ubuntu-latest leg inside WSL instead (other options are forwarded);
 *                     the first run installs Node + pnpm and a mirror clone under ~/.cache in WSL
 *   --only a,b        run only these step ids (see --list)
 *   --skip a,b        skip these step ids
 *   --no-install      shorthand for --skip install
 *   --build           also run `pnpm build` (the `build-desktop` job)
 *   --no-fail-fast    keep going after a failure and report every failing step at the end
 *   --no-cache        bypass Turborepo's cache (TURBO_FORCE=true): a from-scratch run, like a
 *                     fresh runner. The default keeps the cache: a hit means the same inputs
 *                     already passed, which is what makes the pre-push re-run cheap.
 *   --no-tune         let the test steps use their own default concurrency instead of the budget
 *                     this machine can sustain (see `tuning()`)
 *   --ignore-node     warn instead of failing when the Node major differs from .nvmrc
 *
 * Exit code: 0 when every step passed, 1 otherwise (also on a preflight failure).
 * `.githooks/pre-push` runs this with no options before every push.
 */

import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const isWindows = process.platform === 'win32'
/** Where `--wsl` publishes the working-tree snapshot for the WSL mirror to fetch (deleted afterwards). */
const SNAPSHOT_REF = 'refs/ci-local/snapshot'

/**
 * One entry per `run:` step of the workflow's PR-gating jobs, in CI order. `ci` is the step's
 * `name:` in ci.yml, verbatim, so a failure here can be matched to the Actions log by eye.
 * `platforms` restricts a step to the OS its CI job runs on (the `e2e` and `build-desktop` jobs
 * are `windows-latest`: `electron-builder --win`). `optional` steps only run when asked for.
 * `tune` marks a step that starts vitest and says in which shape, for `tuning()` below.
 */
const STEPS = [
  {
    id: 'install',
    ci: 'Install dependencies',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'install', '--frozen-lockfile'],
  },
  {
    id: 'licenses',
    ci: 'Check licenses',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'run', 'licenses:check'],
  },
  {
    id: 'i18n',
    ci: 'Check i18n key parity',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'run', 'i18n:check'],
  },
  {
    id: 'contrast',
    ci: 'Check WCAG 2.2 AA token contrast',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'run', 'contrast:check'],
  },
  { id: 'lint', ci: 'Lint', job: 'lint-typecheck-test', cmd: ['pnpm', 'lint'] },
  { id: 'typecheck', ci: 'Typecheck', job: 'lint-typecheck-test', cmd: ['pnpm', 'typecheck'] },
  {
    id: 'schema',
    ci: 'Check activity JSON Schemas (Claude strict mode)',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'run', 'schema:check'],
  },
  {
    id: 'test',
    ci: 'Test',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'test'],
    // Turborepo runs this per package, so several `vitest run` processes are alive at once.
    tune: 'fan-out',
  },
  {
    id: 'coverage',
    ci: 'Test with coverage',
    job: 'lint-typecheck-test',
    cmd: ['pnpm', 'run', 'test:coverage'],
    // One vitest process for the whole repo (the root config's `projects`).
    tune: 'single',
    // CI runs this on the ubuntu-latest leg only, but the thresholds in vitest.config.ts fail
    // the job like any other step, so it is part of the gate here too.
    note: 'ubuntu-latest leg only on CI; the coverage thresholds are a gate, so it runs here too',
  },
  {
    id: 'e2e',
    ci: 'Run Playwright E2E (builds first)',
    job: 'e2e',
    cmd: ['pnpm', 'e2e'],
    platforms: ['win32'],
    note: 'windows-latest only on CI (electron-builder --win); turbo builds the app first',
  },
  {
    id: 'build',
    ci: 'Build desktop',
    job: 'build-desktop',
    cmd: ['pnpm', 'build'],
    platforms: ['win32'],
    optional: true,
    note: 'CI runs it only on a push to main, not on pull requests — opt in with --build',
  },
]

function fail(message) {
  console.error(`ci-local: ${message}`)
  process.exit(1)
}

function warn(message) {
  console.error(`ci-local: warning: ${message}`)
}

function usage() {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  const start = lines.findIndex((line) => line.includes('Usage:'))
  const end = lines.findIndex((line, i) => i > start && line.trim() === '*/')
  for (const line of lines.slice(start, end)) console.log(line.replace(/^ \* ?/, ''))
}

function parseArgs(argv) {
  const options = {
    list: false,
    only: null,
    skip: new Set(),
    build: false,
    failFast: true,
    cache: true,
    tune: true,
    ignoreNode: false,
    wsl: false,
  }
  const ids = new Set(STEPS.map((step) => step.id))
  const parseIds = (flag, value) => {
    if (!value) fail(`${flag} needs a comma-separated list of step ids (see --list)`)
    const parsed = value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    for (const id of parsed) {
      if (!ids.has(id)) fail(`unknown step id "${id}" for ${flag} — known: ${[...ids].join(', ')}`)
    }
    return parsed
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? undefined : arg.slice(eq + 1)
    const takeValue = () => inline ?? argv[++i]
    switch (flag) {
      case '--help':
      case '-h':
        usage()
        process.exit(0)
        break
      case '--list':
        options.list = true
        break
      case '--only':
        options.only = new Set(parseIds(flag, takeValue()))
        break
      case '--skip':
        for (const id of parseIds(flag, takeValue())) options.skip.add(id)
        break
      case '--no-install':
        options.skip.add('install')
        break
      case '--build':
        options.build = true
        break
      case '--no-fail-fast':
        options.failFast = false
        break
      case '--no-cache':
        options.cache = false
        break
      case '--no-tune':
        options.tune = false
        break
      case '--ignore-node':
        options.ignoreNode = true
        break
      case '--wsl':
        options.wsl = true
        break
      default:
        fail(`unknown option "${arg}" (try --help)`)
    }
  }
  return options
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** The toolchain CI gets from `actions/setup-node` (`.nvmrc`) and `corepack` (`packageManager`). */
function preflight(options) {
  const nvmrc = readFileSync(path.join(projectRoot, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
  const wantMajor = Number.parseInt(nvmrc, 10)
  const haveMajor = Number.parseInt(process.versions.node, 10)
  if (Number.isFinite(wantMajor) && wantMajor !== haveMajor) {
    const message = `CI runs Node ${nvmrc} (.nvmrc), this is Node ${process.versions.node}. Install Node ${wantMajor} to run the same thing CI runs.`
    if (options.ignoreNode) warn(message)
    else fail(`${message} (--ignore-node to run anyway)`)
  }

  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const wantPnpm = String(pkg.packageManager ?? '').replace(/^pnpm@/, '')
  const pnpm = spawnShell(['pnpm', '--version'], { cwd: projectRoot, encoding: 'utf8' })
  if (pnpm.error || pnpm.status !== 0) {
    fail(
      `pnpm is not on PATH. CI gets it from \`corepack enable\`; without admin rights on Windows use \`corepack enable --install-directory "$APPDATA/npm"\` or \`npm i -g pnpm@${wantPnpm || 'latest'}\`.`,
    )
  }
  const havePnpm = pnpm.stdout.trim()
  if (wantPnpm && havePnpm !== wantPnpm) {
    warn(`package.json pins pnpm@${wantPnpm}, this is pnpm ${havePnpm}`)
  }
  return { node: process.versions.node, pnpm: havePnpm }
}

/**
 * The test concurrency this machine can actually sustain, as env only — the commands stay the
 * ones ci.yml runs.
 *
 * A GitHub runner has 4 vCPUs, so nothing there is oversubscribed enough to matter. A developer
 * box is the opposite: `pnpm test` lets Turborepo fan out to ~10 packages at once, each starting
 * its own `vitest run`, which by default opens about one worker per hardware thread. On a 16-thread
 * machine that is ~150 workers over 8 physical cores, and tests then trip their 5s/10s timeouts
 * while passing in ~1s on their own — a red gate that says nothing about the code. Measured on a
 * Ryzen 7 9700X (8c/16t): two different files timed out across three uncapped runs, none capped.
 *
 * The budget is half the threads — roughly one worker per physical core — split across the fan-out,
 * and three quarters of them for the single whole-repo process, which is contended enough to matter
 * but measured no slower than uncapped (46.5s vs 47.0s; 8 workers instead of 12 cost 6s more).
 * An explicitly exported value always wins, and `--no-tune` turns the whole thing off.
 */
function tuning(shape) {
  const threads = os.availableParallelism?.() ?? os.cpus().length
  if (shape !== 'fan-out') {
    return { VITEST_MAX_WORKERS: String(Math.max(2, Math.round((threads * 3) / 4))) }
  }
  const budget = Math.max(2, Math.floor(threads / 2))
  const concurrency = Math.min(4, budget)
  return {
    TURBO_CONCURRENCY: String(concurrency),
    VITEST_MAX_WORKERS: String(Math.max(1, Math.floor(budget / concurrency))),
  }
}

/** `tuning()` applied over `base`, leaving anything the caller exported by hand alone. */
function tunedEnv(base, shape) {
  const env = { ...base }
  for (const [key, value] of Object.entries(tuning(shape))) {
    if (process.env[key] === undefined) env[key] = value
  }
  return env
}

function selectSteps(options) {
  const selected = []
  for (const step of STEPS) {
    if (options.only && !options.only.has(step.id)) continue
    let skipReason = null
    if (options.skip.has(step.id)) {
      skipReason = 'skipped (--skip)'
    } else if (step.optional && !options.build && !options.only?.has(step.id)) {
      skipReason = 'not part of the PR gate (--build to include)'
    } else if (step.platforms && !step.platforms.includes(process.platform)) {
      skipReason = `CI runs this on ${step.platforms.join('/')} only`
    }
    selected.push({ step, skipReason })
  }
  return selected
}

let current = null

function killCurrent() {
  if (!current || current.exitCode !== null) return
  if (isWindows) {
    // `shell: true` puts a cmd.exe between us and pnpm; take the whole tree down.
    spawnSync('taskkill', ['/pid', String(current.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    current.kill('SIGTERM')
  }
}

/**
 * Spawn `argv` the way a CI step's `run:` line is executed. On Windows `pnpm` is a
 * `.cmd` shim, which Node refuses to spawn directly, so the command goes through the shell as
 * one string (an args array with `shell: true` is what DEP0190 warns about). Every argument
 * here is a literal from STEPS — no quoting is needed and none is done.
 */
function spawnShell(argv, options) {
  return isWindows
    ? spawnSync(argv.join(' '), { ...options, shell: true })
    : spawnSync(argv[0], argv.slice(1), options)
}

function spawnStep(argv, options) {
  return isWindows
    ? spawn(argv.join(' '), { ...options, shell: true })
    : spawn(argv[0], argv.slice(1), options)
}

function runStep(step, env) {
  return new Promise((resolve) => {
    const child = spawnStep(step.cmd, {
      cwd: projectRoot,
      env,
      // stdin is closed on purpose: nothing here is interactive, and a git hook's stdin is the
      // list of refs being pushed, which must not leak into vitest or playwright.
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    current = child
    child.on('error', (error) => resolve({ ok: false, detail: error.message }))
    child.on('exit', (code, signal) => {
      current = null
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, detail: signal ? `killed by ${signal}` : `exit code ${code}` })
    })
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const options = parseArgs(argv)
  if (options.wsl) return runInWsl(argv.filter((arg) => arg !== '--wsl'))
  const selected = selectSteps(options)

  if (options.list) {
    console.log('Steps, in the order .github/workflows/ci.yml runs them:\n')
    for (const { step, skipReason } of selected) {
      const status = skipReason ? `  [${skipReason}]` : ''
      console.log(`  ${step.id.padEnd(10)} ${step.ci}  —  ${step.cmd.join(' ')}${status}`)
      if (step.note) console.log(`  ${''.padEnd(10)} (${step.note})`)
    }
    return 0
  }

  const toolchain = preflight(options)
  const env = { ...process.env, CI: 'true' }
  if (!options.cache) env.TURBO_FORCE = 'true'

  const runnable = selected.filter((entry) => !entry.skipReason).length
  console.log(
    `ci-local: ${runnable} step(s) from .github/workflows/ci.yml on ${process.platform} — Node ${toolchain.node}, pnpm ${toolchain.pnpm}, CI=true${options.cache ? '' : ', TURBO_FORCE=true'}`,
  )
  if (options.tune && selected.some((entry) => entry.step.tune && !entry.skipReason)) {
    const show = (shape) =>
      Object.entries(tuning(shape))
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
    const threads = os.availableParallelism?.() ?? os.cpus().length
    console.log(
      `ci-local: ${threads} threads — test: ${show('fan-out')}, coverage: ${show('single')} (--no-tune for the uncapped defaults)`,
    )
  }

  const results = []
  const startedAll = Date.now()
  let failed = false
  let index = 0
  for (const { step, skipReason } of selected) {
    index++
    const label = `[${index}/${selected.length}] ${step.ci}`
    if (skipReason) {
      results.push({ step, status: 'skip', detail: skipReason })
      console.log(`\n— ${label}: ${skipReason}`)
      continue
    }
    if (failed && options.failFast) {
      results.push({ step, status: 'skip', detail: 'not run: an earlier step failed' })
      continue
    }
    console.log(`\n▶ ${label}\n  $ ${step.cmd.join(' ')}`)
    const started = Date.now()
    const result = await runStep(step, options.tune && step.tune ? tunedEnv(env, step.tune) : env)
    const ms = Date.now() - started
    if (result.ok) {
      results.push({ step, status: 'ok', ms })
      console.log(`✔ ${step.ci} (${formatDuration(ms)})`)
    } else {
      failed = true
      results.push({ step, status: 'fail', ms, detail: result.detail })
      console.error(`✖ ${step.ci} failed — ${result.detail} (${formatDuration(ms)})`)
    }
  }

  console.log(`\n${'─'.repeat(72)}`)
  for (const result of results) {
    const mark = result.status === 'ok' ? ' ok ' : result.status === 'fail' ? 'FAIL' : 'skip'
    const time = result.ms === undefined ? '' : formatDuration(result.ms).padStart(8)
    const detail = result.status === 'ok' ? '' : `  ${result.detail}`
    console.log(`  ${mark}  ${result.step.ci.padEnd(48)}${time}${detail}`)
  }
  console.log('─'.repeat(72))

  const failures = results.filter((r) => r.status === 'fail').map((r) => r.step.ci)
  const total = formatDuration(Date.now() - startedAll)
  if (failures.length > 0) {
    console.error(
      `ci-local: ${failures.length} step(s) failed in ${total}: ${failures.join(', ')} — this push would turn CI red.`,
    )
    return 1
  }
  console.log(`ci-local: green in ${total} — the same steps CI runs all passed.`)
  return 0
}

/**
 * `--wsl`: the ubuntu-latest leg. Snapshots the working tree — tracked and untracked files, ignored
 * ones excluded, uncommitted changes included — into SNAPSHOT_REF without touching the index or the
 * tree, then hands over to tooling/scripts/ci-local-wsl.sh inside WSL, which keeps its own Node/pnpm
 * and a mirror clone under ~/.cache and runs this very script there. Being Linux, that run skips the
 * windows-latest-only jobs by itself. Every other option is forwarded.
 */
async function runInWsl(forward) {
  if (!isWindows) {
    fail('--wsl is for Windows; on Linux this script already runs the ubuntu-latest leg')
  }
  const wsl = (args, options = {}) =>
    spawnSync('wsl.exe', args, { cwd: projectRoot, encoding: 'utf8', ...options })
  const probe = wsl(['-e', 'true'], { stdio: 'ignore' })
  if (probe.error || probe.status !== 0) {
    fail(
      'WSL is not available (`wsl.exe -e true` failed) — install a distro with `wsl --install` first',
    )
  }
  const translated = wsl(['-e', 'wslpath', '-u', projectRoot])
  if (translated.status !== 0) fail(`wslpath could not translate ${projectRoot}`)
  const repo = translated.stdout.trim()

  const git = (args, options = {}) => {
    const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', ...options })
    if (result.error || result.status !== 0) {
      fail(`git ${args.join(' ')} failed: ${(result.stderr ?? result.error?.message ?? '').trim()}`)
    }
    return result.stdout.trim()
  }
  // A throwaway index keeps `git add -A` away from the real one: the user's staging area is not ours.
  const indexFile = path.join(os.tmpdir(), `ci-local-index-${process.pid}`)
  const env = { ...process.env, GIT_INDEX_FILE: indexFile }
  let commit
  try {
    git(['read-tree', 'HEAD'], { env })
    git(['add', '-A'], { env })
    const tree = git(['write-tree'], { env })
    commit = git([
      'commit-tree',
      tree,
      '-p',
      'HEAD',
      '-m',
      'ci-local: snapshot of the working tree',
    ])
    git(['update-ref', SNAPSHOT_REF, commit])
  } finally {
    rmSync(indexFile, { force: true })
  }
  console.log(
    `ci-local: working tree snapshot ${commit.slice(0, 7)} → ${SNAPSHOT_REF}; running the ubuntu-latest leg in WSL`,
  )

  const code = await new Promise((resolve) => {
    // Piped, not inherited: handing wsl.exe the parent's stdout handle kills this process with an
    // access violation whenever that handle is a pipe (e.g. `pnpm ci:local --wsl | tee`, or any
    // non-terminal caller) and something was already written to it — Node/WSL console quirk,
    // reproduced deterministically. Forwarding the chunks by hand costs nothing.
    const child = spawn(
      'wsl.exe',
      ['-e', 'bash', `${repo}/tooling/scripts/ci-local-wsl.sh`, repo, ...forward],
      { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stdout.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    current = child
    child.on('error', (error) => resolve({ code: 1, detail: error.message }))
    child.on('exit', (exitCode, signal) => {
      current = null
      resolve({ code: exitCode ?? 1, detail: signal ? `killed by ${signal}` : null })
    })
  })
  // The mirror has fetched it by now; nothing else should ever see this ref.
  const cleanup = spawnSync('git', ['update-ref', '-d', SNAPSHOT_REF], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  if (cleanup.status !== 0) warn(`could not delete ${SNAPSHOT_REF}: ${cleanup.stderr.trim()}`)
  if (code.detail) console.error(`ci-local: WSL leg ${code.detail}`)
  return code.code
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killCurrent()
    process.exit(130)
  })
}

main().then(
  (code) => process.exit(code),
  (error) => {
    killCurrent()
    fail(error?.stack ?? String(error))
  },
)
