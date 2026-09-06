import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelSpec } from './catalog'
import { createModelStore, resolveModelFile, sha256File } from './store'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const CONFIG = '{"model_type":"test"}'
const WEIGHTS = 'not really an onnx graph, but it hashes the same way'

const SPEC: ModelSpec = {
  id: 'test-model',
  kind: 'embedding',
  repo: 'retenia-test/tiny-ONNX',
  revision: 'a'.repeat(40),
  dtype: 'quantized',
  files: [
    { path: 'config.json', bytes: Buffer.byteLength(CONFIG), sha256: sha256(CONFIG) },
    {
      path: 'onnx/model_quantized.onnx',
      bytes: Buffer.byteLength(WEIGHTS),
      sha256: sha256(WEIGHTS),
    },
  ],
  bytes: Buffer.byteLength(CONFIG) + Buffer.byteLength(WEIGHTS),
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

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'retenia-models-'))
  roots.push(root)
  return root
}

async function writeFileAt(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveModelFile', () => {
  it('keeps a manifest path inside the model’s own directory', () => {
    const root = '/models'
    expect(resolveModelFile(root, SPEC, 'onnx/model_quantized.onnx')).toBe(
      join(root, SPEC.repo, 'onnx/model_quantized.onnx'),
    )
  })

  it('refuses a path that would climb out of it', () => {
    // The manifest is checked in and therefore trusted, but it is regenerated from a remote
    // API by a script, and it is the one input here that is a *path*.
    expect(() => resolveModelFile('/models', SPEC, '../../etc/passwd')).toThrow(/escapes/)
    expect(() => resolveModelFile('/models', SPEC, 'onnx/../../../x')).toThrow(/escapes/)
  })

  it('refuses an absolute path and an embedded NUL', () => {
    expect(() => resolveModelFile('/models', SPEC, '/etc/passwd')).toThrow(/must be relative/)
    expect(() => resolveModelFile('/models', SPEC, 'a\0b')).toThrow(/must be relative/)
  })
})

describe('the model store', () => {
  it('reports a model that is not there as missing, with nothing present', async () => {
    const store = createModelStore(await tempRoot())
    const status = await store.status(SPEC)
    expect(status.installed).toBe(false)
    expect(status.presentBytes).toBe(0)
    expect(status.totalBytes).toBe(SPEC.bytes)
    expect(status.issues.map((issue) => issue.problem)).toEqual(['missing', 'missing'])
  })

  it('is not installed until a receipt vouches for the files, even when they are correct', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(store.filePath(SPEC, 'config.json'), CONFIG)
    await writeFileAt(store.filePath(SPEC, 'onnx/model_quantized.onnx'), WEIGHTS)

    // The right bytes with no receipt is "unverified", not "ready": nothing has hashed them.
    expect((await store.status(SPEC)).installed).toBe(false)
    expect(await store.verify(SPEC)).toEqual([])

    await store.writeReceipt(SPEC)
    const status = await store.status(SPEC)
    expect(status.installed).toBe(true)
    expect(status.presentBytes).toBe(SPEC.bytes)
    expect(status.issues).toEqual([])
  })

  it('stops trusting a receipt written for another revision', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(store.filePath(SPEC, 'config.json'), CONFIG)
    await writeFileAt(store.filePath(SPEC, 'onnx/model_quantized.onnx'), WEIGHTS)
    await store.writeReceipt(SPEC)

    const bumped: ModelSpec = { ...SPEC, revision: 'b'.repeat(40) }
    const status = await store.status(bumped)
    expect(status.installed).toBe(false)
    expect(status.issues.every((issue) => issue.problem === 'sha256')).toBe(true)
  })

  it('catches a truncated file by size before it ever hashes it', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(store.filePath(SPEC, 'config.json'), CONFIG)
    await writeFileAt(store.filePath(SPEC, 'onnx/model_quantized.onnx'), WEIGHTS.slice(0, 5))
    await store.writeReceipt(SPEC)

    const status = await store.status(SPEC)
    expect(status.installed).toBe(false)
    expect(status.issues).toContainEqual({
      file: 'onnx/model_quantized.onnx',
      problem: 'size',
      expected: SPEC.bytes - Buffer.byteLength(CONFIG),
      actual: 5,
    })
  })

  it('catches a file of the right length whose bytes are wrong', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(store.filePath(SPEC, 'config.json'), CONFIG)
    // Same length, different content — exactly what a size check cannot see.
    await writeFileAt(store.filePath(SPEC, 'onnx/model_quantized.onnx'), `X${WEIGHTS.slice(1)}`)
    const issues = await store.verify(SPEC)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ file: 'onnx/model_quantized.onnx', problem: 'sha256' })
  })

  it('reports verification progress that ends at 1', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(store.filePath(SPEC, 'config.json'), CONFIG)
    await writeFileAt(store.filePath(SPEC, 'onnx/model_quantized.onnx'), WEIGHTS)

    const seen: number[] = []
    await store.verify(SPEC, { onProgress: (fraction) => seen.push(fraction) })
    expect(seen.at(-1)).toBe(1)
    expect(seen).toEqual([...seen].sort((left, right) => left - right))
  })

  it('removes the whole model directory, receipt included', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(store.filePath(SPEC, 'config.json'), CONFIG)
    await store.writeReceipt(SPEC)
    expect(await store.readReceipt(SPEC)).toMatchObject({ revision: SPEC.revision })

    await store.remove(SPEC)
    expect(await store.readReceipt(SPEC)).toBeUndefined()
    expect((await store.status(SPEC)).presentBytes).toBe(0)
  })

  it('survives a receipt that is not JSON at all', async () => {
    const root = await tempRoot()
    const store = createModelStore(root)
    await writeFileAt(join(store.directory(SPEC), '.retenia-model.json'), 'not json {')
    expect(await store.readReceipt(SPEC)).toBeUndefined()
  })
})

describe('sha256File', () => {
  it('agrees with hashing the bytes in one go', async () => {
    const root = await tempRoot()
    const path = join(root, 'blob.bin')
    await writeFile(path, WEIGHTS)
    expect(await sha256File(path)).toBe(sha256(WEIGHTS))
    expect(await readFile(path, 'utf-8')).toBe(WEIGHTS)
  })

  it('stops when the signal is already aborted', async () => {
    const root = await tempRoot()
    const path = join(root, 'blob.bin')
    await writeFile(path, WEIGHTS)
    await expect(sha256File(path, undefined, { aborted: true })).rejects.toThrow(/cancelled/)
  })
})
