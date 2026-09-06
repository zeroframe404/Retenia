import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadToFile, type FetchLike } from '../net/fetch-to-file'

/**
 * The GGML weights `whisper-cli` loads: the speech models and the Silero VAD model
 * (`docs/spec/05-ingestion-rag.md` §1, `docs/spec/07-architecture.md` §7: "GGML models
 * downloaded on demand").
 *
 * ### Why these are not `ModelSpec`s
 *
 * `../models/catalog.ts` already downloads pinned, hash-verified weights, and reusing it was
 * the first plan. It is the wrong home. A `ModelSpec` is shaped around *transformers.js*: it
 * carries a `dtype` that selects an ONNX graph file, a pooling strategy, a native and a
 * reduced vector width, query and document prefixes, and a `spaceId` that decides whether two
 * vectors may be compared. A GGML file has none of those — it is loaded by a C++ binary, not
 * by a JavaScript runtime, and it produces text rather than vectors.
 *
 * Bending the type to fit would have meant a discriminated union threaded through 58 call
 * sites of `dims`/`pooling`/`spaceId` across sub-phase 6.3's tested embedding and reranking
 * code, all to add two files that share none of those fields. What the two genuinely have in
 * common is *how the bytes arrive*, and that is shared as `downloadToFile` rather than as a
 * type. Same reasoning as `../sidecars/catalog.ts`.
 *
 * The digests are Hugging Face's LFS oids, which for these repositories *are* the SHA-256 of
 * the file, so they can be pinned without transferring a byte — and both were re-verified
 * against a real download while this sub-phase was written.
 */

export type WeightKind = 'asr' | 'vad'

export interface WeightSpec {
  id: string
  kind: WeightKind
  /** Hugging Face repo, which is also the directory the file lands in. */
  repo: string
  file: string
  bytes: number
  sha256: string
  license: string
  /** Roughly how much faster than real time this model transcribes on a modern CPU. Used only
   *  to size the job's timeout, so a wrong guess costs patience, never correctness. */
  cpuRealtimeFactor: number
}

const HUGGINGFACE = 'https://huggingface.co'

/**
 * The speech models offered, smallest first.
 *
 * `small-q5_1` is the default rather than `large-v3-turbo` because of what the first import
 * feels like: 190 MB and a few minutes of CPU, against 574 MB and a wait long enough to look
 * broken on a machine with no GPU. `docs/spec/05-ingestion-rag.md` §1 names turbo first, and
 * it is still the better transcript — so it is preferred automatically once a CUDA build is
 * in play, where the size and the speed both stop mattering.
 *
 * `tiny` is not offered in the UI. It is here because the integration test needs a model it
 * can download in seconds, and a test that pins a model the product does not ship would be
 * testing a configuration nobody runs.
 */
export const WHISPER_MODELS: readonly WeightSpec[] = Object.freeze([
  {
    id: 'whisper-tiny',
    kind: 'asr',
    repo: 'ggerganov/whisper.cpp',
    file: 'ggml-tiny.bin',
    bytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    license: 'mit',
    cpuRealtimeFactor: 20,
  },
  {
    id: 'whisper-small-q5_1',
    kind: 'asr',
    repo: 'ggerganov/whisper.cpp',
    file: 'ggml-small-q5_1.bin',
    bytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    license: 'mit',
    cpuRealtimeFactor: 4,
  },
  {
    id: 'whisper-large-v3-turbo-q5_0',
    kind: 'asr',
    repo: 'ggerganov/whisper.cpp',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    license: 'mit',
    cpuRealtimeFactor: 1,
  },
])

/**
 * Silero VAD, as whisper.cpp packages it.
 *
 * 885 KB, and it is the whole reason this sub-phase needs no voice-activity code of its own:
 * whisper.cpp grew `--vad` as a first-class flag, so segmentation is a model file rather than
 * a second inference stack (see `../sidecars/whisper.ts`).
 */
export const SILERO_VAD: WeightSpec = Object.freeze({
  id: 'silero-vad-v6.2.0',
  kind: 'vad',
  repo: 'ggml-org/whisper-vad',
  file: 'ggml-silero-v6.2.0.bin',
  bytes: 885_098,
  sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
  license: 'mit',
  cpuRealtimeFactor: 0,
})

export const DEFAULT_WHISPER_MODEL_ID = 'whisper-small-q5_1'
/** Preferred once a CUDA build is installed, where its size and speed stop being the problem. */
export const CUDA_WHISPER_MODEL_ID = 'whisper-large-v3-turbo-q5_0'

export function findWeight(id: string): WeightSpec | undefined {
  return [...WHISPER_MODELS, SILERO_VAD].find((spec) => spec.id === id)
}

export function requireWeight(id: string): WeightSpec {
  const spec = findWeight(id)
  if (spec === undefined) throw new Error(`No whisper weight "${id}" in the catalog`)
  return spec
}

/** Where the file lives under the models root, alongside the ONNX models 6.3 puts there. */
export function weightPath(root: string, spec: WeightSpec): string {
  return join(root, spec.repo, spec.file)
}

export function weightUrl(spec: WeightSpec, endpoint = HUGGINGFACE): string {
  return `${endpoint}/${spec.repo}/resolve/main/${spec.file}`
}

/** Cheap: a size check, not a re-hash. The download is what verifies. */
export async function isWeightInstalled(root: string, spec: WeightSpec): Promise<boolean> {
  try {
    const info = await stat(weightPath(root, spec))
    return info.isFile() && info.size === spec.bytes
  } catch {
    return false
  }
}

export interface EnsureWeightOptions {
  root: string
  spec: WeightSpec
  fetch?: FetchLike
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  endpoint?: string
}

/** Makes sure one weight file is on disk and matches its pin. Returns its absolute path. */
export async function ensureWeight(options: EnsureWeightOptions): Promise<string> {
  const { root, spec, fetch, signal, onProgress, endpoint } = options
  const target = weightPath(root, spec)

  if (await isWeightInstalled(root, spec)) {
    onProgress?.(1)
    return target
  }

  let done = 0
  await downloadToFile({
    url: weightUrl(spec, endpoint),
    target,
    expectedSha256: spec.sha256,
    expectedBytes: spec.bytes,
    subject: spec.file,
    ...(fetch === undefined ? {} : { fetch }),
    ...(signal === undefined ? {} : { signal }),
    onBytes: (delta) => {
      done += delta
      onProgress?.(Math.min(1, done / spec.bytes))
    },
  })
  onProgress?.(1)
  return target
}
