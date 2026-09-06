import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { type ModelFile, type ModelSpec, modelDirectory } from './catalog'

/**
 * The on-disk half of the model catalog: `<userData>/models/<repo>/…`, plus the receipt that
 * says the files there are the ones the manifest describes
 * (`docs/spec/05-ingestion-rag.md` §3).
 *
 * The layout is not ours to choose — it is what `@huggingface/transformers` resolves a local
 * model from when `env.localModelPath` points at the root and `env.allowRemoteModels` is
 * off, which is how the app guarantees that loading a model never reaches the network.
 */

/** Written next to a model once every one of its files has been hashed and matched. */
const RECEIPT = '.retenia-model.json'

export interface ModelReceipt {
  /** The commit the files came from. A catalog bump to a new revision invalidates it. */
  revision: string
  /** `path -> sha256`, exactly as verified. */
  files: Record<string, string>
  /** When the verification ran, for the settings screen. */
  verifiedAt: string
}

export type ModelIssue =
  | { file: string; problem: 'missing' }
  | { file: string; problem: 'size'; expected: number; actual: number }
  | { file: string; problem: 'sha256'; expected: string; actual: string }

export interface ModelStatus {
  /** True only when a receipt for this exact revision covers every file and the sizes on
   *  disk still match. */
  installed: boolean
  /** Bytes of the model already on disk, for a resumed download's progress bar. */
  presentBytes: number
  totalBytes: number
  issues: readonly ModelIssue[]
}

export interface VerifyOptions {
  /** 0–1 over the model's bytes. */
  onProgress?: (fraction: number) => void
  signal?: { readonly aborted: boolean }
}

export interface ModelStore {
  /** The models root — what `env.localModelPath` is set to. */
  readonly root: string
  /** Absolute directory of one model. */
  directory(spec: ModelSpec): string
  /** Absolute path of one of its files. */
  filePath(spec: ModelSpec, file: ModelFile | string): string
  /** Cheap: the receipt plus a size check. What every load path calls. */
  status(spec: ModelSpec): Promise<ModelStatus>
  /** Expensive: re-hashes every file. What "repair" and a first install call. */
  verify(spec: ModelSpec, options?: VerifyOptions): Promise<readonly ModelIssue[]>
  /**
   * Records that some of `spec`'s files verified cleanly, merging into whatever the receipt
   * already vouches for — which is what makes a download resumable at file granularity: a
   * run that dies after two of three files leaves those two vouched for, and the next run
   * fetches only the third. A receipt written for another revision is replaced, not merged:
   * it says nothing about these files.
   */
  recordVerified(spec: ModelSpec, files: readonly string[]): Promise<void>
  /** Records that every file of `spec` verified cleanly. */
  writeReceipt(spec: ModelSpec): Promise<void>
  readReceipt(spec: ModelSpec): Promise<ModelReceipt | undefined>
  /** Deletes the model's directory, receipt and all. */
  remove(spec: ModelSpec): Promise<void>
}

/**
 * Refuses a manifest path that would escape the model's own directory.
 *
 * The manifest is checked in and therefore trusted, but it is also the one input to this
 * module that is a *path*, and it is regenerated from a remote API by a script. A `..`
 * segment arriving that way must not be able to write outside `<userData>/models`.
 */
export function resolveModelFile(root: string, spec: ModelSpec, relative: string): string {
  if (isAbsolute(relative) || relative.includes('\0')) {
    throw new Error(`model file path must be relative: ${JSON.stringify(relative)}`)
  }
  const dir = join(root, modelDirectory(spec))
  const resolved = normalize(join(dir, relative))
  if (resolved !== dir && !resolved.startsWith(dir + sep)) {
    throw new Error(`model file path escapes its model directory: ${JSON.stringify(relative)}`)
  }
  return resolved
}

async function sizeOf(path: string): Promise<number | undefined> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? stats.size : undefined
  } catch {
    return undefined
  }
}

/** Streamed rather than read whole: these are up to 570 MB. */
export async function sha256File(
  path: string,
  onBytes?: (delta: number) => void,
  signal?: { readonly aborted: boolean },
): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  try {
    for await (const part of stream) {
      if (signal?.aborted === true) throw new Error('model verification was cancelled')
      const buffer = part as Buffer
      hash.update(buffer)
      onBytes?.(buffer.byteLength)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

export function createModelStore(root: string): ModelStore {
  const directory = (spec: ModelSpec): string => join(root, modelDirectory(spec))
  const filePath = (spec: ModelSpec, file: ModelFile | string): string =>
    resolveModelFile(root, spec, typeof file === 'string' ? file : file.path)

  const readReceipt = async (spec: ModelSpec): Promise<ModelReceipt | undefined> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(directory(spec), RECEIPT), 'utf-8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const receipt = parsed as Partial<ModelReceipt>
      if (typeof receipt.revision !== 'string' || typeof receipt.files !== 'object') {
        return undefined
      }
      return receipt as ModelReceipt
    } catch {
      return undefined
    }
  }

  return {
    root,
    directory,
    filePath,
    readReceipt,

    status: async (spec) => {
      const receipt = await readReceipt(spec)
      const issues: ModelIssue[] = []
      let presentBytes = 0

      for (const file of spec.files) {
        const actual = await sizeOf(filePath(spec, file))
        if (actual === undefined) {
          issues.push({ file: file.path, problem: 'missing' })
          continue
        }
        presentBytes += Math.min(actual, file.bytes)
        if (actual !== file.bytes) {
          issues.push({ file: file.path, problem: 'size', expected: file.bytes, actual })
          continue
        }
        // A receipt from another revision, or one that never covered this file, is not
        // evidence about the bytes on disk — treat the file as unverified, not as broken.
        if (receipt?.revision !== spec.revision || receipt.files[file.path] !== file.sha256) {
          issues.push({ file: file.path, problem: 'sha256', expected: file.sha256, actual: '' })
        }
      }

      return { installed: issues.length === 0, presentBytes, totalBytes: spec.bytes, issues }
    },

    verify: async (spec, options = {}) => {
      const issues: ModelIssue[] = []
      let hashed = 0
      for (const file of spec.files) {
        const path = filePath(spec, file)
        const actual = await sizeOf(path)
        if (actual === undefined) {
          issues.push({ file: file.path, problem: 'missing' })
          continue
        }
        if (actual !== file.bytes) {
          issues.push({ file: file.path, problem: 'size', expected: file.bytes, actual })
          // Still counted towards progress: the bar must not stall on a truncated file.
          hashed += file.bytes
          options.onProgress?.(Math.min(1, hashed / Math.max(1, spec.bytes)))
          continue
        }
        const digest = await sha256File(
          path,
          (delta) => {
            hashed += delta
            options.onProgress?.(Math.min(1, hashed / Math.max(1, spec.bytes)))
          },
          options.signal,
        )
        if (digest !== file.sha256) {
          issues.push({ file: file.path, problem: 'sha256', expected: file.sha256, actual: digest })
        }
      }
      options.onProgress?.(1)
      return issues
    },

    recordVerified: async (spec, files) => {
      const previous = await readReceipt(spec)
      const carried = previous?.revision === spec.revision ? previous.files : {}
      const wanted = new Map(spec.files.map((file) => [file.path, file.sha256]))
      const receipt: ModelReceipt = {
        revision: spec.revision,
        files: { ...carried },
        verifiedAt: new Date().toISOString(),
      }
      for (const path of files) {
        const sha256 = wanted.get(path)
        if (sha256 === undefined) throw new Error(`${spec.id} has no file "${path}" to record`)
        receipt.files[path] = sha256
      }
      await mkdir(directory(spec), { recursive: true })
      await writeFile(join(directory(spec), RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`)
    },

    writeReceipt: async function writeReceipt(spec) {
      await this.recordVerified(
        spec,
        spec.files.map((file) => file.path),
      )
    },

    remove: async (spec) => {
      await rm(directory(spec), { recursive: true, force: true })
    },
  }
}
