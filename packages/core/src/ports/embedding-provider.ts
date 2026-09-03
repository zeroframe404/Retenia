/**
 * The port every embedding model is reached through: local (EmbeddingGemma-300M, bge-m3
 * via `@huggingface/transformers`) or cloud (`text-embedding-3-small`, `voyage-4-lite`).
 * `packages/core` never imports a provider SDK — the adapters live in `packages/ai` and the
 * ingestion jobs receive one of these (`docs/spec/05-ingestion-rag.md` §3).
 */
export interface EmbeddingProvider {
  /**
   * Identifies the vector space, stored on every row and required by every vector query:
   * distances between two models' vectors are meaningless, so the spec's rule is "store the
   * `model_id` per embedding and never mix spaces".
   */
  readonly modelId: string
  /** Width of the vectors this provider returns. Must match the index it feeds. */
  readonly dims: number
  /**
   * Embeds a batch, returning one vector per input in the same order. Implementations are
   * expected to L2-normalize (the app's index quantizes to int8 assuming unit vectors) and
   * to batch internally; callers pass whole chunk pages.
   */
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>
}
