/**
 * The optional last stage of hybrid retrieval (`docs/spec/05-ingestion-rag.md` §4:
 * "top-50 BM25 ∪ top-50 vector → Reciprocal Rank Fusion → local reranker → top-10–20").
 *
 * A cross-encoder (mxbai-rerank-base-v2 or bge-reranker-v2-m3 locally, Cohere Rerank 4 or
 * voyage rerank-3-lite in the cloud) reads the query and each candidate together, so it
 * scores far better than either index alone — and costs 0.2–1 s per 20 documents on CPU.
 * That is why it is a port with an identity default: retrieval works without one, and the
 * user turns it on where the latency is affordable.
 */
export interface RerankDocument {
  /** The chunk id, echoed back in the result. */
  id: string
  /** What the reranker reads: the chunk text, with its heading path when there is one. */
  text: string
  /** The fusion score the candidate arrived with, so an identity reranker is truly identity. */
  score: number
}

export interface RerankResult {
  id: string
  /** Relevance for this query. Comparable within one result set only; higher is better. */
  score: number
}

export interface RerankOptions {
  /** Keep at most this many; the reranker may return fewer, never more. */
  topN?: number
}

export interface Reranker {
  /** For the cost log and for "which reranker produced this order". */
  readonly id: string
  /**
   * Returns the documents it kept, best first. Ids that are not in `documents` are ignored
   * by the caller, and documents the reranker drops simply do not appear.
   */
  rerank(
    query: string,
    documents: readonly RerankDocument[],
    options?: RerankOptions,
  ): Promise<readonly RerankResult[]>
}

/**
 * The default: keeps the fusion order and the fusion scores untouched. Retrieval is then
 * exactly "BM25 ∪ vector → RRF → top-N", which is what v1 ships until a local cross-encoder
 * is bundled.
 */
export const passthroughReranker: Reranker = {
  id: 'passthrough',
  rerank: (_query, documents, options) =>
    Promise.resolve(
      documents
        .map((document) => ({ id: document.id, score: document.score }))
        .slice(0, options?.topN ?? documents.length),
    ),
}
