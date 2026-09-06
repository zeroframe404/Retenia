import { describe, expect, it } from 'vitest'
import type { ModelSpec } from '../models/catalog'
import { l2Normalize, randomProject, reduceToIndexWidth, truncateMatryoshka } from './reduce'

function norm(vector: Float32Array): number {
  let sum = 0
  for (const value of vector) sum += value * value
  return Math.sqrt(sum)
}

function dot(left: Float32Array, right: Float32Array): number {
  let sum = 0
  for (let i = 0; i < left.length; i++) sum += (left[i] as number) * (right[i] as number)
  return sum
}

/** A deterministic pseudo-random unit vector, so the numbers below are reproducible. */
function unitVector(dims: number, seed: number): Float32Array {
  let state = seed >>> 0
  const vector = new Float32Array(dims)
  for (let i = 0; i < dims; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    vector[i] = state / 2 ** 31 - 1
  }
  return l2Normalize(vector)
}

const spec = (overrides: Partial<ModelSpec>): ModelSpec => ({
  id: 'test',
  kind: 'embedding',
  repo: 'test/test',
  revision: 'a'.repeat(40),
  dtype: 'quantized',
  files: [],
  bytes: 0,
  nativeDims: 768,
  dims: 768,
  reduction: 'none',
  maxTokens: 512,
  pooling: 'mean',
  queryPrefix: '',
  documentPrefix: '',
  license: 'mit',
  spaceId: 'test@768',
  ...overrides,
})

describe('l2Normalize', () => {
  it('makes a vector unit length', () => {
    expect(norm(l2Normalize(Float32Array.from([3, 4])))).toBeCloseTo(1, 6)
  })

  it('leaves a zero vector alone rather than filling the index with NaNs', () => {
    const zero = l2Normalize(new Float32Array(4))
    expect([...zero]).toEqual([0, 0, 0, 0])
  })
})

describe('truncateMatryoshka', () => {
  it('keeps the prefix and re-normalizes it', () => {
    const source = l2Normalize(Float32Array.from([1, 1, 1, 1]))
    const truncated = truncateMatryoshka(source, 2)
    expect(truncated).toHaveLength(2)
    expect(norm(truncated)).toBeCloseTo(1, 6)
    // Direction within the prefix is untouched; only the scale changes.
    expect(truncated[0]).toBeCloseTo(truncated[1] as number, 6)
  })

  it('does not invent dimensions it does not have', () => {
    expect(() => truncateMatryoshka(new Float32Array(4), 8)).toThrow(RangeError)
  })
})

describe('randomProject', () => {
  it('is deterministic — the same seed gives the same matrix on every run', () => {
    const source = unitVector(1024, 7)
    const first = randomProject(source, 768, 'bge-m3@768')
    const second = randomProject(unitVector(1024, 7), 768, 'bge-m3@768')
    expect([...first]).toEqual([...second])
  })

  it('is a different space under a different seed, which is why the seed is the space id', () => {
    const source = unitVector(1024, 11)
    const a = randomProject(source, 768, 'bge-m3@768')
    const b = randomProject(unitVector(1024, 11), 768, 'something-else@768')
    expect([...a]).not.toEqual([...b])
  })

  it('returns a unit vector of exactly the requested width', () => {
    const projected = randomProject(unitVector(1024, 3), 768, 'seed')
    expect(projected).toHaveLength(768)
    expect(norm(projected)).toBeCloseTo(1, 5)
  })

  it('preserves cosine similarity to within ~0.05 at 1024 → 768', () => {
    // The Johnson–Lindenstrauss property, measured rather than asserted from the lemma: at
    // this mild a reduction the distortion has to be small, or bge-m3 is not storable in a
    // 768-wide index at all. The bound is what the subsampled Hadamard transform actually
    // delivers; a sparse ±1 matrix, the obvious alternative, is twice as noisy here.
    let worst = 0
    for (let trial = 0; trial < 60; trial++) {
      const left = unitVector(1024, trial * 2 + 1)
      const right = unitVector(1024, trial * 2 + 2)
      const before = dot(left, right)
      const after = dot(randomProject(left, 768, 'seed'), randomProject(right, 768, 'seed'))
      worst = Math.max(worst, Math.abs(after - before))
    }
    expect(worst).toBeLessThan(0.05)
  })

  it('is most accurate exactly where retrieval needs it: on near neighbours', () => {
    // A retrieval index is judged on whether it can still tell a close match from a
    // middling one, not on what it does to two unrelated vectors.
    let worst = 0
    for (let trial = 0; trial < 60; trial++) {
      const anchor = unitVector(1024, 500 + trial)
      const noise = unitVector(1024, 900 + trial)
      const near = l2Normalize(
        Float32Array.from(anchor, (value, index) => value + 0.5 * (noise[index] as number)),
      )
      const before = dot(anchor, near)
      const after = dot(randomProject(anchor, 768, 'seed'), randomProject(near, 768, 'seed'))
      worst = Math.max(worst, Math.abs(after - before))
    }
    expect(worst).toBeLessThan(0.02)
  })

  it('keeps the ranking a KNN query would produce over a corpus with real structure', () => {
    // What matters downstream is the *order*. Random vectors in 1024 dimensions are all
    // near-orthogonal, so ranking them is ranking noise and would prove nothing; this corpus
    // is built from a handful of latent topics, the way real embeddings cluster.
    const topics = Array.from({ length: 8 }, (_unused, index) => unitVector(1024, 1000 + index))
    const corpus = Array.from({ length: 60 }, (_unused, index) => {
      const topic = topics[index % topics.length] as Float32Array
      const noise = unitVector(1024, 3000 + index)
      return l2Normalize(
        Float32Array.from(topic, (value, at) => value + 0.45 * (noise[at] as number)),
      )
    })
    const query = topics[2] as Float32Array

    const rank = (vectors: Float32Array[], probe: Float32Array): number[] =>
      vectors
        .map((vector, index) => ({ index, score: dot(vector, probe) }))
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.index)

    const before = rank(corpus, query)
    const after = rank(
      corpus.map((vector) => randomProject(vector, 768, 'seed')),
      randomProject(Float32Array.from(query), 768, 'seed'),
    )

    // The documents that really belong to the queried topic. Recovering all of them at the
    // top is the property retrieval depends on; which order they come in among themselves is
    // near-tie noise the projection is allowed to reshuffle.
    const onTopic = corpus.map((_unused, index) => index).filter((index) => index % 8 === 2)
    const ascending = (values: number[]): number[] => [...values].sort((a, b) => a - b)
    expect(ascending(before.slice(0, onTopic.length))).toEqual(onTopic)
    expect(ascending(after.slice(0, onTopic.length))).toEqual(onTopic)

    const topBefore = new Set(before.slice(0, 10))
    const overlap = after.slice(0, 10).filter((index) => topBefore.has(index)).length
    expect(overlap).toBeGreaterThanOrEqual(9)
  })

  it('handles a native width that is not a power of two by padding, not by failing', () => {
    // Every catalog model happens to be 768 or 1024 today; a future one need not be, and the
    // Hadamard step only accepts a power of two.
    const projected = randomProject(unitVector(1536, 4), 768, 'seed')
    expect(projected).toHaveLength(768)
    expect(norm(projected)).toBeCloseTo(1, 5)
  })

  it('refuses to project upwards', () => {
    expect(() => randomProject(new Float32Array(256), 768, 'seed')).toThrow(RangeError)
  })
})

describe('reduceToIndexWidth', () => {
  it('normalizes and copies when the model is already the index width', () => {
    const source = Float32Array.from({ length: 768 }, () => 2)
    const reduced = reduceToIndexWidth(source, spec({}))
    expect(norm(reduced)).toBeCloseTo(1, 6)
    // A copy: the caller's tensor slice is not something to mutate under it.
    expect(source[0]).toBe(2)
  })

  it('truncates a Matryoshka model and projects one that is not', () => {
    const wide = unitVector(1024, 5)
    const truncated = reduceToIndexWidth(wide, spec({ nativeDims: 1024, reduction: 'matryoshka' }))
    const projected = reduceToIndexWidth(
      unitVector(1024, 5),
      spec({ nativeDims: 1024, reduction: 'random-projection' }),
    )
    expect(truncated).toHaveLength(768)
    expect(projected).toHaveLength(768)
    expect([...truncated]).not.toEqual([...projected])
  })

  it('rejects a vector that is not the width the catalog promised', () => {
    // A model whose export changed shape must fail loudly here, not write 512-dim vectors
    // into a 768-dim index under a `model_id` that says they are comparable.
    expect(() => reduceToIndexWidth(new Float32Array(512), spec({}))).toThrow(/512-dim/)
  })

  it('rejects an inconsistent catalog entry rather than silently mis-sizing the index', () => {
    expect(() =>
      reduceToIndexWidth(unitVector(1024, 1), spec({ nativeDims: 1024, reduction: 'none' })),
    ).toThrow(/declares no reduction/)
  })
})
