/**
 * Cosine similarity of two unit vectors is their dot product. `EmbeddingProvider.embed`
 * returns L2-normalised vectors (`packages/core/src/ports/embedding-provider.ts`), so this is
 * the whole of the arithmetic the embedding pass needs.
 */
export function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) {
    sum += (a[index] as number) * (b[index] as number)
  }
  return sum
}
