import { spawn } from 'node:child_process'

/**
 * Killing a sidecar and everything it started.
 *
 * `child.kill()` signals one process. That is not enough here for a reason worth stating: the
 * job that owns an ffmpeg or whisper run is cancellable from the tray, and the acceptance
 * criterion for sub-phase 6.4 is that cancelling it leaves no transcoder running. A signal
 * delivered to the direct child alone can leave a grandchild holding the input file open —
 * and on Windows a stray `ffmpeg.exe` keeps a lock that makes the next run fail to even open
 * its own scratch file.
 *
 * The two platforms need genuinely different mechanisms, not one with a flag:
 *
 *  - **POSIX** has process groups. `spawn` with `detached: true` makes the child a group
 *    leader, and a signal sent to the negated pid reaches the leader and every descendant in
 *    one call. `detached` is safe to use here despite its name — on POSIX a child never dies
 *    with its parent anyway (it is reparented to init), so the flag only *adds* the group we
 *    need to aim at.
 *  - **Windows** has no such grouping, but it does keep the parent/child links, and
 *    `taskkill /T` walks them. So there the child is *not* detached — that would put it in a
 *    new console and is unnecessary — and the tree is torn down by `taskkill /PID n /T /F`.
 *
 * Both paths are "ask, then insist": a signal the process can handle first, so ffmpeg gets the
 * chance to close its output file, then an unconditional kill once the grace has passed.
 * Windows' `taskkill` has no polite mode worth using (`/T` without `/F` only asks windowed
 * processes, and these have no window), so there the grace is spent on `SIGTERM` to the direct
 * child before the tree kill.
 */

/** How long a sidecar has to exit on its own before it is killed outright. */
export const KILL_GRACE_MS = 2_000

/** The `child_process.spawn` surface this module needs; injected in tests. */
export type SpawnLike = typeof spawn

/** What `killTree` needs of a child process. A real `ChildProcess` satisfies it — `pid` is
 *  declared optional rather than `number | undefined` because that is how Node types it, and
 *  the two are not interchangeable under `exactOptionalPropertyTypes`. */
export interface Killable {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  kill(signal?: NodeJS.Signals): boolean
}

export interface KillTreeOptions {
  platform?: NodeJS.Platform
  spawnFn?: SpawnLike
  graceMs?: number
  /** Injected in tests so the grace does not cost real time. */
  delay?: (ms: number) => Promise<void>
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** The argv `taskkill` is invoked with. Split out so a test can assert it without a process. */
export function taskkillArgs(pid: number): readonly string[] {
  return ['/PID', String(pid), '/T', '/F']
}

/**
 * Signals one process group on POSIX. Returns false when the group is already gone, which is
 * the common case on the second (SIGKILL) pass and is not an error.
 */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    // The negation is the whole point: `kill(-pid)` addresses the group, `kill(pid)` the leader.
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

/**
 * Ends `child` and every process it started, and resolves once the attempt is complete.
 *
 * Never rejects. A cancellation path that can throw is a cancellation path that leaks the
 * thing it was supposed to clean up, and every failure mode here — the process already exited,
 * the pid was reused, `taskkill` is missing — is either harmless or unactionable.
 */
export async function killTree(child: Killable, options: KillTreeOptions = {}): Promise<void> {
  const {
    platform = process.platform,
    spawnFn = spawn,
    graceMs = KILL_GRACE_MS,
    delay = sleep,
  } = options

  const { pid } = child
  // No pid means the spawn itself failed; there is nothing to kill and `kill(-undefined)`
  // would throw.
  if (pid === undefined) return
  if (child.exitCode !== null) return

  if (platform === 'win32') {
    child.kill('SIGTERM')
    await delay(graceMs)
    if (child.exitCode !== null) return
    try {
      // Detached and fully ignored: this is a fire-and-forget teardown, and a `taskkill` that
      // outlives the turn holding an inherited stdio pipe open is its own kind of leak.
      const killer = spawnFn('taskkill', taskkillArgs(pid), {
        windowsHide: true,
        stdio: 'ignore',
        detached: true,
      })
      killer.unref()
      killer.on('error', () => {})
    } catch {
      // `taskkill` is part of Windows, but if it cannot be spawned the direct kill below is
      // still better than nothing.
    }
    child.kill('SIGKILL')
    return
  }

  if (!signalGroup(pid, 'SIGTERM')) {
    // The group is gone, or the child was never detached (a test's fake). Fall back to the
    // process itself so this still does something.
    child.kill('SIGTERM')
  }
  await delay(graceMs)
  if (child.exitCode !== null) return
  if (!signalGroup(pid, 'SIGKILL')) child.kill('SIGKILL')
}
