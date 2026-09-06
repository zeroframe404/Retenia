import { dirname } from 'node:path'
import { createJobRegistry, createJobScheduler, uuidv7 } from '@retenia/core'
import type { JobProgressEvent, JobSummary } from '@retenia/ipc-contract'
import { createJobDefinitions } from '../../jobs/definitions'
import { createFsBlobStore } from '../blobs/store'
import { type AppDatabase, openAppDatabase } from '../db/open'
import { createLibraryService, type LibraryService } from '../library/service'
import { log } from '../logging/log'
import { getBlobsRoot, getDevMediaSamplePath, getJobWorkerPath, getWorkRoot } from '../paths'
import { createJobsFacade, type JobsFacade } from './facade'
import { createJobPool } from './pool'
import { nodeProcessLiveness } from './process-liveness'
import { createJobRunner, type JobRunner } from './runner'

/**
 * Assembles the whole background-jobs stack: database → scheduler → worker pool → runner →
 * the facade the IPC handlers call.
 *
 * Kept out of `index.ts` because it is the one part of startup with a real failure mode. A
 * corrupt, locked or unreadable database must not stop the window from opening — the user
 * still needs to reach their settings and export diagnostics — so this degrades instead:
 * everything else starts, and the job channels report the failure rather than pretending an
 * empty queue.
 */

export interface JobsSubsystem {
  readonly facade: JobsFacade
  /** The source library (sub-phase 6.1) — import, retry, read back a parse. Degrades the
   *  same way `facade` does when the database did not open. */
  readonly library: LibraryService
  /** The shared connection jobs, settings, blobs, secrets and backups all read and write
   *  through — `null` when it failed to open, in which case every one of those subsystems
   *  degrades the same way `unavailableFacade` does below. */
  readonly database: AppDatabase | null
  /** Recovers orphans and starts claiming. No-op when the database did not open. */
  start(): Promise<void>
  stop(): Promise<void>
}

export interface BootstrapJobsOptions {
  deviceId: string
  emit: (event: JobProgressEvent) => void
  /** Whether `jobs.enqueueDemo` will queue anything. False in a packaged build. */
  demoEnabled: boolean
}

/** The facade used when the database never opened: every channel says why, rather than
 *  quietly reporting that there is no work. */
function unavailableFacade(reason: string): JobsFacade {
  const fail = (): never => {
    throw new Error(`The job queue is unavailable: ${reason}`)
  }
  return {
    list: async (): Promise<JobSummary[]> => fail(),
    find: fail,
    cancel: fail,
    retry: fail,
    enqueueDemo: fail,
  }
}

/** Same idea, for the library: importing anything needs the database it records sources in. */
function unavailableLibraryService(reason: string): LibraryService {
  const fail = (): never => {
    throw new Error(`The source library is unavailable: ${reason}`)
  }
  return {
    addFromFile: fail,
    addFromBytes: fail,
    addFromText: fail,
    retry: fail,
    list: fail,
    get: fail,
    getDoc: fail,
    remove: fail,
    onJobSettled: fail,
  }
}

export function bootstrapJobs({
  deviceId,
  emit,
  demoEnabled,
}: BootstrapJobsOptions): JobsSubsystem {
  let database: AppDatabase
  try {
    database = openAppDatabase(deviceId)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.error('[jobs] the database did not open; background jobs are disabled:', reason)
    return {
      facade: unavailableFacade(reason),
      library: unavailableLibraryService(reason),
      database: null,
      start: async () => {},
      stop: async () => {},
    }
  }

  /**
   * Where a job may read from. Everything the app owns lives under the blob store; the dev
   * media sample sits in the packaged resources and is what the demo `hashFile` hashes.
   *
   * Passed to the workers in their handshake, so the confinement travels with the definition
   * rather than depending on every enqueuer to have checked.
   */
  // `getWorkRoot()` is where the optimizer stages its training CSV (sub-phase 4.6).
  const readableRoots = [getBlobsRoot(), getWorkRoot(), dirname(getDevMediaSamplePath())]

  const registry = createJobRegistry(createJobDefinitions(readableRoots))

  // Minted per launch, not persisted: its whole job is to be different from the id any
  // previous run stamped into a lease, so recovery can recognise stranded work without
  // having to trust a pid the OS may since have reused.
  const runId = uuidv7()

  // `ownWorkerPids` is read lazily through the runner because the pool does not exist yet —
  // and must not, since the runner is what wires it. Recovery calls this only while it runs,
  // by which time every reference below is bound.
  let runner: JobRunner
  const scheduler = createJobScheduler({
    jobs: database.repos.jobs,
    clock: { now: () => new Date() },
    liveness: nodeProcessLiveness,
    registry,
    runId,
    ownWorkerPids: () => runner.livePids(),
  })

  // The same root the worker's own `BlobStore` (`apps/desktop/src/jobs/ingest-parse.ts`,
  // `readableRoots[0]`) writes into. Both are pure `node:fs`, so a second instance here
  // needs no coordination with the worker's.
  const blobStore = createFsBlobStore(getBlobsRoot())
  const library = createLibraryService({ repos: database.repos, blobStore, scheduler })

  runner = createJobRunner({
    scheduler,
    emit,
    onSettled: (job) => library.onJobSettled(job),
    createPool: (handlers) =>
      createJobPool({ ...handlers, entryPath: getJobWorkerPath(), readableRoots }),
  })

  return {
    facade: createJobsFacade({ scheduler, runner, demoEnabled }),
    library,
    database,
    start: () => runner.start(),
    stop: async () => {
      await runner.stop()
      database.close()
    },
  }
}
