/**
 * The port every embedding model is reached through: local (EmbeddingGemma-300M, bge-m3
 * via `@huggingface/transformers`) or cloud (`text-embedding-3-small`, `voyage-4-lite`).
 * `packages/core` never imports a provider SDK — the adapters live in `packages/ingest`
 * (local, Node-only) and `packages/ai` (cloud, sub-phase 7.1), and the ingestion jobs
 * receive one of these (`docs/spec/05-ingestion-rag.md` §3).
 */
export interface EmbeddingProvider {
  /**
   * Identifies the vector space, stored on every row and required by every vector query:
   * distances between two models' vectors are meaningless, so the spec's rule is "store the
   * `model_id` per embedding and never mix spaces".
   *
   * It identifies the space, not the model: a provider that truncates or projects a model's
   * native output down to the width of the index produces a *different* space from the
   * model's own, and says so here.
   */
  readonly modelId: string
  /** Width of the vectors this provider returns. Must match the index it feeds. */
  readonly dims: number
  /**
   * Embeds a batch of **documents**, returning one vector per input in the same order.
   * Implementations are expected to L2-normalize (the app's index quantizes to int8 assuming
   * unit vectors) and to batch internally; callers pass whole chunk pages.
   */
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>
  /**
   * Embeds a **query**, when the model is asymmetric.
   *
   * Instruction-tuned retrieval models are trained with a different prefix on each side —
   * EmbeddingGemma wants `task: search result | query: ` in front of a query and
   * `title: none | text: ` in front of a passage — and embedding a query as if it were a
   * passage measurably costs recall. Optional because plenty of models (bge-m3, the OpenAI
   * family) are symmetric and have nothing to do here; use `embedQuery()` below rather than
   * calling this directly, so a symmetric provider needs no implementation at all.
   */
  embedQuery?(text: string): Promise<Float32Array>
}

/** Embeds one query with the provider's query side when it has one, and as a document
 *  otherwise. The one call site every retrieval path should use. */
export async function embedQuery(provider: EmbeddingProvider, text: string): Promise<Float32Array> {
  if (provider.embedQuery !== undefined) return provider.embedQuery(text)
  const [vector] = await provider.embed([text])
  if (vector === undefined) throw new Error(`${provider.modelId} returned no vector for the query`)
  return vector
}
