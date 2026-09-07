import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KILL_GRACE_MS, type Killable, killTree, type SpawnLike, taskkillArgs } from './kill-tree'

/**
 * The cancellation guarantee of sub-phase 6.4 — "cancelling the job kills ffmpeg/whisper
 * processes" (`docs/spec/07-architecture.md` §7) — asserted as a *sequence of system calls*
 * rather than against real processes.
 *
 * `spawn.test.ts` already proves the end result on this host: it starts a real child, a real
 * grandchild, cancels, and watches both pids disappear. What that suite cannot show is the
 * Windows half, which is a different mechanism and not a flag — `taskkill /T` walking the
 * parent links instead of a signal aimed at a process group — nor the ordering the polite
 * pass depends on, since ffmpeg only gets to close its output file if the `SIGTERM` really
 * does precede the grace. Both are observable only from the calls `killTree` makes, so both
 * platforms are driven here through injected `spawnFn` and `delay` seams and a stubbed
 * `process.kill`, and every act lands in one ordered log.
 *
 * `process.kill` is stubbed rather than merely watched because the POSIX path calls it with a
 * *negated* pid: an unstubbed `kill(-4242, 'SIGKILL')` from a test run would be a signal to
 * whatever process group happens to be numbered 4242 on the machine running the suite.
 */

/** Every act `killTree` performs, in order, as a readable line. */
let events: string[] = []
/** Makes the `process.kill` stub throw, which is how "the group is already gone" looks. */
let groupIsGone = false

const realProcessKill = process.kill

const fakeProcessKill = ((pid: number, signal?: string | number): true => {
  events.push(`process.kill(${pid}, ${String(signal)})`)
  if (groupIsGone) throw new Error('kill ESRCH')
  return true
}) as typeof process.kill

beforeEach(() => {
  events = []
  groupIsGone = false
  process.kill = fakeProcessKill
})

afterEach(() => {
  process.kill = realProcessKill
})

interface FakeChild extends Killable {
  pid?: number | undefined
  exitCode: number | null
}

/** `pid` is always explicit: a default parameter would swallow the `undefined` that the
 *  no-pid case is entirely about. */
function fakeChild(pid: number | undefined): FakeChild {
  return {
    pid,
    exitCode: null,
    kill(signal = 'SIGTERM') {
      events.push(`child.kill(${signal})`)
      return true
    },
  }
}

interface SpawnCall {
  command: string
  args: readonly string[]
  options: Record<string, unknown>
}

/** A stand-in for `child_process.spawn` that resolves `killTree`'s own await on `taskkill` by
 *  firing `'exit'` as soon as a listener is registered for it — `killTree` is awaited, not
 *  fired-and-forgotten, so a fake that never calls back would hang the test. `onExit`, when
 *  given, runs first, so a test can simulate the child dying as a side effect of `taskkill`
 *  actually reaping the tree. */
function recordingSpawn(calls: SpawnCall[], onExit?: () => void): SpawnLike {
  const fake = (command: string, args: readonly string[], options: Record<string, unknown>) => {
    events.push(`spawn ${command}`)
    calls.push({ command, args: [...args], options })
    return {
      on: (event: string, listener: () => void) => {
        if (event === 'exit') {
          onExit?.()
          listener()
        }
      },
    }
  }
  return fake as unknown as SpawnLike
}

const unspawnable = (() => {
  throw new Error('taskkill is not on PATH')
}) as unknown as SpawnLike

/** Stands in for the grace without spending it. */
function fakeDelay(onWait?: () => void): (ms: number) => Promise<void> {
  return (ms) => {
    events.push(`grace ${ms}`)
    onWait?.()
    return Promise.resolve()
  }
}

describe('killTree on Windows', () => {
  it('tears down the whole tree via taskkill first, then kills the child directly as a backstop', async () => {
    const calls: SpawnCall[] = []
    await killTree(fakeChild(4242), {
      platform: 'win32',
      spawnFn: recordingSpawn(calls),
      delay: fakeDelay(),
    })

    // `taskkill /T /F` runs — and is awaited — before anything touches the direct child.
    // Reversing this order is the exact bug it fixes: `child.kill()` on Windows terminates
    // unconditionally regardless of signal, so a direct kill "first" would leave nothing for
    // `taskkill /T`'s parent/child walk to find the descendants through.
    expect(events).toEqual(['spawn taskkill', 'child.kill(SIGKILL)'])
  })

  it('never spends a grace period — there is no polite phase on this platform', async () => {
    await killTree(fakeChild(4242), {
      platform: 'win32',
      spawnFn: recordingSpawn([]),
      delay: fakeDelay(),
    })

    expect(events).not.toContain(`grace ${KILL_GRACE_MS}`)
    expect(events.some((event) => event.startsWith('grace'))).toBe(false)
  })

  it('gives taskkill the pid, the tree flag and the force flag, and nothing else', async () => {
    const calls: SpawnCall[] = []
    await killTree(fakeChild(7331), {
      platform: 'win32',
      spawnFn: recordingSpawn(calls),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual(['/PID', '7331', '/T', '/F'])
    expect(taskkillArgs(7331)).toEqual(['/PID', '7331', '/T', '/F'])
  })

  it('starts taskkill hidden and with no inherited pipes', async () => {
    // A console window flashing over the app on every cancel is the visible failure.
    const calls: SpawnCall[] = []
    await killTree(fakeChild(4242), {
      platform: 'win32',
      spawnFn: recordingSpawn(calls),
    })

    expect(calls[0]?.options).toMatchObject({
      windowsHide: true,
      stdio: 'ignore',
    })
  })

  it('does not insist on a child that taskkill already reaped', async () => {
    const calls: SpawnCall[] = []
    const child = fakeChild(4242)
    await killTree(child, {
      platform: 'win32',
      spawnFn: recordingSpawn(calls, () => {
        child.exitCode = 0
      }),
    })

    expect(events).toEqual(['spawn taskkill'])
  })

  it('still kills the child directly when taskkill cannot be spawned', async () => {
    await killTree(fakeChild(4242), {
      platform: 'win32',
      spawnFn: unspawnable,
    })

    expect(events).toEqual(['child.kill(SIGKILL)'])
  })
})

describe('killTree on POSIX', () => {
  it('signals the process group rather than the leader, politely and then not', async () => {
    // The negation is the entire mechanism: `kill(-pid)` reaches every descendant of a child
    // spawned `detached`, which is what a grandchild holding the input file open requires.
    await killTree(fakeChild(4242), { platform: 'linux', delay: fakeDelay() })

    expect(events).toEqual([
      'process.kill(-4242, SIGTERM)',
      `grace ${KILL_GRACE_MS}`,
      'process.kill(-4242, SIGKILL)',
    ])
  })

  it('falls back to the child itself when there is no group to signal', async () => {
    groupIsGone = true
    await killTree(fakeChild(4242), { platform: 'linux', delay: fakeDelay() })

    expect(events).toEqual([
      'process.kill(-4242, SIGTERM)',
      'child.kill(SIGTERM)',
      `grace ${KILL_GRACE_MS}`,
      'process.kill(-4242, SIGKILL)',
      'child.kill(SIGKILL)',
    ])
  })

  it('does not insist on a child that exited during the grace', async () => {
    const child = fakeChild(4242)
    await killTree(child, {
      platform: 'linux',
      delay: fakeDelay(() => {
        child.exitCode = 0
      }),
    })

    expect(events).toEqual(['process.kill(-4242, SIGTERM)', `grace ${KILL_GRACE_MS}`])
  })

  it('waits the documented grace, or a shorter one the caller asked for', async () => {
    await killTree(fakeChild(4242), { platform: 'linux', delay: fakeDelay(), graceMs: 25 })
    expect(events).toContain('grace 25')
    expect(events).not.toContain(`grace ${KILL_GRACE_MS}`)
  })
})

describe('killTree, on any platform', () => {
  it('does nothing at all for a child that never got a pid', async () => {
    // A failed spawn leaves `pid` undefined, and `kill(-undefined)` throws — so the guard is
    // load-bearing on the one path that runs when something has already gone wrong.
    const calls: SpawnCall[] = []
    await killTree(fakeChild(undefined), {
      platform: 'linux',
      spawnFn: recordingSpawn(calls),
      delay: fakeDelay(),
    })
    await killTree(fakeChild(undefined), {
      platform: 'win32',
      spawnFn: recordingSpawn(calls),
      delay: fakeDelay(),
    })

    expect(events).toEqual([])
    expect(calls).toEqual([])
  })

  it('leaves a child that has already exited untouched', async () => {
    const child = fakeChild(4242)
    child.exitCode = 1
    await killTree(child, { platform: 'linux', delay: fakeDelay() })

    expect(events).toEqual([])
  })

  it('never rejects, whatever the teardown runs into', async () => {
    // A cancellation path that throws is a cancellation path that leaks the transcoder it was
    // supposed to clean up, so both platforms are driven through their worst case.
    groupIsGone = true
    await expect(
      killTree(fakeChild(4242), { platform: 'linux', delay: fakeDelay() }),
    ).resolves.toBeUndefined()
    await expect(
      killTree(fakeChild(4242), { platform: 'win32', spawnFn: unspawnable, delay: fakeDelay() }),
    ).resolves.toBeUndefined()
  })
})
