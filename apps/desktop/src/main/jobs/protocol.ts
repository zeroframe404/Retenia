import type { JsonObject, JsonValue } from '@retenia/core'
import { z } from 'zod'

/**
 * The wire between main and a job worker, over a `MessagePortMain`.
 *
 * Both ends are our own code, so this is not a trust boundary the way IPC from the renderer
 * is. It is validated anyway for the same reason `emitEvent` validates a push: a malformed
 * message should fail loudly here, at the seam, rather than as an undefined-property crash
 * three frames into a worker that then dies without telling anyone which job it was running.
 */

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

/** main → worker. */
export const jobRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    jobId: z.string(),
    kind: z.string(),
    payload: jsonObjectSchema,
    /** The row's `attempts` after the claim incremented it, so a job can log its own retry. */
    attempt: z.int().positive(),
  }),
  z.object({ type: z.literal('cancel'), jobId: z.string() }),
  /** Finish the current job, then exit. How a recycled worker retires gracefully. */
  z.object({ type: z.literal('shutdown') }),
])
export type JobRequest = z.infer<typeof jobRequestSchema>

/** worker → main. */
export const jobResponseSchema = z.discriminatedUnion('type', [
  /** Sent once, as soon as the port is live. Until it arrives the worker gets no work. */
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('progress'),
    jobId: z.string(),
    value: z.number().min(0).max(1),
    // Bounded: this string is persisted per job and pushed to the renderer at 10 Hz, so a
    // job that put something enormous in it would bloat the row and the bridge alike.
    message: z.string().max(500).nullable(),
  }),
  z.object({ type: z.literal('done'), jobId: z.string(), result: jsonValueSchema.nullable() }),
  z.object({
    type: z.literal('error'),
    jobId: z.string(),
    message: z.string().max(2_000),
    /** True when the failure is the job noticing its own cancellation, not a fault. */
    cancelled: z.boolean(),
  }),
  z.object({
    type: z.literal('log'),
    jobId: z.string(),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
  }),
  /**
   * Reported after every job so main can retire a worker whose memory has grown
   * (`docs/spec/07-architecture.md` §11's "recycle utility processes" mitigation).
   */
  z.object({ type: z.literal('idle'), rssBytes: z.int().nonnegative() }),
])
export type JobResponse = z.infer<typeof jobResponseSchema>

/**
 * The handshake main posts on the child's own channel, carrying the port and the directories
 * `hashFile` (and, later, every ingestion job) may read.
 *
 * The roots come from `app.getPath`, which only main can call — the worker bundle must stay
 * free of Electron so the job definitions can be unit-tested as plain Node.
 */
export const jobHandshakeSchema = z.object({
  type: z.literal('handshake'),
  readableRoots: z.array(z.string()),
  /**
   * `<userData>/models`, where `downloadModel` and `ingestEmbedSource` write ONNX weights
   * (sub-phase 6.3). Named separately rather than picked out of `readableRoots` by position,
   * because it is the one directory a job *writes* to outside the blob store — a job that
   * had to guess which root that was would be one refactor away from writing weights into
   * the blob store, or a book into the models directory.
   */
  modelsRoot: z.string(),
  /**
   * `<userData>/bin`, where sub-phase 6.4's media job installs and runs ffmpeg and
   * whisper-cli. Named separately for the same reason `modelsRoot` is — it is a directory a
   * job *writes* to outside the blob store — and with one extra caveat worth stating: it is
   * the only writable directory whose contents are then **executed**. What keeps that
   * bounded is that only `installSidecar` writes here, every archive is checked against the
   * SHA-256 in `packages/ingest/src/sidecars/manifest.json` before it is unpacked, and only
   * the binaries the manifest names are ever spawned.
   */
  binRoot: z.string().optional(),
  /**
   * The handful of host environment variables a spawned sidecar needs.
   *
   * The pool forks workers with `env: {}` so a provider API key can never reach a parser,
   * which means the worker's own `process.env` is empty and it cannot look these up. On
   * Linux that mostly goes unnoticed; on Windows a process with no `SystemRoot` fails to
   * initialise Winsock and dies before it parses its arguments. Main reads them with
   * `forwardableEnv` and passes them here.
   */
  hostEnv: z.record(z.string(), z.string()).optional(),
})
export type JobHandshake = z.infer<typeof jobHandshakeSchema>
