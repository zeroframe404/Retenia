import type { ModelSpec } from '../models/catalog'

/**
 * Bringing a model's native vector to the width of the app's index, and keeping every vector
 * unit-length while doing it.
 *
 * The index is one `FLOAT[768]` vec0 table (`packages/db/src/search.ts`), so a model that
 * does not emit 768 dimensions has to be reduced. Which reduction is a property of the
 * catalog entry, never of the call site, because the reduction is *part of the vector space*:
 * `docs/spec/05-ingestion-rag.md` §3's rule is "store the `model_id` per embedding and never
 * mix spaces", and two different reductions of one model are two different spaces.
 *
 * Unit length is not cosmetic either: `quantizeToInt8` in `packages/db` maps `[-1, 1]` onto
 * the full int8 range assuming exactly that, and L2 distance over unit vectors is a monotone
 * function of cosine similarity, which is what these models were trained for.
 */

/** In-place L2 normalization. A zero vector is left as is — there is no direction to keep,
 *  and dividing by zero would poison the whole index with NaNs. */
export function l2Normalize(vector: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < vector.length; i++) norm += (vector[i] as number) ** 2
  if (norm === 0) return vector
  const inverse = 1 / Math.sqrt(norm)
  for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] as number) * inverse
  return vector
}

/**
 * Matryoshka truncation (Kusupati et al. 2022): a prefix of an MRL-trained vector is itself
 * a valid embedding, once re-normalized. Only valid for models trained that way — which is
 * why it is reachable through the catalog and not as a general-purpose "make it fit".
 */
export function truncateMatryoshka(vector: Float32Array, dims: number): Float32Array {
  if (dims > vector.length) {
    throw new RangeError(`cannot truncate a ${vector.length}-dim vector to ${dims}`)
  }
  return l2Normalize(vector.slice(0, dims))
}

/** FNV-1a over a string, as the seed for the PRNG below. */
function seedFrom(text: string): number {
  let hash = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash ^ text.charCodeAt(i)) >>> 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

/** mulberry32: small, fast, and — the only property that matters here — identical on every
 *  machine and every run, so a vector embedded today is comparable with one embedded in a
 *  year. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Projection {
  /** The model's native width. */
  from: number
  /** `from` rounded up to a power of two — what the transform below needs. */
  padded: number
  /** The width kept. */
  to: number
  /** ±1 per input coordinate, applied before the transform. */
  flip: Int8Array
  /** Which `to` of the `padded` transformed coordinates are kept. */
  pick: Int32Array
}

const projections = new Map<string, Projection>()

function nextPowerOfTwo(value: number): number {
  let size = 1
  while (size < value) size *= 2
  return size
}

/**
 * A subsampled randomized Hadamard transform (Ailon & Chazelle 2006): flip the sign of each
 * coordinate at random, apply the Walsh–Hadamard transform, and keep a random subset of the
 * result.
 *
 * It is the same Johnson–Lindenstrauss idea as a random ±1 matrix, but it concentrates much
 * better, because the Hadamard step spreads any one coordinate's mass evenly across all of
 * them before the subsampling throws some away. Measured over random unit vectors at
 * 1024 → 768 (`reduce.test.ts`), the worst distortion of an inner product is ~0.04 against
 * ~0.08 for a sparse ±1 matrix, and it is within noise of a full orthonormal projection —
 * which would otherwise cost a 768×1024 Gram–Schmidt (~0.9 s) and 6 MB of matrix to hold.
 *
 * It is also cheaper to run and to remember: O(d log d) per vector instead of O(d·k), and the
 * whole "matrix" is one sign vector plus one index list.
 */
function projectionFor(from: number, to: number, seed: string): Projection {
  const key = `${from}:${to}:${seed}`
  const cached = projections.get(key)
  if (cached !== undefined) return cached

  const random = mulberry32(seedFrom(seed))
  const padded = nextPowerOfTwo(from)
  const flip = new Int8Array(padded)
  for (let i = 0; i < padded; i++) flip[i] = random() < 0.5 ? -1 : 1

  // Fisher–Yates over the transformed coordinates, then keep the first `to`.
  const order = new Int32Array(padded)
  for (let i = 0; i < padded; i++) order[i] = i
  for (let i = padded - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i] as number
    order[i] = order[j] as number
    order[j] = swap
  }

  const projection: Projection = { from, padded, to, flip, pick: order.slice(0, to) }
  projections.set(key, projection)
  return projection
}

/** In-place Walsh–Hadamard transform. `values.length` must be a power of two. */
function hadamard(values: Float64Array): void {
  for (let length = 1; length < values.length; length <<= 1) {
    for (let start = 0; start < values.length; start += length << 1) {
      for (let i = start; i < start + length; i++) {
        const left = values[i] as number
        const right = values[i + length] as number
        values[i] = left + right
        values[i + length] = left - right
      }
    }
  }
}

/**
 * Projects `vector` down to `dims` with the seeded transform above, then re-normalizes.
 *
 * The transform scales every vector by the same factor, so the final normalization is what
 * fixes the length and no explicit scaling constant is needed. `reduce.test.ts` pins the
 * distortion as a measured property rather than a claim: inner products before and after,
 * and the rank agreement of a KNN query over a corpus with real similarity structure.
 */
export function randomProject(vector: Float32Array, dims: number, seed: string): Float32Array {
  if (dims > vector.length) {
    throw new RangeError(`cannot project a ${vector.length}-dim vector up to ${dims}`)
  }
  const { padded, flip, pick } = projectionFor(vector.length, dims, seed)
  // float64 for the transform: the Hadamard step grows magnitudes by sqrt(padded) and sums
  // 1024 terms per output, which is more cancellation than float32 should be asked to carry.
  const work = new Float64Array(padded)
  for (let i = 0; i < vector.length; i++) work[i] = (vector[i] as number) * (flip[i] as number)
  hadamard(work)

  const out = new Float32Array(dims)
  for (let i = 0; i < dims; i++) out[i] = work[pick[i] as number] as number
  return l2Normalize(out)
}

/**
 * The last gate before a vector reaches the index.
 *
 * A NaN or a zero vector is not a small quality problem here, it is a corrupted partition:
 * sqlite-vec is brute force, so a NaN makes every distance in the partition NaN, and a zero
 * row sits at exactly distance 1 from every unit vector and therefore turns up in *any*
 * KNN result. Neither is recoverable by ranking, and neither is visible from the storage
 * layer — which only ever sees 768 finite-looking floats. So a provider that produces one
 * fails loudly, and the job that called it records a failure against the source rather than
 * quietly indexing a ghost.
 */
export function assertIndexable(vector: Float32Array, modelId: string, at: number): Float32Array {
  let norm = 0
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i] as number
    if (!Number.isFinite(value)) {
      throw new Error(`${modelId} produced a non-finite value at index ${at}, dimension ${i}`)
    }
    norm += value * value
  }
  if (Math.abs(Math.sqrt(norm) - 1) > 1e-3) {
    throw new Error(
      `${modelId} produced a vector of length ${Math.sqrt(norm).toFixed(4)} at index ${at}; the index stores unit vectors only`,
    )
  }
  return vector
}

/**
 * The one entry point: takes whatever the model produced and returns what the index stores.
 * Always returns a unit vector of exactly `spec.dims` components.
 */
export function reduceToIndexWidth(vector: Float32Array, spec: ModelSpec): Float32Array {
  if (vector.length !== spec.nativeDims) {
    throw new RangeError(
      `${spec.id} produced a ${vector.length}-dim vector, the catalog says ${spec.nativeDims}`,
    )
  }
  switch (spec.reduction) {
    case 'none':
      if (vector.length !== spec.dims) {
        throw new RangeError(
          `${spec.id} declares no reduction but ${spec.nativeDims} ≠ ${spec.dims}`,
        )
      }
      return l2Normalize(Float32Array.from(vector))
    case 'matryoshka':
      return truncateMatryoshka(vector, spec.dims)
    case 'random-projection':
      // Seeded by the space id, so the matrix is tied to the very identity that is written
      // onto every row: one `model_id`, one matrix, forever.
      return randomProject(vector, spec.dims, spec.spaceId)
  }
}
