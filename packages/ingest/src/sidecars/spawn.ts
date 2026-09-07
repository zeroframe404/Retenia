import { type ChildProcess, spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { FORWARDED_ENV_KEYS, forwardableEnv } from './env'
import { killTree, type SpawnLike } from './kill-tree'

/**
 * Running a bundled binary as a child process — the one place in the product that calls
 * `child_process` (`docs/spec/07-architecture.md` §7: "`child_process.spawn` with
 * `windowsHide` and kill-tree").
 *
 * Four properties are load-bearing, and each one is a rule the security review checks:
 *
 *  - **Never a shell.** The arguments are an array and reach the OS as an array. There is no
 *    `exec`, no template string, no `shell: true`. Half of what goes into these argv arrays
 *    comes from a file the user imported — a path with a quote or a semicolon in it is
 *    ordinary on Windows — and a shell would turn that into command injection.
 *  - **No window.** `windowsHide` keeps ffmpeg from flashing a console over the app on every
 *    keyframe pass.
 *  - **An environment built, not inherited.** The job worker is forked with `env: {}`
 *    (`apps/desktop/src/main/jobs/pool.ts`) so a provider API key can never reach a parser, so
 *    `process.env` here is *empty* — reading it would hand the child nothing at all. On Linux
 *    that mostly works by accident; on Windows a process with no `SystemRoot` fails to
 *    initialise Winsock and dies before it parses its arguments. So the host values a sidecar
 *    genuinely needs are forwarded explicitly through the job handshake and passed in as
 *    `hostEnv`, and `sidecarEnv` adds the executable's own directory to the library search
 *    path so a CUDA build finds its sibling DLLs and nothing else does.
 *  - **It cannot outlive its job.** Every live child is in `liveChildren`, an abort or a
 *    timeout kill-trees it, and the module exposes `killAllSidecars` so the worker can tear
 *    everything down on its way out.
 *
 * ### What is *not* closed
 *
 * If the job worker is killed outright — `SIGKILL`, or the pool's backstop after a job ignores
 * its cancellation — no exit handler runs and a long ffmpeg pass can be left behind. Node
 * exposes no Windows Job Object and no `PR_SET_PDEATHSIG`, so there is no portable way to tie
 * a child's lifetime to its parent's. In practice the cooperative path wins by a wide margin:
 * the abort handler here fires the moment the signal does, while the pool waits 5 s before it
 * kills anything. The residual case is recorded rather than papered over.
 */

/** stderr lines kept for an error message. Enough for ffmpeg's real complaint, which is
 *  usually the last line, without dragging its banner into the `jobs.error` column. */
const STDERR_TAIL_LINES = 20

/**
 * The environment one sidecar runs with: the forwarded host values, plus a search path
 * containing exactly one directory — the executable's own.
 *
 * That single directory is the point. whisper's CUDA archive ships `whisper-cli.exe` beside
 * `ggml-cuda.dll` and friends, and Windows resolves an unqualified DLL against `PATH`. Giving
 * it the real `PATH` would let an unrelated copy of a CUDA runtime elsewhere on the machine
 * win that lookup; giving it only this directory means the binary loads the libraries it
 * shipped with or none at all.
 */
export function sidecarEnv(
  exeDir: string,
  hostEnv: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...hostEnv }
  if (platform === 'win32') env.PATH = exeDir
  else {
    env.PATH = exeDir
    env.LD_LIBRARY_PATH = exeDir
  }
  return env
}

export interface SidecarRunResult {
  code: number | null
  signal: NodeJS.Signals | null
  /** The last lines of stderr, whatever the outcome. */
  stderrTail: readonly string[]
}

export class SidecarError extends Error {
  constructor(
    message: string,
    readonly tool: string,
    readonly code: number | null,
    readonly stderrTail: readonly string[],
  ) {
    super(message)
    this.name = 'SidecarError'
  }
}

/** Thrown when the run stopped because its `AbortSignal` fired. Distinguished from a failure
 *  so the job reports "cancelled" rather than an error the user never caused. */
export class SidecarCancelledError extends Error {
  constructor(readonly tool: string) {
    super(`${tool} was cancelled`)
    this.name = 'SidecarCancelledError'
  }
}

export class SidecarTimeoutError extends Error {
  constructor(
    readonly tool: string,
    readonly timeoutMs: number,
  ) {
    super(`${tool} did not finish within ${timeoutMs} ms`)
    this.name = 'SidecarTimeoutError'
  }
}

export interface RunSidecarOptions {
  /** Absolute path to the executable, already resolved by `./resolve.ts`. */
  exe: string
  /** A short name for messages (`ffmpeg`, `whisper-cli`) — never a path, since job errors
   *  reach the renderer and `redactPaths` should not have to work for a living. */
  tool: string
  args: readonly string[]
  cwd?: string
  signal?: { readonly aborted: boolean; addEventListener(t: 'abort', l: () => void): void }
  /** A hard ceiling. A transcription of a long lecture is legitimately slow, so callers pass
   *  a budget derived from the media's duration rather than a constant. */
  timeoutMs?: number
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  /** Binary stdout, for `-f rawvideo pipe:1`. Mutually exclusive with `onStdoutLine`. */
  onStdoutChunk?: (chunk: Uint8Array) => void
  /**
   * Host environment values forwarded from main (`forwardableEnv`). The worker cannot read
   * them itself — it was forked with `env: {}` — so a caller that omits this hands the child
   * nothing but its own directory, which is fine on Linux and fatal on Windows.
   */
  hostEnv?: Record<string, string>
  /** Test seam. */
  spawnFn?: SpawnLike
  platform?: NodeJS.Platform
}

/** Every sidecar this process has started and not yet reaped. */
const liveChildren = new Set<ChildProcess>()

/** The pids of every running sidecar — what the cancellation test asserts against. */
export function liveSidecarPids(): readonly number[] {
  return [...liveChildren]
    .map((child) => child.pid)
    .filter((pid): pid is number => pid !== undefined)
}

/**
 * Kill-trees every running sidecar. The job worker calls this from its exit path so a
 * cancelled or shutting-down worker does not leave a transcoder behind.
 */
export async function killAllSidecars(): Promise<void> {
  await Promise.all([...liveChildren].map((child) => killTree(child)))
}

/**
 * Adds a child spawned outside `runSidecar` to the same registry, so `killAllSidecars` reaps
 * it too. `./extract.ts`'s `tar` is the one caller: it runs its own binary through its own
 * spawn (a different environment — the system `tar`, resolved via the real `PATH`, not a
 * bundled sidecar confined to its own directory — so it cannot just call `runSidecar`), but a
 * cancelled or shutting-down worker should not leave it running any more than it should
 * ffmpeg. Returns the matching unregister, to call once the child is reaped — mirroring
 * `runSidecar`'s own `finally`.
 */
export function trackExternalSidecar(child: ChildProcess): () => void {
  liveChildren.add(child)
  return () => liveChildren.delete(child)
}

/**
 * Splits a byte stream into lines, tolerating all three line endings.
 *
 * `\r` alone matters more than it looks: ffmpeg rewrites its progress line in place with a
 * carriage return and no newline, so a splitter that only knows `\n` sees one enormous line
 * that never ends and reports no progress at all until the process exits.
 */
export function createLineSplitter(onLine: (line: string) => void): {
  push(chunk: Uint8Array): void
  flush(): void
} {
  let buffer = ''
  return {
    push(chunk) {
      buffer += Buffer.from(chunk).toString('utf-8')
      const parts = buffer.split(/\r\n|\n|\r/)
      buffer = parts.pop() ?? ''
      for (const part of parts) onLine(part)
    },
    flush() {
      if (buffer.length > 0) {
        onLine(buffer)
        buffer = ''
      }
    },
  }
}

export { FORWARDED_ENV_KEYS, forwardableEnv }

export async function runSidecar(options: RunSidecarOptions): Promise<SidecarRunResult> {
  const {
    exe,
    tool,
    args,
    cwd,
    signal,
    timeoutMs,
    onStdoutLine,
    onStderrLine,
    onStdoutChunk,
    hostEnv,
    spawnFn = spawn,
    platform = process.platform,
  } = options

  if (signal?.aborted === true) throw new SidecarCancelledError(tool)

  const stderrTail: string[] = []
  const child = spawnFn(exe, [...args], {
    cwd,
    env: sidecarEnv(dirname(exe), hostEnv, platform),
    windowsHide: true,
    // POSIX only: makes the child a process-group leader so `killTree` can signal the whole
    // group. On Windows this would only give it a console of its own; `taskkill /T` walks the
    // parent links instead. See `./kill-tree.ts`.
    detached: platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  liveChildren.add(child)

  const stdoutLines = onStdoutLine === undefined ? undefined : createLineSplitter(onStdoutLine)
  const stderrLines = createLineSplitter((line) => {
    stderrTail.push(line)
    if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
    onStderrLine?.(line)
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    if (onStdoutChunk !== undefined) onStdoutChunk(new Uint8Array(chunk))
    stdoutLines?.push(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrLines.push(chunk)
  })

  let cancelled = false
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop = (): void => {
    void killTree(child, { platform })
  }

  if (signal !== undefined) {
    signal.addEventListener('abort', () => {
      cancelled = true
      stop()
    })
  }
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
  }

  try {
    return await new Promise<SidecarRunResult>((resolve, reject) => {
      child.on('error', (error) => {
        // The executable is missing or not executable: a setup problem, not a media problem,
        // and worth saying so plainly rather than as "exited with null".
        reject(new SidecarError(`could not start ${tool}: ${error.message}`, tool, null, []))
      })
      child.on('close', (code, closeSignal) => {
        stdoutLines?.flush()
        stderrLines.flush()
        if (cancelled) {
          reject(new SidecarCancelledError(tool))
          return
        }
        if (timedOut) {
          reject(new SidecarTimeoutError(tool, timeoutMs as number))
          return
        }
        if (code !== 0) {
          const detail = stderrTail.at(-1)
          reject(
            new SidecarError(
              `${tool} exited with code ${code ?? closeSignal}${detail ? `: ${detail}` : ''}`,
              tool,
              code,
              [...stderrTail],
            ),
          )
          return
        }
        resolve({ code, signal: closeSignal, stderrTail: [...stderrTail] })
      })
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    liveChildren.delete(child)
  }
}
