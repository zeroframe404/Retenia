import { cpus } from 'node:os'
import { MessageChannelMain, type MessagePortMain, utilityProcess } from 'electron'
import { log } from '../logging/log'
import { type JobHandshake, type JobRequest, type JobResponse, jobResponseSchema } from './protocol'

/**
 * The pool of `utilityProcess` workers that actually run jobs
 * (`docs/spec/07-architecture.md` §7).
 *
 * Each worker runs one job at a time; concurrency comes from having several. A worker is
 * retired and replaced after a number of jobs or once its RSS crosses a threshold — the
 * "recycle utility processes" mitigation for the OOM risk in §11, and the reason a leaky
 * parser in some future ingestion job cannot slowly eat the machine.
 *
 * §7 pairs `utilityProcess` with "`worker_threads` + piscina for pure CPU". No job in the
 * queue today is CPU-bound — `sleep` is a timer and `hashFile` is streamed I/O — so piscina
 * is deliberately not a dependency yet: adding it now would ship an unused package, and one
 * whose own `worker.js` is spawned from inside the asar, which is exactly the kind of thing
 * that works unpackaged and fails in a real build. It belongs with the first job that
 * actually needs it (embeddings, in the ingestion phase).
 */

export interface WorkerSlot {
  /** Stable across the slot's life; the *worker id* half of the job's lease. */
  readonly id: string
  /** The OS pid of the process currently filling this slot, once it is up. */
  readonly pid: number | undefined
  readonly busy: boolean
  readonly ready: boolean
  /** On its way out (recycling). `dispatch` refuses it, so a claim must not target it. */
  readonly retiring: boolean
}

/** What the pool reports back. The runner supplies these; nothing else does. */
export interface JobPoolHandlers {
  /**
   * Every validated message from a worker.
   *
   * `jobId` is the job that slot was actually dispatched, as the pool recorded it — not the
   * one the worker named. A worker can only ever speak about its own job, so a corrupted or
   * compromised one cannot mark somebody else's job succeeded. Undefined when the slot holds
   * no job, which is what a message arriving after completion looks like.
   */
  onMessage: (slotId: string, message: JobResponse, jobId: string | undefined) => void
  /** A worker died while holding a job — the job needs re-queueing. */
  onWorkerLost: (slotId: string, jobId: string, reason: string) => void
  /** A slot became free (or first became ready): time to try claiming again. */
  onIdle: () => void
}

export interface JobPoolOptions extends JobPoolHandlers {
  entryPath: string
  /** Directories the job definitions may read from. Sent in the handshake. */
  readableRoots: readonly string[]
  size?: number
  /** Retire a worker after this many jobs. */
  maxJobsPerWorker?: number
  /** Retire a worker whose RSS exceeds this after finishing a job. */
  maxRssBytes?: number
  /** How long a cancelled job has to stop cooperatively before its worker is killed. */
  cancelGraceMs?: number
}

export interface JobPool {
  start(): void
  /** Hand a job to a free, ready worker. False when none was available. */
  dispatch(request: Extract<JobRequest, { type: 'start' }>): boolean
  /** Ask the worker running `jobId` to abort, killing it if it does not stop in time. */
  cancel(jobId: string): boolean
  /** Pids of every live worker — what the scheduler must not reclaim leases from. */
  livePids(): ReadonlySet<number>
  hasCapacity(): boolean
  slots(): readonly WorkerSlot[]
  stop(): Promise<void>
}

/**
 * `min(4, cpus - 1)`, at least 1.
 *
 * Leaving a core for main and the renderer is the point: this is a desktop app whose UI has
 * to stay responsive while it works, not a batch server.
 */
export function defaultPoolSize(cpuCount = cpus().length): number {
  return Math.max(1, Math.min(4, cpuCount - 1))
}

export const DEFAULT_MAX_JOBS_PER_WORKER = 50
/** 512 MB. Well above a normal job, well below the point where the machine suffers. */
export const DEFAULT_MAX_RSS_BYTES = 512 * 1024 * 1024
export const DEFAULT_CANCEL_GRACE_MS = 5_000

interface Slot {
  id: string
  child: Electron.UtilityProcess | undefined
  port: MessagePortMain | undefined
  pid: number | undefined
  ready: boolean
  jobId: string | undefined
  jobsRun: number
  retiring: boolean
  killTimer: ReturnType<typeof setTimeout> | undefined
}

export function createJobPool(options: JobPoolOptions): JobPool {
  const size = options.size ?? defaultPoolSize()
  const maxJobsPerWorker = options.maxJobsPerWorker ?? DEFAULT_MAX_JOBS_PER_WORKER
  const maxRssBytes = options.maxRssBytes ?? DEFAULT_MAX_RSS_BYTES
  const cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS

  const slots: Slot[] = Array.from({ length: size }, (_unused, index) => ({
    id: `w${index}`,
    child: undefined,
    port: undefined,
    pid: undefined,
    ready: false,
    jobId: undefined,
    jobsRun: 0,
    retiring: false,
    killTimer: undefined,
  }))

  let stopping = false

  const clearKillTimer = (slot: Slot): void => {
    if (slot.killTimer !== undefined) {
      clearTimeout(slot.killTimer)
      slot.killTimer = undefined
    }
  }

  function spawn(slot: Slot): void {
    if (stopping) return

    const child = utilityProcess.fork(options.entryPath, [], {
      serviceName: `retenia-job-${slot.id}`,
      stdio: 'inherit',
      // An explicit, empty environment rather than an inherited copy of main's. Nothing here
      // needs one today, and starting closed means the provider API keys that arrive with the
      // AI layer cannot reach a worker — the process most likely to be running an untrusted
      // parser — just because something put them in `process.env`.
      env: {},
    })
    const { port1, port2 } = new MessageChannelMain()

    slot.child = child
    slot.port = port1
    slot.ready = false
    slot.jobsRun = 0
    slot.retiring = false

    child.once('spawn', () => {
      slot.pid = child.pid
      // The worker cannot receive anything until it holds the port, so it goes first.
      child.postMessage(
        { type: 'handshake', readableRoots: [...options.readableRoots] } satisfies JobHandshake,
        [port2],
      )
    })

    port1.on('message', (event) => {
      const parsed = jobResponseSchema.safeParse(event.data)
      if (!parsed.success) {
        log.error(`[jobs] ${slot.id} sent a malformed message:`, parsed.error.message)
        return
      }
      receive(slot, parsed.data)
    })
    port1.start()

    child.once('exit', (code) => {
      clearKillTimer(slot)
      const lostJob = slot.jobId
      const wasReady = slot.ready
      slot.child = undefined
      slot.port = undefined
      slot.pid = undefined
      slot.ready = false
      slot.jobId = undefined

      // A deliberate shutdown is not a fault: reporting the job as lost would send it round
      // the retry ladder on the way out, and the write would race the database closing.
      // Whatever was in flight stays `running` and is recovered on the next launch, which is
      // exactly what orphan recovery is for.
      if (stopping) return

      if (lostJob !== undefined) {
        options.onWorkerLost(slot.id, lostJob, `worker exited with code ${code}`)
      }

      // A worker that dies before it is ever ready is a broken build or a missing entry
      // point, not a transient fault; respawning in a tight loop would only spin.
      if (!wasReady && lostJob === undefined) {
        log.error(`[jobs] ${slot.id} exited before becoming ready (code ${code}); not respawning`)
        return
      }
      spawn(slot)
      options.onIdle()
    })
  }

  function receive(slot: Slot, message: JobResponse): void {
    if (message.type === 'ready') {
      slot.ready = true
      options.onIdle()
      return
    }

    options.onMessage(slot.id, message, slot.jobId)

    if (message.type === 'idle') {
      clearKillTimer(slot)
      slot.jobId = undefined
      slot.jobsRun += 1

      const exhausted = slot.jobsRun >= maxJobsPerWorker
      const bloated = message.rssBytes > maxRssBytes
      if (slot.retiring || exhausted || bloated) {
        log.info(
          `[jobs] recycling ${slot.id} after ${slot.jobsRun} job(s), rss ${message.rssBytes}`,
        )
        retire(slot)
        return
      }
      options.onIdle()
    }
  }

  /** Ask a worker to exit once idle, and make sure it does. */
  function retire(slot: Slot): void {
    const child = slot.child
    if (child === undefined) return
    slot.retiring = true
    slot.port?.postMessage({ type: 'shutdown' } satisfies JobRequest)
    clearKillTimer(slot)
    slot.killTimer = setTimeout(() => {
      slot.killTimer = undefined
      log.warn(`[jobs] ${slot.id} did not exit after shutdown; killing it`)
      child.kill()
    }, cancelGraceMs)
  }

  const free = (): Slot | undefined =>
    slots.find((slot) => slot.ready && !slot.retiring && slot.jobId === undefined)

  return {
    start: () => {
      for (const slot of slots) spawn(slot)
    },

    dispatch: (request) => {
      const slot = free()
      if (slot === undefined || slot.port === undefined) return false
      slot.jobId = request.jobId
      slot.port.postMessage(request satisfies JobRequest)
      return true
    },

    /**
     * Cancellation is cooperative first: the worker aborts the job's signal and reports back
     * as it would for any failure. The kill is the backstop — without it, a job that ignores
     * its signal (a tight loop, a blocking native call) would leave the row `cancelled` while
     * the worker kept burning a core, and "cancelling stops the worker" would be a lie.
     */
    cancel: (jobId) => {
      const slot = slots.find((candidate) => candidate.jobId === jobId)
      if (slot?.port === undefined || slot.child === undefined) return false
      slot.port.postMessage({ type: 'cancel', jobId } satisfies JobRequest)
      clearKillTimer(slot)
      const child = slot.child
      slot.killTimer = setTimeout(() => {
        slot.killTimer = undefined
        if (slot.jobId !== jobId) return
        log.warn(`[jobs] ${slot.id} did not stop job ${jobId} in time; killing the worker`)
        child.kill()
      }, cancelGraceMs)
      return true
    },

    livePids: () => {
      const pids = new Set<number>()
      for (const slot of slots) {
        if (slot.pid !== undefined) pids.add(slot.pid)
      }
      return pids
    },

    hasCapacity: () => free() !== undefined,

    slots: () =>
      slots.map((slot) => ({
        id: slot.id,
        pid: slot.pid,
        busy: slot.jobId !== undefined,
        ready: slot.ready,
        retiring: slot.retiring,
      })),

    stop: async () => {
      stopping = true
      for (const slot of slots) {
        clearKillTimer(slot)
        slot.child?.kill()
        slot.child = undefined
        slot.port = undefined
        slot.ready = false
      }
    },
  }
}
