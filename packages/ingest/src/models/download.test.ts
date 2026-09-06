import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelSpec } from './catalog'
import { downloadModel, type FetchLike, ModelDownloadError, modelFileUrl } from './download'
import { createModelStore } from './store'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const CONTENTS: Record<string, string> = {
  'config.json': '{"model_type":"test"}',
  'tokenizer.json': '{"version":"1.0"}',
  'onnx/model_quantized.onnx': 'x'.repeat(4096),
}

const SPEC: ModelSpec = {
  id: 'test-model',
  kind: 'embedding',
  repo: 'retenia-test/tiny-ONNX',
  revision: 'c'.repeat(40),
  dtype: 'quantized',
  files: Object.entries(CONTENTS).map(([path, body]) => ({
    path,
    bytes: Buffer.byteLength(body),
    sha256: sha256(body),
  })),
  bytes: Object.values(CONTENTS).reduce((sum, body) => sum + Buffer.byteLength(body), 0),
  nativeDims: 768,
  dims: 768,
  reduction: 'none',
  maxTokens: 512,
  pooling: 'mean',
  queryPrefix: '',
  documentPrefix: '',
  license: 'mit',
  spaceId: 'test-model@768',
}

const ENDPOINT = 'https://models.test'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'retenia-download-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      // `maxRetries` for the same reason `replaceFile` retries: on Windows a file that was
      // just written can be held open by a scan for a moment, and a recursive remove over it
      // fails with ENOTEMPTY. Without this, a slow teardown is reported as a second,
      // unrelated failure on top of whatever the test itself did.
      rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  )
})

interface FakeServer {
  fetch: FetchLike
  /** URLs requested, in order. */
  requests: string[]
  /** Serve this instead of the real body for one path. */
  corrupt: Set<string>
  /** Answer 404 for these paths. */
  missing: Set<string>
  /** Called just before each chunk is yielded, so a test can cancel mid-transfer. */
  onChunk?: () => void
}

function fakeServer(): FakeServer {
  const server: FakeServer = {
    requests: [],
    corrupt: new Set(),
    missing: new Set(),
    fetch: async (url) => {
      server.requests.push(url)
      const path = url.slice(`${ENDPOINT}/${SPEC.repo}/resolve/${SPEC.revision}/`.length)
      if (server.missing.has(path)) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          body: null,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }
      }
      const body = CONTENTS[path]
      if (body === undefined) throw new Error(`the fake server has no ${path}`)
      const served = server.corrupt.has(path) ? `!${body.slice(1)}` : body
      // Several chunks, so backpressure and mid-transfer cancellation are really exercised.
      const chunks = served.match(/[\s\S]{1,512}/g) ?? ['']
      const stream = Readable.from(
        (async function* () {
          for (const chunk of chunks) {
            server.onChunk?.()
            yield Buffer.from(chunk)
          }
        })(),
      )
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }
    },
  }
  return server
}

describe('modelFileUrl', () => {
  it('pins the commit, never the branch', () => {
    const file = SPEC.files[0] as (typeof SPEC.files)[number]
    expect(modelFileUrl(SPEC, file, ENDPOINT)).toBe(
      `${ENDPOINT}/${SPEC.repo}/resolve/${SPEC.revision}/${file.path}`,
    )
  })
})

describe('downloadModel', () => {
  it('fetches every file, verifies it and leaves the model installed', async () => {
    const store = createModelStore(await tempRoot())
    const server = fakeServer()
    const progress: number[] = []

    const result = await downloadModel(SPEC, {
      store,
      fetch: server.fetch,
      endpoint: ENDPOINT,
      onProgress: ({ fraction }) => progress.push(fraction),
    })

    expect(result.downloaded).toEqual(Object.keys(CONTENTS))
    expect(result.bytesDownloaded).toBe(SPEC.bytes)
    expect(result.skipped).toEqual([])
    expect((await store.status(SPEC)).installed).toBe(true)
    expect(await readFile(store.filePath(SPEC, 'config.json'), 'utf-8')).toBe(
      CONTENTS['config.json'],
    )
    expect(progress.at(-1)).toBe(1)
    expect(progress).toEqual([...progress].sort((left, right) => left - right))
  })

  it('is a no-op the second time, without touching the network', async () => {
    const store = createModelStore(await tempRoot())
    const first = fakeServer()
    await downloadModel(SPEC, { store, fetch: first.fetch, endpoint: ENDPOINT })

    const second = fakeServer()
    const result = await downloadModel(SPEC, { store, fetch: second.fetch, endpoint: ENDPOINT })
    expect(second.requests).toEqual([])
    expect(result.downloaded).toEqual([])
    expect(result.skipped).toEqual(Object.keys(CONTENTS))
  })

  it('resumes: a run that failed halfway only re-fetches what is still missing', async () => {
    const store = createModelStore(await tempRoot())
    const failing = fakeServer()
    failing.missing.add('onnx/model_quantized.onnx')
    await expect(
      downloadModel(SPEC, { store, fetch: failing.fetch, endpoint: ENDPOINT }),
    ).rejects.toThrow(ModelDownloadError)

    const recovering = fakeServer()
    const result = await downloadModel(SPEC, {
      store,
      fetch: recovering.fetch,
      endpoint: ENDPOINT,
    })
    // The two small files landed on the first run; only the weights are fetched again.
    expect(result.downloaded).toEqual(['onnx/model_quantized.onnx'])
    expect(recovering.requests).toHaveLength(1)
    expect((await store.status(SPEC)).installed).toBe(true)
  })

  it('refuses a file whose bytes do not match the manifest, and leaves nothing behind', async () => {
    const store = createModelStore(await tempRoot())
    const server = fakeServer()
    server.corrupt.add('onnx/model_quantized.onnx')

    await expect(
      downloadModel(SPEC, { store, fetch: server.fetch, endpoint: ENDPOINT }),
    ).rejects.toThrow(/does not match the manifest/)

    // Not under its real name, and not as a `.part` either: nothing a later run could trust.
    const target = store.filePath(SPEC, 'onnx/model_quantized.onnx')
    await expect(stat(target)).rejects.toThrow()
    await expect(stat(`${target}.part`)).rejects.toThrow()
    expect((await store.status(SPEC)).installed).toBe(false)
  })

  it('writes no receipt when a file failed, so the next start does not think it is ready', async () => {
    const store = createModelStore(await tempRoot())
    const server = fakeServer()
    server.corrupt.add('config.json')
    await expect(
      downloadModel(SPEC, { store, fetch: server.fetch, endpoint: ENDPOINT }),
    ).rejects.toThrow()
    expect(await store.readReceipt(SPEC)).toBeUndefined()
  })

  it('reports the HTTP status when the server says no', async () => {
    const store = createModelStore(await tempRoot())
    const server = fakeServer()
    server.missing.add('config.json')
    await expect(
      downloadModel(SPEC, { store, fetch: server.fetch, endpoint: ENDPOINT }),
    ).rejects.toThrow(/404 Not Found downloading config\.json/)
  })

  it('stops mid-transfer when cancelled and removes the partial file', async () => {
    const store = createModelStore(await tempRoot())
    const server = fakeServer()
    const controller = new AbortController()
    let chunks = 0
    server.onChunk = () => {
      chunks += 1
      if (chunks === 2) controller.abort()
    }

    await expect(
      downloadModel(SPEC, {
        store,
        fetch: server.fetch,
        endpoint: ENDPOINT,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/)
    await expect(stat(`${store.filePath(SPEC, 'config.json')}.part`)).rejects.toThrow()
  })

  // The two tests below are the only ones that make `downloadModel` write over a file that
  // already exists, which is the operation Windows can briefly refuse (see `replaceFile`).
  // They get room for its ~0.8 s of backoff on top of the work itself; where nothing holds
  // the file — every Linux and macOS run, and most Windows ones — they finish in tens of
  // milliseconds and never come near this ceiling.
  const REPLACES_A_FILE = { timeout: 20_000 }

  it(
    'overwrites a file that is already there, with no handle left open',
    REPLACES_A_FILE,
    async () => {
      // The Windows case, and the one the `windows-latest` job found twice. Replacing a file
      // there is not the single atomic call it is on Linux: `MoveFileExW` opens the
      // destination, and the destination can be held for a moment by a scan of the bytes the
      // previous run just wrote. On Linux this passes however `download.ts` does it, which is
      // why it took CI to find; the assertion here is the portable half (the bytes really were
      // replaced, and no `.part` is left), and `replaceFile` explains the rest.
      const store = createModelStore(await tempRoot())
      await downloadModel(SPEC, { store, fetch: fakeServer().fetch, endpoint: ENDPOINT })

      // Corrupt one file in place and drop the receipt, so the next run has to rewrite it over
      // the existing bytes rather than creating it.
      const target = store.filePath(SPEC, 'onnx/model_quantized.onnx')
      await writeFile(target, 'z'.repeat(4096))
      await rm(join(store.directory(SPEC), '.retenia-model.json'), { force: true })

      const result = await downloadModel(SPEC, {
        store,
        fetch: fakeServer().fetch,
        endpoint: ENDPOINT,
      })
      expect(result.downloaded).toContain('onnx/model_quantized.onnx')
      expect(await readFile(target, 'utf-8')).toBe(CONTENTS['onnx/model_quantized.onnx'])
      await expect(stat(`${target}.part`)).rejects.toThrow()
    },
  )

  it(
    're-downloads a file the receipt no longer vouches for after a revision bump',
    REPLACES_A_FILE,
    async () => {
      const store = createModelStore(await tempRoot())
      await downloadModel(SPEC, { store, fetch: fakeServer().fetch, endpoint: ENDPOINT })

      const bumped: ModelSpec = { ...SPEC, revision: 'd'.repeat(40) }
      const server = fakeServer()
      server.requests.length = 0
      // The fake server keys off SPEC.revision in the URL, so point it at the new one.
      const result = await downloadModel(bumped, {
        store,
        endpoint: ENDPOINT,
        fetch: async (url) => server.fetch(url.replace(bumped.revision, SPEC.revision)),
      })
      expect(result.downloaded).toEqual(Object.keys(CONTENTS))
      expect((await store.status(bumped)).installed).toBe(true)
    },
  )
})
