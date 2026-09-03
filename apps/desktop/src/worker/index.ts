import { createJobRegistry, type JobContext, type JobRegistry } from '@retenia/core'
import { createJobDefinitions } from '../jobs/definitions'
import {
  type JobRequest,
  type JobResponse,
  jobHandshakeSchema,
  jobRequestSchema,
} from '../main/jobs/protocol'

/**
 * A job worker: an Electron `utilityProcess` that runs one job at a time
 * (`docs/spec/07-architecture.md` §7).
 *
 * It never touches SQLite. Main owns the database and is its single writer (§5), so a worker
 * receives a payload, runs the definition, and posts progress and a result back over its
 * port. That keeps `better-sqlite3` out of this bundle entirely, which is also what makes
 * recycling a worker cheap — there is no connection to tear down.
 */

/** Built from the handshake, because the readable roots come from main. */
let registry: JobRegistry

/** The job in flight, if any. One at a time: the pool is what provides concurrency. */
let current: { jobId: string; controller: AbortController } | undefined
/** Set by `shutdown`; the worker exits as soon as it is not mid-job. */
let retiring = false

function send(port: Electron.MessagePortMain, message: JobResponse): void {
  port.postMessage(message)
}

function exitWhenIdle(port: Electron.MessagePortMain): void {
  if (retiring && current === undefined) {
    port.close()
    process.exit(0)
  }
}

function buildContext(
  port: Electron.MessagePortMain,
  jobId: string,
  controller: AbortController,
): JobContext {
  const logAt =
    (level: 'info' | 'warn' | 'error') =>
    (message: string): void => {
      send(port, { type: 'log', jobId, level, message })
    }

  return {
    jobId,
    // The runner throttles these to 10 Hz before they reach a renderer, so a job is free to
    // report as often as is natural for it.
    progress: (value, message) => {
      send(port, {
        type: 'progress',
        jobId,
        value: Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)),
        message: message ?? null,
      })
    },
    // A real `AbortSignal` satisfies core's structural `JobAbortSignal`.
    signal: controller.signal,
    log: { info: logAt('info'), warn: logAt('warn'), error: logAt('error') },
  }
}

async function start(
  port: Electron.MessagePortMain,
  request: Extract<JobRequest, { type: 'start' }>,
): Promise<void> {
  const { jobId, kind, payload } = request
  const definition = registry.get(kind)
  if (definition === undefined) {
    send(port, {
      type: 'error',
      jobId,
      message: `This build has no job definition for "${kind}"`,
      cancelled: false,
    })
    send(port, { type: 'idle', rssBytes: process.memoryUsage().rss })
    return
  }

  const controller = new AbortController()
  current = { jobId, controller }

  try {
    const result = await definition.run(payload, buildContext(port, jobId, controller))
    send(port, { type: 'done', jobId, result: result ?? null })
  } catch (error) {
    // `controller.signal.aborted` rather than the error's identity: a cancelled job may
    // surface as any rejection at all — an aborted stream, a killed child process — and
    // what main needs to know is whether it asked for this.
    send(port, {
      type: 'error',
      jobId,
      message: error instanceof Error ? error.message : String(error),
      cancelled: controller.signal.aborted,
    })
  } finally {
    current = undefined
    send(port, { type: 'idle', rssBytes: process.memoryUsage().rss })
    exitWhenIdle(port)
  }
}

function handle(port: Electron.MessagePortMain, raw: unknown): void {
  const parsed = jobRequestSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('[job-worker] ignored a malformed request:', parsed.error.message)
    return
  }

  const request = parsed.data
  switch (request.type) {
    case 'start':
      // Fire and forget: `start` reports its own outcome over the port, and awaiting here
      // would only block the message handler that has to stay free to receive `cancel`.
      void start(port, request)
      return
    case 'cancel':
      if (current?.jobId === request.jobId) current.controller.abort()
      return
    case 'shutdown':
      retiring = true
      // A worker mid-job finishes it first; main's kill timer is the backstop if it does not.
      exitWhenIdle(port)
      return
  }
}

// The port arrives as the first message on the child's own channel; nothing can be sent or
// received until `start()` is called on it.
process.parentPort.once('message', (event) => {
  const port = event.ports[0]
  if (port === undefined) {
    console.error('[job-worker] handshake carried no port; exiting')
    process.exit(1)
  }

  const handshake = jobHandshakeSchema.safeParse(event.data)
  if (!handshake.success) {
    console.error('[job-worker] malformed handshake; exiting:', handshake.error.message)
    process.exit(1)
  }
  registry = createJobRegistry(createJobDefinitions(handshake.data.readableRoots))

  port.on('message', (message) => handle(port, message.data))
  port.start()

  // Any escape from a job's own error handling would otherwise kill the worker silently,
  // leaving main to infer the failure from the exit. Report it against the job first.
  const die = (error: unknown): void => {
    if (current !== undefined) {
      send(port, {
        type: 'error',
        jobId: current.jobId,
        message: error instanceof Error ? error.message : String(error),
        cancelled: false,
      })
    }
    process.exit(1)
  }
  process.on('uncaughtException', die)
  process.on('unhandledRejection', die)

  send(port, { type: 'ready' })
})
