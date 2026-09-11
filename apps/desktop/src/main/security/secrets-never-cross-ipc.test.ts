import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETTINGS } from '@retenia/core'
import { contract, events } from '@retenia/ipc-contract'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * "Keys never cross IPC" — the third acceptance criterion of sub-phase 7.1.
 *
 * The strongest guarantee is structural rather than tested: 7.1 adds no `ai.*` channel and
 * changes no existing one, so there is no new surface for a key to cross. What follows
 * guards the surface that already exists, in five independent layers, because any single
 * one is easy to walk around: a schema can be renamed, a call site moved, an allowlist left
 * to rot.
 *
 * Every layer reports offenders as `path:line: text` compared with `.toEqual([])`, so a
 * failure names the exact place; and every layer carries a guard on the guard, because an
 * empty scan would otherwise satisfy all of this vacuously.
 */

const DESKTOP_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPO_ROOT = path.resolve(DESKTOP_SRC, '../../..')

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/

/**
 * Repo-relative paths with `/`, on every platform.
 *
 * `path.relative` emits `\` on Windows, and CI runs this suite on `windows-latest` as well
 * as `ubuntu-latest` — layers 4 and 5 compare paths, so without this they pass on one runner
 * and fail on the other. It also keeps an offender's `path:line:` message identical
 * wherever it was produced, which is the point of reporting one.
 */
function posix(file: string): string {
  return file.split(/[\\/]/).join('/')
}

function filesUnder(root: string, options: { includeTests: boolean }): string[] {
  const found: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true, recursive: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
    if (entry.parentPath.includes('node_modules')) continue
    if (!options.includeTests && /\.(?:test|stories|d)\.tsx?$/.test(entry.name)) continue
    // `packages/*/src/testing/**` is shared test scaffolding, not shipped code — the same
    // exclusion the root vitest config already makes for coverage.
    if (!options.includeTests && /(?:^|[\\/])testing[\\/]/.test(entry.parentPath)) continue
    found.push(path.join(entry.parentPath, entry.name))
  }
  return found
}

function scan(files: readonly string[], pattern: RegExp): string[] {
  const hits: string[] = []
  for (const file of files) {
    for (const [index, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
      if (COMMENT_LINE.test(line)) continue
      if (pattern.test(line)) {
        hits.push(`${posix(path.relative(REPO_ROOT, file))}:${index + 1}: ${line.trim()}`)
      }
    }
  }
  return hits
}

/**
 * Words that, in the name of a field crossing the bridge, would mean a credential. `key` is
 * in deliberately, even though it has innocent uses — those are enumerated in `JUSTIFIED`
 * below, which is the point: each one is a decision somebody made, not a gap.
 */
const CREDENTIAL_WORDS = new Set([
  'key',
  'apikey',
  'secret',
  'token',
  'password',
  'credential',
  'credentials',
  'bearer',
  'authorization',
])

/**
 * Every innocent use of a credential word, with the reason it is innocent.
 *
 * Seeded from a real run rather than guessed, and layer 2 fails if an entry stops naming a
 * field that exists — an allowlist nobody prunes becomes a list of suppressions.
 */
const JUSTIFIED: Readonly<Record<string, string>> = {
  key: 'a SettingsRepository key NAME; settings.get/set reject anything not in the SETTINGS registry',
  hasSecret: 'a boolean: whether a key is stored. Never the key itself',
  tokenCount: 'LLM tokens in a chunk (sub-phase 6.2), not an auth token',
  chunkTokenCount: 'LLM tokens across a source chunk set, not an auth token',
  hasKey: 'ai.listProviderCards: a boolean, the same shape as hasSecret above',
  keyPreview: 'ai.listProviderCards: the same masked `••••wxyz` shape secrets.get answers with',
  modelKey:
    'the pricing table\'s "<kind>:<modelId>" row id (packages/ai/src/pricing/types.ts) — a catalog key, not a credential',
  chunk_key:
    'pathgen source_ref: a chunk dedup identifier (packages/db chunks.chunk_key), not a credential',
}

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s._-]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0)
}

interface FieldHit {
  channel: string
  field: string
}

function collectFields(schema: z.ZodType): { names: string[]; open: boolean } {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as unknown
  const names: string[] = []
  let open = false

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const properties = record['properties']
    if (properties !== undefined && typeof properties === 'object' && properties !== null) {
      for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
        names.push(name)
        walk(child)
      }
      // A declared object with no `additionalProperties: false` still strips unknown keys at
      // runtime (zod's default), so it is closed for our purposes.
    } else if (
      record['type'] === 'object' &&
      record['properties'] === undefined &&
      record['additionalProperties'] !== false
    ) {
      open = true
    }
    if (record['type'] === undefined && Object.keys(record).length === 0) open = true
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) for (const item of value) walk(item)
      else walk(value)
    }
  }

  walk(json)
  return { names, open }
}

describe('layer 1 — no field crossing the bridge is named like a credential', () => {
  const entries: Array<{ channel: string; schema: z.ZodType }> = []
  for (const [name, definition] of Object.entries(contract)) {
    entries.push({ channel: `${name}.input`, schema: definition.input })
    entries.push({ channel: `${name}.output`, schema: definition.output })
  }
  for (const [name, schema] of Object.entries(events)) {
    entries.push({ channel: `event:${name}`, schema })
  }

  it('scans every channel and every event', () => {
    expect(Object.keys(contract).length).toBeGreaterThan(20)
    expect(entries.length).toBeGreaterThan(45)
  })

  it('converts every schema, because one it cannot read is one it cannot check', () => {
    const failed: string[] = []
    for (const { channel, schema } of entries) {
      try {
        collectFields(schema)
      } catch (error) {
        failed.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(failed).toEqual([])
  })

  it('names no field after a credential, except the justified ones', () => {
    const offenders: FieldHit[] = []
    for (const { channel, schema } of entries) {
      for (const field of collectFields(schema).names) {
        if (Object.hasOwn(JUSTIFIED, field)) continue
        if (words(field).some((word) => CREDENTIAL_WORDS.has(word))) {
          offenders.push({ channel, field })
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('layer 2 — the justifications stay honest', () => {
  it('names only fields that still exist', () => {
    // An allowlist nobody prunes becomes a list of suppressions.
    const live = new Set<string>()
    for (const definition of Object.values(contract)) {
      for (const schema of [definition.input, definition.output]) {
        for (const field of collectFields(schema).names) live.add(field)
      }
    }
    for (const schema of Object.values(events)) {
      for (const field of collectFields(schema).names) live.add(field)
    }
    expect(live.size).toBeGreaterThan(50)
    expect(Object.keys(JUSTIFIED).filter((field) => !live.has(field))).toEqual([])
  })
})

describe('layer 3 — the outputs with a JSON hole are a known, visible set', () => {
  /**
   * `registerHandlers` returns `output.safeParse(result).data` — the *parsed* value — so a
   * declared `z.object` acts as a whitelist filter: a field a handler returned by accident
   * is stripped before it crosses the bridge. That protection only exists where the schema
   * declares its properties.
   *
   * Note what is deliberately NOT asserted: that an output *rejects* an unexpected field.
   * Zod strips rather than rejecting, and stripping is exactly the fail-closed behaviour we
   * want. The thing worth finding is a schema with nothing to strip against.
   *
   * The set below is what a real run reports, not a guess. Each of these carries domain
   * JSON — a job's result, a setting's value, an activity payload, a deep link — none of
   * which main ever populates from a secret (layer 4 pins where a key is even read). Listing
   * them makes a *new* hole a visible diff for someone to think about, rather than silently
   * widening the surface.
   *
   * Inputs are excluded: they travel renderer -> main, which is not a direction a key can
   * leak in.
   */
  const OPEN_OUTPUTS: readonly string[] = [
    // `perMillionUsd` is keyed by model id (`z.record`), so the JSON Schema has no fixed
    // property list — a catalog of prices, not a hole a secret could pass through.
    'ai.listProviderCards.output',
    'event:app.deepLink',
    'event:settings.changed',
    'jobs.cancel.output',
    'jobs.enqueueDemo.output',
    'jobs.list.output',
    'jobs.retry.output',
    'library.getSourceDoc.output',
    'memory.forecast.output',
    'memory.rescheduleNow.output',
    'memory.simulateReschedule.output',
    // Every one of these carries `warnings[]`, whose `params` is `z.record(...)` (a
    // generation warning's free-form arguments, e.g. `{ chunk_id, error }`) — the same
    // "catalog, not a hole" shape as `perMillionUsd` above. Never populated from a secret:
    // warnings are produced entirely inside `packages/pathgen`, which never reads a key.
    'pathgen.cancel.output',
    'pathgen.editDraft.output',
    'pathgen.expand.output',
    'pathgen.getLessons.output',
    'pathgen.getQaReport.output',
    'pathgen.getRun.output',
    'pathgen.getVersion.output',
    'pathgen.quote.output',
    'pathgen.regenerateLesson.output',
    'pathgen.resume.output',
    'pathgen.start.output',
    // Stage 9 (sub-phase 8.5): the item bank's status carries the same `warnings[]` catalog.
    'pathgen.buildItemBank.output',
    'pathgen.getItemBank.output',
    // The diagnostic's state carries the served item's `activity` (`z.json()`, the envelope the
    // host renders — the same hole as `session.next`), and `diagnosticGet` the bank's
    // warnings too. The envelope is an `item_bank` activity P9 wrote from the learner's own
    // sources; main never populates it from a secret.
    'pathgen.diagnosticAnswer.output',
    'pathgen.diagnosticFinish.output',
    'pathgen.diagnosticGet.output',
    'pathgen.diagnosticRevert.output',
    'pathgen.diagnosticStart.output',
    'scheduler.optimize.output',
    'session.answer.output',
    'session.next.output',
    'session.plan.output',
    'session.start.output',
    'settings.get.output',
    'settings.set.output',
    'stats.overview.output',
  ]

  it('matches what the contract actually declares', () => {
    const open: string[] = []
    for (const [name, definition] of Object.entries(contract)) {
      if (collectFields(definition.output).open) open.push(`${name}.output`)
    }
    for (const [name, schema] of Object.entries(events)) {
      if (collectFields(schema).open) open.push(`event:${name}`)
    }
    expect(open.sort()).toEqual([...OPEN_OUTPUTS].sort())
  })

  it('exposes exactly the ai.* surface the batch tray and the settings screen need', () => {
    // Sub-phase 7.1 asserted there was no `ai.*` surface at all, which was the strongest
    // available form of "keys never cross IPC". 7.3 added the batch tray's two channels and
    // one push; 7.5 adds the settings screen's nine — provider cards, a live connection
    // probe, role assignment, the pricing overlay, and the usage dashboard. The assertion
    // stays the next-strongest thing: the surface is enumerated here, and adding to it is a
    // diff somebody reads rather than one nobody notices. Every schema below is either
    // closed or, for `ai.listProviderCards`, explicitly listed in `OPEN_OUTPUTS` above with
    // why. Layer 1 checks none of them is named like a credential.
    expect(
      Object.keys(contract)
        .filter((name) => name.startsWith('ai.'))
        .sort(),
    ).toEqual([
      'ai.cancelBatch',
      'ai.exportUsageCsv',
      'ai.getPricingOverlay',
      'ai.getRoles',
      'ai.getUsageSummary',
      'ai.listBatches',
      'ai.listProviderCards',
      'ai.listRecentCalls',
      'ai.probeProvider',
      'ai.restorePricing',
      'ai.setPricingOverlay',
      'ai.setRoles',
    ])
    expect(
      Object.keys(events)
        .filter((name) => name.startsWith('ai.'))
        .sort(),
    ).toEqual(['ai.batchProgress', 'ai.budgetAlert'])
  })

  it('never carries the provider own batch handle across the bridge', () => {
    // `ai_batches.provider_batch_id` addresses a job on the provider's account and is only
    // meaningful together with the key that submitted it. The renderer addresses a batch by
    // our own uuid, so the handle has no reason to cross and does not.
    const fields = new Set<string>()
    for (const name of ['ai.listBatches', 'ai.cancelBatch'] as const) {
      for (const field of collectFields(contract[name].output).names) fields.add(field)
    }
    for (const field of collectFields(events['ai.batchProgress']).names) fields.add(field)
    expect([...fields].filter((field) => /providerBatchId/i.test(field))).toEqual([])
  })
})

describe('layer 4 — the key is read in exactly the places that need it', () => {
  const sources = [
    ...filesUnder(path.join(DESKTOP_SRC, 'main'), { includeTests: false }),
    ...filesUnder(path.join(DESKTOP_SRC, 'jobs'), { includeTests: false }),
    ...filesUnder(path.join(DESKTOP_SRC, 'worker'), { includeTests: false }),
    ...filesUnder(path.join(REPO_ROOT, 'packages'), { includeTests: false }),
  ]

  it('scans the main process and every package', () => {
    expect(sources.length).toBeGreaterThan(200)
  })

  it('reads a stored key in exactly five places, each of them deliberate', () => {
    // `handlers.ts` answers `{ hasSecret, preview }` and never a value. `main/ai/client.ts`
    // and `main/ai/batch.ts` adapt the store to the one-function seam their runner takes —
    // two adapters because a batch is submitted and polled outside a completion loop, not
    // because either holds a key: both forward the call and keep nothing. `run.ts` resolves
    // the key immediately before a dispatch, `batch/runner.ts` immediately before a submit,
    // a poll or a cancel, and neither stores it anywhere. A sixth call site should be a
    // decision somebody makes on purpose, not a diff nobody noticed.
    const callers = scan(sources, /\.getSecret\(/).map((hit) => hit.split(':')[0])
    expect([...new Set(callers)].sort()).toEqual([
      'apps/desktop/src/main/ai/batch.ts',
      'apps/desktop/src/main/ai/client.ts',
      'apps/desktop/src/main/ipc/handlers.ts',
      'packages/ai/src/batch/runner.ts',
      'packages/ai/src/run.ts',
    ])
  })

  it('writes the cost log from exactly two places, both of them adapters', () => {
    // One row per dispatched request is the invariant the monthly budget is summed from, so
    // who may write one is worth pinning. Both of these are the same three-line adapter —
    // redact any path out of the message, hand the row to the repository — around the two
    // loops that dispatch: the synchronous one in `run.ts` and the batch reconciliation in
    // `batch/runner.ts`. Neither builds a row of its own.
    const writers = scan(sources, /aiCalls\.record\(/).map((hit) => hit.split(':')[0])
    expect([...new Set(writers)].sort()).toEqual([
      'apps/desktop/src/main/ai/batch.ts',
      'apps/desktop/src/main/ai/client.ts',
    ])
  })
})

describe('layer 5 — the renderer and the preload never touch key material', () => {
  const rendererAndPreload = [
    ...filesUnder(path.join(DESKTOP_SRC, 'renderer'), { includeTests: true }),
    ...filesUnder(path.join(DESKTOP_SRC, 'preload'), { includeTests: true }),
  ]

  it('scans both bundles, tests and stories included', () => {
    expect(rendererAndPreload.length).toBeGreaterThan(50)
  })

  it('names nothing from the secret machinery', () => {
    // `window.api.secrets.set` is deliberately absent from this pattern: sending a key the
    // user just typed *into* main is the one legitimate direction, and 7.5's settings screen
    // is what will do it.
    expect(
      scan(
        rendererAndPreload,
        /getSecret|createSecretStore|SecretStore|safeStorage|decryptString|encryptString|maskSecret/,
      ),
    ).toEqual([])
  })

  it('carries nothing shaped like real key material', () => {
    expect(
      scan(rendererAndPreload, /sk-ant-[A-Za-z0-9_-]{8}|sk-[A-Za-z0-9]{20}|AIza[A-Za-z0-9_-]{10}/),
    ).toEqual([])
  })

  it('registers no setting that could smuggle ciphertext onto the bridge', () => {
    // `settings.get`/`set` guard on `Object.hasOwn(SETTINGS, key)`. The `safeStorage`
    // ciphertext lives in the same table under out-of-registry `secrets.<name>` keys, so
    // registering one of those — or any credential-worded key — would remove the only thing
    // keeping it off the bridge.
    const registered = Object.keys(SETTINGS)
    expect(registered.length).toBeGreaterThan(20)
    expect(registered.filter((key) => key.startsWith('secrets.'))).toEqual([])
    expect(
      registered.filter((key) => words(key).some((word) => CREDENTIAL_WORDS.has(word))),
    ).toEqual([])
  })
})
