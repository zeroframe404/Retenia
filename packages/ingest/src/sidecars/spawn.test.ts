import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  createLineSplitter,
  forwardableEnv,
  liveSidecarPids,
  runSidecar,
  SidecarCancelledError,
  SidecarError,
  SidecarTimeoutError,
  sidecarEnv,
} from './spawn'

/**
 * The cancellation guarantee, proved rather than asserted.
 *
 * Sub-phase 6.4's acceptance criterion is that "cancelling the job kills ffmpeg/whisper
 * processes (verify via process list)". These tests make that claim about real processes — but
 * with `process.execPath` standing in for ffmpeg, so they run everywhere, in CI, with no
 * sidecar installed. What is under test is the kill, and the kill does not care which
 * executable it is aimed at.
 *
 * "Verify via process list" is spelled `process.kill(pid, 0)`: signal 0 performs the
 * permission and existence check and delivers nothing, so it throws `ESRCH` exactly when the
 * pid is gone. That is the same probe `nodeProcessLiveness` uses for orphan job recovery, and
 * it is portable in a way that parsing `tasklist` or `ps` output is not.
 */

/** Waits for a pid to disappear, so the assertions do not race the OS reaping it. */
async function waitForExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** A node script that runs until it is killed. */
const SLEEP_FOREVER = 'setInterval(() => {}, 1000)'

describe('runSidecar', () => {
  it('reports stdout and stderr line by line and resolves on a clean exit', async () => {
    const out: string[] = []
    const err: string[] = []
    const result = await runSidecar({
      exe: process.execPath,
      tool: 'node',
      args: ['-e', 'console.log("one"); console.log("two"); console.error("warn")'],
      onStdoutLine: (line) => out.push(line),
      onStderrLine: (line) => err.push(line),
    })

    expect(result.code).toBe(0)
    expect(out).toEqual(['one', 'two'])
    expect(err).toEqual(['warn'])
  })

  it('rejects with the last stderr line when the tool exits non-zero', async () => {
    const failure = runSidecar({
      exe: process.execPath,
      tool: 'ffmpeg',
      args: ['-e', 'console.error("Invalid data found when processing input"); process.exit(1)'],
    })

    await expect(failure).rejects.toBeInstanceOf(SidecarError)
    // The message is what lands in `jobs.error` and reaches the renderer, so it has to name
    // the tool and say what actually went wrong.
    await expect(failure).rejects.toThrow(/ffmpeg exited with code 1: Invalid data found/)
  })

  it('names the tool when the executable cannot be started at all', async () => {
    await expect(
      runSidecar({ exe: 'definitely-not-a-real-binary', tool: 'ffmpeg', args: [] }),
    ).rejects.toThrow(/could not start ffmpeg/)
  })

  it('kills the child when its signal aborts, and the process really is gone', async () => {
    const controller = new AbortController()
    let pid: number | undefined

    const run = runSidecar({
      exe: process.execPath,
      tool: 'whisper-cli',
      args: ['-e', `console.log(process.pid); ${SLEEP_FOREVER}`],
      signal: controller.signal,
      onStdoutLine: (line) => {
        pid = Number.parseInt(line, 10)
      },
    })

    // Wait until the child has told us its pid, so the cancel lands on a running process
    // rather than on one that has not started yet.
    for (let i = 0; i < 200 && pid === undefined; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(pid).toBeTypeOf('number')

    controller.abort()
    await expect(run).rejects.toBeInstanceOf(SidecarCancelledError)
    expect(await waitForExit(pid as number)).toBe(true)
  })

  it('kills grandchildren too, not just the process it spawned', async () => {
    // This is the assertion that actually proves *kill-tree* rather than kill. ffmpeg does not
    // fork, but a CUDA whisper build's launcher can, and on Windows the difference is exactly
    // whether `taskkill /T` was used. Without the tree walk the inner pid survives here.
    const controller = new AbortController()
    const pids: number[] = []

    const script = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', '${SLEEP_FOREVER}'], { stdio: 'ignore' })
      console.log(process.pid)
      console.log(child.pid)
      ${SLEEP_FOREVER}
    `

    const run = runSidecar({
      exe: process.execPath,
      tool: 'whisper-cli',
      args: ['-e', script],
      signal: controller.signal,
      onStdoutLine: (line) => {
        const value = Number.parseInt(line, 10)
        if (Number.isFinite(value)) pids.push(value)
      },
    })

    for (let i = 0; i < 200 && pids.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(pids).toHaveLength(2)

    controller.abort()
    await expect(run).rejects.toBeInstanceOf(SidecarCancelledError)

    for (const pid of pids) {
      expect(await waitForExit(pid)).toBe(true)
    }
  })

  it('kills a child that outstays its timeout', async () => {
    let pid: number | undefined
    const run = runSidecar({
      exe: process.execPath,
      tool: 'ffmpeg',
      args: ['-e', `console.log(process.pid); ${SLEEP_FOREVER}`],
      timeoutMs: 250,
      onStdoutLine: (line) => {
        pid = Number.parseInt(line, 10)
      },
    })

    await expect(run).rejects.toBeInstanceOf(SidecarTimeoutError)
    if (pid !== undefined) expect(await waitForExit(pid)).toBe(true)
  })

  it('leaves no process registered once a run settles', async () => {
    await runSidecar({ exe: process.execPath, tool: 'node', args: ['-e', '0'] })
    expect(liveSidecarPids()).toEqual([])
  })

  it('passes arguments as an array, so a path with a shell metacharacter stays one argument', async () => {
    // The injection guard. `runSidecar` never uses a shell, and the proof is that an argument
    // full of characters a shell would act on arrives at the child intact.
    const hostile = 'a b"; rm -rf /; echo $(whoami) & | c'
    const out: string[] = []
    await runSidecar({
      exe: process.execPath,
      tool: 'ffmpeg',
      args: ['-e', 'console.log(process.argv[1])', hostile],
      onStdoutLine: (line) => out.push(line),
    })
    expect(out).toEqual([hostile])
  })
})

describe('sidecarEnv', () => {
  it('gives the child only its own directory on the search path', () => {
    const env = sidecarEnv('/opt/retenia/bin/whisper', { SystemRoot: 'C:\\Windows' }, 'win32')
    expect(env.PATH).toBe('/opt/retenia/bin/whisper')
    expect(env.SystemRoot).toBe('C:\\Windows')
  })

  it('also sets LD_LIBRARY_PATH off win32, where that is how siblings are found', () => {
    const env = sidecarEnv('/opt/bin', {}, 'linux')
    expect(env.LD_LIBRARY_PATH).toBe('/opt/bin')
  })

  it('carries nothing the caller did not forward', () => {
    const env = sidecarEnv('/opt/bin', {}, 'linux')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(Object.keys(env).sort()).toEqual(['LD_LIBRARY_PATH', 'PATH'])
  })
})

describe('forwardableEnv', () => {
  it('picks only the keys a sidecar needs, and drops empty ones', () => {
    expect(
      forwardableEnv({
        SystemRoot: 'C:\\Windows',
        TEMP: '',
        TMPDIR: '/tmp',
        ANTHROPIC_API_KEY: 'sk-do-not-forward',
      }),
    ).toEqual({ SystemRoot: 'C:\\Windows', TMPDIR: '/tmp' })
  })
})

describe('createLineSplitter', () => {
  it('splits on all three line endings', () => {
    const lines: string[] = []
    const splitter = createLineSplitter((line) => lines.push(line))
    splitter.push(Buffer.from('a\nb\r\nc\rd'))
    splitter.flush()
    expect(lines).toEqual(['a', 'b', 'c', 'd'])
  })

  it('joins a line split across two chunks', () => {
    const lines: string[] = []
    const splitter = createLineSplitter((line) => lines.push(line))
    splitter.push(Buffer.from('out_time_'))
    splitter.push(Buffer.from('us=1234\n'))
    expect(lines).toEqual(['out_time_us=1234'])
  })

  it('emits a bare carriage return as a line, which is how ffmpeg writes progress', () => {
    // ffmpeg rewrites its status line in place with `\r` and no newline. A splitter that only
    // knows `\n` sees one line that never ends and reports no progress until the process exits.
    const lines: string[] = []
    const splitter = createLineSplitter((line) => lines.push(line))
    splitter.push(Buffer.from('frame=1\rframe=2\r'))
    expect(lines).toEqual(['frame=1', 'frame=2'])
  })
})

describe('the test harness itself', () => {
  it('uses a liveness probe that really does detect a dead pid', async () => {
    // Guards the guard: if `process.kill(pid, 0)` silently succeeded for dead pids, every
    // cancellation assertion above would pass vacuously.
    const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' })
    const pid = child.pid as number
    await new Promise((resolve) => child.on('close', resolve))
    expect(await waitForExit(pid)).toBe(true)
    expect(() => process.kill(pid, 0)).toThrow()
  })
})
