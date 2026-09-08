/**
 * What a batch *is* to this layer, and the store it survives a restart in
 * (`docs/spec/06-ai-providers.md` §2: the Batch API is -50 % on everything, takes up to
 * 100,000 requests, "most finish in under 1 h", maximum 24 h).
 *
 * The durable half is deliberately small. A batch row carries what is needed to **poll,
 * reconcile and report** — the provider's own id for the job, how many requests went in, what
 * the quote was, and the binding every reconciled result is written back under — and never
 * the requests themselves. Forty expanded lessons are megabytes of prompt, and storing them
 * would put the largest rows in the database behind the one feature whose whole purpose is to
 * be cheap.
 *
 * What that costs is precise: a *retry of the failed ids* after the app has been restarted.
 * The requests are held in memory for the life of the process, so an in-process retry has
 * them; a restart does not, and reports the failures instead. That is an acceptable loss
 * because of the result cache: re-running the caller's own unit of work answers every
 * succeeded `custom_id` from `ai_results` for free and pays only for the ones that failed —
 * which is the same outcome, reached by the caller rather than by a resumed poll.
 */

/**
 * `submitting` exists because the row is written *before* the provider is called.
 *
 * A crash between the two would otherwise leave a batch that was accepted upstream with
 * nothing here to poll it, and the app would go on paying for a job it had forgotten. The row
 * comes first, and a `submitting` row found at startup is retired as failed: we cannot know
 * whether the provider received it, and inventing an id to poll would be worse than saying so.
 */
export const AI_BATCH_STATUSES = [
  'submitting',
  'submitted',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const
export type AiBatchStatus = (typeof AI_BATCH_STATUSES)[number]

/** Nothing more will happen to a batch in one of these. */
export const TERMINAL_BATCH_STATUSES: ReadonlySet<AiBatchStatus> = new Set<AiBatchStatus>([
  'completed',
  'failed',
  'cancelled',
])

export function isTerminalBatchStatus(status: AiBatchStatus): boolean {
  return TERMINAL_BATCH_STATUSES.has(status)
}

export interface AiBatchRecord {
  readonly id: string
  /** The profile id, as `ai_calls.provider` records it. */
  readonly provider: string
  readonly model: string
  readonly role: string
  /** The feature tag every reconciled `ai_calls` row inherits. */
  readonly purpose: string
  /** The `ai_results.stage` every reconciled answer is stored under. */
  readonly stage: string
  readonly status: AiBatchStatus
  /** The provider's own id for the job — what `poll` and `cancel` address. */
  readonly providerBatchId: string | null
  readonly requestCount: number
  readonly succeededCount: number
  readonly failedCount: number
  /** What `estimateBatch` quoted before submission, so the two can be compared afterwards. */
  readonly costEstimateUsd: number
  /** What the reconciled results actually cost. Zero until they arrive. */
  readonly costUsd: number
  /** Poll attempts so far — the input to the backoff, and what bounds a stuck job. */
  readonly attempts: number
  readonly submittedAt: Date | null
  /** Not polled again before this instant. The `jobs` table's `run_after`, for a batch. */
  readonly nextPollAt: Date | null
  readonly completedAt: Date | null
  readonly promptVersion: string | null
  readonly schemaVersion: string | null
  readonly error: string | null
  readonly createdAt: Date
}

export interface NewAiBatch {
  readonly provider: string
  readonly model: string
  readonly role: string
  readonly purpose: string
  readonly stage: string
  readonly status: AiBatchStatus
  readonly requestCount: number
  readonly costEstimateUsd: number
  readonly promptVersion: string | null
  readonly schemaVersion: string | null
  readonly nextPollAt: Date | null
}

export interface AiBatchPatch {
  readonly status?: AiBatchStatus
  readonly providerBatchId?: string | null
  readonly succeededCount?: number
  readonly failedCount?: number
  readonly costUsd?: number
  readonly attempts?: number
  readonly submittedAt?: Date | null
  readonly nextPollAt?: Date | null
  readonly completedAt?: Date | null
  readonly error?: string | null
}

/**
 * The seam `packages/db`'s `ai_batches` repository fills, and a `Map` fills in a test.
 *
 * Narrower than a `CrudRepository` on purpose: this layer creates a batch, patches it as it
 * moves, and enumerates the ones still running at startup. It structurally cannot delete one,
 * which is what keeps "what did this month's batches cost" answerable.
 */
export interface AiBatchStore {
  create(input: NewAiBatch): Promise<AiBatchRecord>
  update(id: string, patch: AiBatchPatch): Promise<AiBatchRecord>
  findById(id: string): Promise<AiBatchRecord | undefined>
  /** Every batch not in a terminal status, oldest first — what `resume()` picks up. */
  listActive(): Promise<readonly AiBatchRecord[]>
}
