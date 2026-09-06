import { z } from 'zod'

/**
 * The wire between main and the model host (`src/worker/embedding-host.ts`).
 *
 * Same shape and the same reasoning as `main/jobs/protocol.ts`: every message crossing a
 * process boundary is parsed, never cast, so a corrupted or out-of-date child cannot make
 * main act on a shape it does not understand.
 */

/** The `retrieval.device` setting, as it crosses the wire. Mirrors `EmbeddingDevice` in
 *  `packages/ingest`; declared here so the schemas below are the single source of the union
 *  and no conditional type has to dig it back out of them. */
export const embeddingDeviceSchema = z.enum(['auto', 'webgpu', 'cuda', 'dml', 'cpu'])
export type EmbeddingHostDevice = z.infer<typeof embeddingDeviceSchema>

/** How the host is told which provider to load. Exactly one of the two. */
export const embeddingHostModelSchema = z.union([
  z.object({
    kind: z.literal('local'),
    /** A catalog id — the host refuses anything the manifest does not describe. */
    modelId: z.string().min(1),
    device: embeddingDeviceSchema,
  }),
  z.object({
    kind: z.literal('ollama'),
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    nativeDims: z.int().min(1).max(8192),
  }),
])
export type EmbeddingHostModel = z.infer<typeof embeddingHostModelSchema>

export const embeddingHostHandshakeSchema = z.object({
  type: z.literal('handshake'),
  modelsRoot: z.string(),
})
export type EmbeddingHostHandshake = z.infer<typeof embeddingHostHandshakeSchema>

export const embeddingHostRequestSchema = z.discriminatedUnion('type', [
  /**
   * Embed one query. `id` correlates the reply; the host answers requests in the order it
   * receives them, but a caller must not depend on that — a search box in flight can have
   * two outstanding at once, and the stale one's answer has to be discardable.
   */
  z.object({
    type: z.literal('embedQuery'),
    id: z.string().min(1),
    model: embeddingHostModelSchema,
    text: z.string(),
  }),
  /** Score candidates against a query with the local cross-encoder. */
  z.object({
    type: z.literal('rerank'),
    id: z.string().min(1),
    modelId: z.string().min(1),
    device: embeddingDeviceSchema,
    query: z.string(),
    documents: z.array(z.object({ id: z.string(), text: z.string(), score: z.number() })).max(200),
    topN: z.int().min(1).max(200).optional(),
  }),
  /** Drop whatever is loaded. Sent on an idle timeout and before the host is retired. */
  z.object({ type: z.literal('unload') }),
  z.object({ type: z.literal('shutdown') }),
])
export type EmbeddingHostRequest = z.infer<typeof embeddingHostRequestSchema>

export const embeddingHostResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('embedding'),
    id: z.string(),
    modelId: z.string(),
    /** `dims` float32 values, little-endian, base64 — the same encoding the embed job's
     *  vectors blob uses, for the same reason: 768 numbers as JSON is ~4× the bytes. */
    vector: z.string(),
    dims: z.int().min(1),
    /** Milliseconds inside the forward pass, for the perf notes and the "why is search slow"
     *  question. */
    ms: z.number(),
  }),
  z.object({
    type: z.literal('reranked'),
    id: z.string(),
    results: z.array(z.object({ id: z.string(), score: z.number() })),
    ms: z.number(),
  }),
  z.object({ type: z.literal('error'), id: z.string(), message: z.string() }),
  /** What is loaded right now, so main can log the device and report it in settings. */
  z.object({
    type: z.literal('loaded'),
    modelId: z.string(),
    device: z.string(),
    ms: z.number(),
  }),
  z.object({ type: z.literal('unloaded') }),
])
export type EmbeddingHostResponse = z.infer<typeof embeddingHostResponseSchema>

/** Encode/decode the base64 float32 payload above. One definition, both sides. */
export function encodeVector(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64')
}

export function decodeVector(encoded: string, dims: number): Float32Array {
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.byteLength !== dims * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`the embedding host returned ${buffer.byteLength} bytes for ${dims} dimensions`)
  }
  // Copied rather than viewed: `Buffer` is a view into a pooled ArrayBuffer, and a view onto
  // a pool is not something to hand to a caller that will hold it.
  return new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  )
}
