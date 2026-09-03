import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobResponse } from './protocol'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/**
 * Stand-ins for `utilityProcess` and `MessageChannelMain`, so the pool's policy — handshake,
 * dispatch, recycling after N jobs or past an RSS ceiling, the cancel kill-after-grace — is
 * testable without forking real processes. `e2e/jobs.spec.ts` proves the real fork works;
 * this proves the rules around it, which no realistic e2e would ever reach (recycling at the
 * default takes 50 jobs).
 */
class FakeChild extends EventEmitter {
  pid: number | undefined
  killed = false
  readonly posted: unknown[] = []

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  kill(): boolean {
    if (this.killed) return true
    this.killed = true
    // Electron emits `exit` asynchronously; firing it synchronously here would let a test
    // pass that would deadlock in production.
    queueMicrotask(() => this.emit('exit', 0))
    return true
  }

  /** The child comes up and reports its pid, as Electron's `spawn` event does. */
  spawn(pid: number): void {
    this.pid = pid
    this.emit('spawn')
  }

  /** The child dies on its own — a crash, or an OOM kill. */
  die(code = 1): void {
    this.killed = true
    this.emit('exit', code)
  }
}

class FakePort extends EventEmitter {
  readonly posted: unknown[] = []
  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  start(): void {}
  close(): void {}
}

const children: FakeChild[] = []
/** `port1` of each channel — the end the pool keeps and listens on. */
const mainPorts: FakePort[] = []

vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
  },
  MessageChannelMain: class {
    port1: FakePort
    port2 = new FakePort()
    constructor() {
      this.port1 = new FakePort()
      mainPorts.push(this.port1)
    }
  },
}))

const { createJobPool, DEFAULT_MAX_RSS_BYTES, defaultPoolSize } = await import('./pool')
type JobPoolHandlers = import('./pool').JobPoolHandlers

describe('defaultPoolSize', () => {
  it.each([
    [1, 1],
    [2, 1],
    [4, 3],
    [5, 4],
    [8, 4],
    [64, 4],
  ])('with %i cpus uses %i workers', (cpus, expected) => {
    // `min(4, cpus - 1)`: a core is left for main and the renderer, because this is a desktop
    // app whose UI has to stay responsive while it works.
    expect(defaultPoolSize(cpus)).toBe(expected)
  })

  it('never returns zero, however few cpus are reported', () => {
    // `os.cpus()` has been observed to return an empty array inside containers.
    expect(defaultPoolSize(0)).toBe(1)
    expect(defaultPoolSize(-1)).toBe(1)
  })
})

describe('createJobPool', () => {
  let onMessage: JobPoolHandlers['onMessage'] & ReturnType<typeof vi.fn>
  let onWorkerLost: JobPoolHandlers['onWorkerLost'] & ReturnType<typeof vi.fn>
  let onIdle: JobPoolHandlers['onIdle'] & ReturnType<typeof vi.fn>

  beforeEach(() => {
    children.length = 0
    mainPorts.length = 0
    onMessage = vi.fn<JobPoolHandlers['onMessage']>()
    onWorkerLost = vi.fn<JobPoolHandlers['onWorkerLost']>()
    onIdle = vi.fn<JobPoolHandlers['onIdle']>()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makePool = (overrides: Record<string, unknown> = {}) =>
    createJobPool({
      entryPath: '/out/main/job-worker.js',
      readableRoots: ['/userData/blobs'],
      size: 1,
      onMessage,
      onWorkerLost,
      onIdle,
      ...overrides,
    })

  /** A message from the worker on slot `index`, as the pool would receive it. */
  const fromWorker = (index: number, message: JobResponse): void => {
    mainPorts[index]?.emit('message', { data: message })
  }

  /** Fork, hand over the port, and let the worker report ready. */
  function start(pool: ReturnType<typeof makePool>): void {
    pool.start()
    for (const [index, child] of children.entries()) child.spawn(1000 + index)
    for (let index = 0; index < mainPorts.length; index += 1) fromWorker(index, { type: 'ready' })
  }

  const idle = (rssBytes = 1024): JobResponse => ({ type: 'idle', rssBytes })

  it('forks one child per slot and hands each the readable roots', () => {
    const pool = makePool({ size: 2 })
    start(pool)

    expect(children).toHaveLength(2)
    for (const child of children) {
      expect(child.posted[0]).toEqual({ type: 'handshake', readableRoots: ['/userData/blobs'] })
    }
  })

  it('will not dispatch to a worker that has not reported ready', () => {
    const pool = makePool()
    pool.start()
    children[0]?.spawn(1000)

    expect(pool.hasCapacity()).toBe(false)
    expect(
      pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 }),
    ).toBe(false)
  })

  it('dispatches to a ready worker and marks the slot busy', () => {
    const pool = makePool()
    start(pool)

    expect(
      pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 }),
    ).toBe(true)
    expect(pool.slots()[0]).toMatchObject({ busy: true, ready: true })
    expect(pool.hasCapacity()).toBe(false)
    expect(mainPorts[0]?.posted.at(-1)).toMatchObject({ type: 'start', jobId: 'j1' })
  })

  it('tells the runner which job a message belongs to, from its own records', () => {
    const pool = makePool()
    start(pool)
    pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })

    // Even when the worker names a different job, the pool reports the one it dispatched —
    // which is what lets the runner reject a worker speaking about somebody else's job.
    fromWorker(0, { type: 'progress', jobId: 'someone-elses', value: 0.5, message: null })
    expect(onMessage).toHaveBeenLastCalledWith(
      'w0',
      expect.objectContaining({ jobId: 'someone-elses' }),
      'j1',
    )
  })

  it('frees the slot when the worker goes idle', () => {
    const pool = makePool()
    start(pool)
    pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })

    fromWorker(0, idle())
    expect(pool.slots()[0]).toMatchObject({ busy: false })
    expect(pool.hasCapacity()).toBe(true)
  })

  describe('recycling (docs/spec/07-architecture.md §11, "recycle utility processes")', () => {
    /** Runs `count` jobs through slot 0. */
    const run = (pool: ReturnType<typeof makePool>, count: number, rssBytes?: number): void => {
      for (let index = 0; index < count; index += 1) {
        pool.dispatch({
          type: 'start',
          jobId: `j${index}`,
          kind: 'sleep',
          payload: {},
          attempt: 1,
        })
        fromWorker(0, idle(rssBytes))
      }
    }

    it('keeps a worker while it is under both thresholds', () => {
      const pool = makePool({ maxJobsPerWorker: 3 })
      start(pool)
      run(pool, 2)

      expect(mainPorts[0]?.posted).not.toContainEqual({ type: 'shutdown' })
      expect(children[0]?.killed).toBe(false)
    })

    it('retires a worker once it has run its quota', () => {
      const pool = makePool({ maxJobsPerWorker: 3 })
      start(pool)
      run(pool, 3)

      expect(mainPorts[0]?.posted).toContainEqual({ type: 'shutdown' })
      expect(pool.slots()[0]?.retiring).toBe(true)
    })

    it('retires a worker whose memory has grown past the ceiling', () => {
      const pool = makePool({ maxRssBytes: 1_000 })
      start(pool)
      run(pool, 1, 2_000)

      expect(mainPorts[0]?.posted).toContainEqual({ type: 'shutdown' })
    })

    it('kills a worker that ignores the shutdown, then replaces it', async () => {
      const pool = makePool({ maxJobsPerWorker: 1, cancelGraceMs: 5_000 })
      start(pool)
      run(pool, 1)
      expect(children[0]?.killed).toBe(false)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(children[0]?.killed).toBe(true)

      // A replacement is forked, or the pool would shrink to nothing over a long session.
      await vi.advanceTimersByTimeAsync(10)
      expect(children).toHaveLength(2)
    })

    it('does not hand new work to a worker on its way out', () => {
      const pool = makePool({ maxJobsPerWorker: 1 })
      start(pool)
      run(pool, 1)

      expect(pool.hasCapacity()).toBe(false)
      expect(
        pool.dispatch({ type: 'start', jobId: 'next', kind: 'sleep', payload: {}, attempt: 1 }),
      ).toBe(false)
    })
  })

  describe('cancel', () => {
    it('asks the worker to abort before resorting to force', () => {
      const pool = makePool()
      start(pool)
      pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })

      expect(pool.cancel('j1')).toBe(true)
      expect(mainPorts[0]?.posted).toContainEqual({ type: 'cancel', jobId: 'j1' })
      expect(children[0]?.killed).toBe(false)
    })

    it('kills the worker if the job does not stop in time', async () => {
      const pool = makePool({ cancelGraceMs: 5_000 })
      start(pool)
      pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })
      pool.cancel('j1')

      await vi.advanceTimersByTimeAsync(4_999)
      expect(children[0]?.killed).toBe(false)

      // Without this, a job that ignores its signal would leave the row `cancelled` while the
      // worker kept burning a core — and "cancelling stops the worker" would be a lie.
      await vi.advanceTimersByTimeAsync(1)
      expect(children[0]?.killed).toBe(true)
    })

    it('does not kill the worker when the job stops on its own', async () => {
      const pool = makePool({ cancelGraceMs: 5_000 })
      start(pool)
      pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })
      pool.cancel('j1')

      fromWorker(0, idle())
      await vi.advanceTimersByTimeAsync(10_000)
      expect(children[0]?.killed).toBe(false)
    })

    it('reports nothing to cancel for a job no worker holds', () => {
      const pool = makePool()
      start(pool)
      expect(pool.cancel('not-running')).toBe(false)
    })
  })

  describe('a worker that dies on its own', () => {
    it('reports the job it was holding as lost, and forks a replacement', async () => {
      const pool = makePool()
      start(pool)
      pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })

      children[0]?.die(1)
      expect(onWorkerLost).toHaveBeenCalledWith('w0', 'j1', expect.stringContaining('exited'))

      await vi.advanceTimersByTimeAsync(10)
      expect(children).toHaveLength(2)
    })

    it('does not respawn a worker that never became ready — that is a broken build', async () => {
      const pool = makePool()
      pool.start()
      children[0]?.spawn(1000)
      children[0]?.die(1)

      await vi.advanceTimersByTimeAsync(10)
      // Respawning here would spin forever against a missing or unloadable entry point.
      expect(children).toHaveLength(1)
    })
  })

  it('does not report a job lost when the pool is deliberately stopping', async () => {
    const pool = makePool()
    start(pool)
    pool.dispatch({ type: 'start', jobId: 'j1', kind: 'sleep', payload: {}, attempt: 1 })

    await pool.stop()
    await vi.advanceTimersByTimeAsync(10)

    // Whatever was in flight stays `running` and is recovered on the next launch. Failing it
    // here would send it round the retry ladder on the way out, racing the database close.
    expect(onWorkerLost).not.toHaveBeenCalled()
    expect(children).toHaveLength(1)
  })

  it('tracks the pids of live workers, for orphan recovery', () => {
    const pool = makePool({ size: 2 })
    start(pool)
    expect([...pool.livePids()].sort()).toEqual([1000, 1001])
  })
})

describe('recycling thresholds', () => {
  it('uses a memory ceiling well above a normal job', () => {
    // Asserted so a careless edit cannot silently disable recycling by raising it beyond
    // anything a job would ever reach.
    expect(DEFAULT_MAX_RSS_BYTES).toBe(512 * 1024 * 1024)
  })
})
