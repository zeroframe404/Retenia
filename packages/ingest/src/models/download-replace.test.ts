import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelSpec } from './catalog'
import { createModelStore } from './store'

/**
 * `replaceFile`'s retry loop, which no platform this suite runs on can trigger by itself.
 *
 * The failure it exists for is Windows refusing to replace a file another process has open
 * for a moment (a virus scan of the bytes the previous download just wrote). On Linux and
 * macOS an open handle does not block `rename` at all, so a test that merely holds the file
 * open would pass without exercising a single retry and prove nothing. The lock is therefore
 * injected: `rename` is made to fail with the code Windows raises, exactly as many times as
 * the case under test needs.
 */

const injected = vi.hoisted(() => ({ renameFailures: 0, renameCalls: 0, renameCode: 'EPERM' }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (
      from: Parameters<typeof actual.rename>[0],
      to: Parameters<typeof actual.rename>[1],
    ) => {
      injected.renameCalls += 1
      if (injected.renameFailures > 0) {
        injected.renameFailures -= 1
        const error: NodeJS.ErrnoException = new Error(
          `${injected.renameCode}: rename '${String(from)}' -> '${String(to)}'`,
        )
        error.code = injected.renameCode
        throw error
      }
      return actual.rename(from, to)
    },
  }
})

// Imported after the mock is declared; `vi.mock` is hoisted above it either way.
const { downloadModel } = await import('./download')

const BODY = 'the only file this fixture needs'
const SPEC: ModelSpec = {
  id: 'replace-fixture',
  kind: 'embedding',
  repo: 'retenia-test/replace-ONNX',
  revision: 'a'.repeat(40),
  dtype: 'q8',
  files: [
    {
      path: 'config.json',
      bytes: Buffer.byteLength(BODY),
      sha256: createHash('sha256').update(BODY).digest('hex'),
    },
  ],
  bytes: Buffer.byteLength(BODY),
  nativeDims: 768,
  dims: 768,
  reduction: 'none',
  maxTokens: 512,
  pooling: 'mean',
  queryPrefix: '',
  documentPrefix: '',
  license: 'mit',
  spaceId: 'replace-fixture@768',
}

const serve = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  body: Readable.from([Buffer.from(BODY)]),
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
})

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'retenia-replace-'))
  roots.push(root)
  return root
}

beforeEach(() => {
  injected.renameFailures = 0
  injected.renameCalls = 0
  injected.renameCode = 'EPERM'
})
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })),
  )
})

describe('replacing a file the platform has locked', () => {
  it('retries past a transient lock and still installs the right bytes', async () => {
    const store = createModelStore(await tempRoot())
    injected.renameFailures = 3

    const result = await downloadModel(SPEC, { store, fetch: serve, endpoint: 'https://x.test' })

    expect(result.downloaded).toEqual(['config.json'])
    // Three refusals, then the one that landed.
    expect(injected.renameCalls).toBe(4)
    expect(await readFile(store.filePath(SPEC, 'config.json'), 'utf-8')).toBe(BODY)
    expect((await store.status(SPEC)).installed).toBe(true)
  })

  it('gives up rather than looping forever, and leaves no partial behind', async () => {
    const store = createModelStore(await tempRoot())
    // More refusals than the policy has attempts: the lock is not transient after all.
    injected.renameFailures = 99

    await expect(
      downloadModel(SPEC, { store, fetch: serve, endpoint: 'https://x.test' }),
    ).rejects.toThrow(/EPERM/)

    // Bounded: the caller sees the platform's own error, not a hang and not a retry storm.
    expect(injected.renameCalls).toBe(6)
    const target = store.filePath(SPEC, 'config.json')
    await expect(stat(target)).rejects.toThrow()
    await expect(stat(`${target}.part`)).rejects.toThrow()
    expect((await store.status(SPEC)).installed).toBe(false)
  })

  it('does not retry an error that is not a lock', async () => {
    const store = createModelStore(await tempRoot())
    // A cross-device link is a fact about the filesystem, not a passing scan: waiting cannot
    // change it, so it must surface on the first attempt rather than after a second of backoff.
    injected.renameFailures = 99
    injected.renameCode = 'EXDEV'

    await expect(
      downloadModel(SPEC, { store, fetch: serve, endpoint: 'https://x.test' }),
    ).rejects.toThrow(/EXDEV/)
    expect(injected.renameCalls).toBe(1)
  })
})
