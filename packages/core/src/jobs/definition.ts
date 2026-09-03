import type { JsonObject, JsonValue } from '../entities'

/**
 * What a background job *is*, independent of how it is stored or where it runs
 * (`docs/spec/07-architecture.md` §7).
 *
 * A definition is pure: it takes a parsed input and a context, and returns a JSON result.
 * It knows nothing about the `jobs` table, the `utilityProcess` pool, or the IPC push that
 * carries its progress to the tray — which is what lets the same definitions be unit-tested
 * in process and executed in a worker.
 */

/**
 * A cancellation signal.
 *
 * Declared structurally rather than as `AbortSignal` because this package compiles against
 * `lib: ["ES2023"]` with no DOM and no `@types/node` (`packages/config/tsconfig.base.json`),
 * so the global does not exist here. A real `AbortSignal` satisfies this shape, so the
 * runner passes `controller.signal` straight in.
 */
export interface JobAbortSignal {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Structured logging from inside a job. The runner routes it to electron-log with the
 *  job id attached; tests collect it in an array. */
export interface JobLogger {
  info(message: string, meta?: JsonObject): void
  warn(message: string, meta?: JsonObject): void
  error(message: string, meta?: JsonObject): void
}

/** What a running job is handed. */
export interface JobContext {
  readonly jobId: string
  /**
   * Report how far along the job is. `value` is 0–1 and is clamped by the runner.
   *
   * Call it as often as is natural — throttling (10 Hz to the renderer) and persistence
   * (slower still, a database write per tick would be waste) both happen downstream, never
   * here. A job that reports once per file is as correct as one that reports per byte.
   */
  progress(value: number, message?: string): void
  readonly signal: JobAbortSignal
  readonly log: JobLogger
}

/** One kind of background work. */
export interface JobDefinition<TInput, TResult extends JsonValue> {
  /** Matches the `kind` column of the `jobs` row. */
  readonly type: string
  /**
   * Turn the persisted payload into this job's input.
   *
   * Payloads come out of the database and may have been written by an older version of the
   * app, so this parses and throws on a shape it does not recognise — it is not a cast. A
   * bad payload fails the job with a clear message instead of crashing a worker somewhere
   * inside `run`.
   */
  parseInput(payload: JsonObject): TInput
  run(input: TInput, ctx: JobContext): Promise<TResult>
  /** Used by `JobScheduler.enqueue` when the caller names none. */
  readonly defaultPriority?: number
  readonly defaultMaxAttempts?: number
}

/**
 * A definition with its input type erased, so a registry can hold jobs of different input
 * types together without `any`. Only `registerJob` produces one.
 */
export interface RegisteredJob {
  readonly type: string
  readonly defaultPriority?: number
  readonly defaultMaxAttempts?: number
  run(payload: JsonObject, ctx: JobContext): Promise<JsonValue>
}

/**
 * Erase a definition's input type by closing over its own `parseInput`.
 *
 * `run` is `async` so a `parseInput` that throws *rejects* rather than throwing
 * synchronously. The runner treats every failure the same way — one `catch`, one
 * `scheduler.failed` — and a synchronous throw from what is typed as returning a promise
 * would slip past a caller that only attached `.catch()`.
 */
export function registerJob<TInput, TResult extends JsonValue>(
  definition: JobDefinition<TInput, TResult>,
): RegisteredJob {
  return {
    type: definition.type,
    defaultPriority: definition.defaultPriority,
    defaultMaxAttempts: definition.defaultMaxAttempts,
    run: async (payload, ctx) => definition.run(definition.parseInput(payload), ctx),
  }
}
