import type { EmbeddingProvider } from '../ports'

/**
 * A deterministic `EmbeddingProvider` for tests: no model, no network, no GPU, and the same
 * vector for the same text on every machine and every run.
 *
 * It is the hashing trick (Weinberger et al. 2009): each token is hashed to one dimension
 * and a sign, the counts are accumulated and the vector is L2-normalized. That is not a
 * semantic embedding — it cannot know that "corazón" and "cardíaco" are related — but it
 * has the two properties the retrieval tests actually need:
 *
 *  - texts that share vocabulary land close together and texts that share none land far
 *    apart, so "the vector branch found the right chunk" is a real assertion;
 *  - the vectors are unit-length, which is what the int8 quantization of the index assumes.
 *
 * Tokens are lower-cased and stripped of diacritics, matching the FTS5 tokenizer's promise
 * (`unicode61 remove_diacritics 2`), so `corazon` and `corazón` embed identically.
 */

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

/** FNV-1a over the UTF-16 code units, as an unsigned 32-bit integer. */
function hash32(token: string, salt: number): number {
  let hash = (FNV_OFFSET ^ salt) >>> 0
  for (let i = 0; i < token.length; i++) {
    hash = (hash ^ token.charCodeAt(i)) >>> 0
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash >>> 0
}

/** Lower-case, strip diacritics, split on anything that is not a letter or a digit. */
export function fakeEmbeddingTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
}

export interface FakeEmbeddingProviderOptions {
  modelId?: string
  dims?: number
}

/** `dims` defaults to 768 — the width of the app's `embeddings` table. */
export function createFakeEmbeddingProvider(
  options: FakeEmbeddingProviderOptions = {},
): EmbeddingProvider {
  const dims = options.dims ?? 768
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new RangeError(`fake embedding provider: dims must be a positive integer, got ${dims}`)
  }
  const modelId = options.modelId ?? `fake-hash-${dims}`

  function embedOne(text: string): Float32Array {
    const vector = new Float32Array(dims)
    for (const token of fakeEmbeddingTokens(text)) {
      const index = hash32(token, 0) % dims
      // A second, independent hash decides the sign, so collisions cancel instead of piling
      // up and every vector does not end up in the same orthant.
      const sign = (hash32(token, 0x9e3779b9) & 1) === 0 ? 1 : -1
      vector[index] = (vector[index] as number) + sign
    }
    let norm = 0
    for (const value of vector) norm += value * value
    if (norm === 0) {
      // An empty (or punctuation-only) text still needs a unit vector, and one that is far
      // from every real text: a fixed axis nothing else hashes onto often.
      vector[dims - 1] = 1
      return vector
    }
    norm = Math.sqrt(norm)
    for (let i = 0; i < dims; i++) vector[i] = (vector[i] as number) / norm
    return vector
  }

  return {
    modelId,
    dims,
    embed: (texts) => Promise.resolve(texts.map(embedOne)),
  }
}
