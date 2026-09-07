import { spawn } from 'node:child_process'
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { unzipSync } from 'fflate'
import type { ArchiveKind } from './catalog'
import { killTree } from './kill-tree'
import { trackExternalSidecar } from './spawn'

/**
 * Getting the two files we want out of a release archive.
 *
 * Two paths, chosen by what each platform can be relied on to have rather than by taste:
 *
 *  - **zip** is unpacked in-process with `fflate`, which the package already depends on (the
 *    EPUB and PPTX parsers use it). Every Windows artifact is a zip, and Windows is the one
 *    platform where shelling out to an archiver is a gamble.
 *  - **tar.gz / tar.xz** are handed to the system `tar`. Only the Linux artifacts use them,
 *    and `tar` on Linux is not a dependency in any meaningful sense. Decompressing xz in
 *    JavaScript would mean adding an LZMA implementation to ship one binary on one platform.
 *
 * Nothing here trusts the archive's own paths. A member is written to `<dest>/<basename>` —
 * flattened deliberately, since what we want is `ffmpeg` next to `ffprobe`, not a copy of the
 * upstream directory layout — and any member whose name escapes the destination is refused
 * outright. A release asset with a verified hash is the artifact upstream published; that says
 * nothing about whether the artifact contains a `..`.
 */

/** A very small glob: `*` matches within a path segment, `**` across segments. */
export function matchesGlob(pattern: string, path: string): boolean {
  const escaped = pattern
    .split('')
    .map((char) => ('\\^$.|?+()[]{}'.includes(char) ? `\\${char}` : char))
    .join('')
  const expression = escaped.replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*')
  return new RegExp(`^${expression}$`).test(path)
}

/** The safe, flattened name for an archive member, or `undefined` to refuse it. */
export function safeMemberName(name: string): string | undefined {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.length === 0 || normalized.endsWith('/')) return undefined
  // A control byte in a member name is an attack, not a filename: a NUL in particular can
  // truncate the path a C-level API sees, so the name that is validated and the name the
  // filesystem acts on stop being the same string. Compared by code point rather than by a
  // regex, because a literal control character in a source file is its own hazard.
  for (let i = 0; i < normalized.length; i += 1) {
    if ((normalized.codePointAt(i) ?? 0) < 0x20) return undefined
  }
  const base = posix.basename(normalized)
  if (base === '' || base === '.' || base === '..') return undefined
  return base
}

/** How long `tar` gets before it is killed outright. Generous on purpose: this only ever
 *  extracts an archive that already downloaded and already passed its SHA-256 check, so a run
 *  still going after two minutes is wedged, not merely slow. */
const TAR_TIMEOUT_MS = 2 * 60_000

/** Bounds the accumulated stderr, so a pathological (or malicious) archive that makes `tar`
 *  write without end cannot grow this string without limit — only the tail ever reaches the
 *  error message anyway. */
const STDERR_TAIL_BYTES = 4_000

interface RunTarOptions {
  signal?: { readonly aborted: boolean; addEventListener(t: 'abort', l: () => void): void }
}

function runTar(args: readonly string[], options: RunTarOptions = {}): Promise<void> {
  const { signal } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('tar was cancelled'))
      return
    }

    const child = spawn('tar', [...args], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    // `tar` runs the system binary, not one of our own resolved sidecars — it cannot go
    // through `runSidecar` (`sidecarEnv` would confine `PATH` to `dirname('tar')`, i.e. `.`,
    // and `tar` would stop resolving at all) — but a cancelled or shutting-down worker should
    // not leave it running any more than it should ffmpeg, so it joins the same registry by
    // hand.
    const untrack = trackExternalSidecar(child)

    let stderr = ''
    let cancelled = false
    let timedOut = false

    const stop = (): void => {
      void killTree(child)
    }

    signal?.addEventListener('abort', () => {
      cancelled = true
      stop()
    })
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, TAR_TIMEOUT_MS)

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf-8')).slice(-STDERR_TAIL_BYTES)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      untrack()
      reject(new Error(`could not run tar: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      untrack()
      if (cancelled) {
        reject(new Error('tar was cancelled'))
        return
      }
      if (timedOut) {
        reject(new Error(`tar did not finish within ${TAR_TIMEOUT_MS} ms`))
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`tar exited with ${code}: ${stderr.trim().slice(-300)}`))
    })
  })
}

export interface ExtractOptions {
  archivePath: string
  kind: ArchiveKind
  destination: string
  /** Globs against the archive's own member paths. */
  members: readonly string[]
  platform?: NodeJS.Platform
  /** Only consulted on the `tar` path — `extractZip` runs in-process and has nothing to
   *  cancel. Cancelling mid-extraction still leaves whatever `tar` had already written. */
  signal?: { readonly aborted: boolean; addEventListener(t: 'abort', l: () => void): void }
}

/** The files written, by their flattened base name. */
export async function extractMembers(options: ExtractOptions): Promise<string[]> {
  const { archivePath, kind, destination, members, platform = process.platform, signal } = options
  await mkdir(destination, { recursive: true })

  const written =
    kind === 'zip'
      ? await extractZip(archivePath, destination, members)
      : await extractTar(archivePath, kind, destination, members, signal)

  // The executable bit does not survive a zip, and a tar's is not worth trusting either.
  if (platform !== 'win32') {
    for (const name of written) {
      await chmod(join(destination, name), 0o755).catch(() => undefined)
    }
  }
  return written
}

async function extractZip(
  archivePath: string,
  destination: string,
  members: readonly string[],
): Promise<string[]> {
  const bytes = new Uint8Array(await readFile(archivePath))
  const entries = unzipSync(bytes, {
    filter: (file) => members.some((pattern) => matchesGlob(pattern, file.name)),
  })

  const written: string[] = []
  for (const [name, content] of Object.entries(entries)) {
    const safe = safeMemberName(name)
    if (safe === undefined) continue
    await writeFile(join(destination, safe), content)
    written.push(safe)
  }
  return written
}

async function extractTar(
  archivePath: string,
  kind: ArchiveKind,
  destination: string,
  members: readonly string[],
  signal?: RunTarOptions['signal'],
): Promise<string[]> {
  const before = new Set(await readdir(destination).catch(() => []))
  // `--strip-components` cannot flatten a variable depth, and the archives differ
  // (`*/bin/ffmpeg` is two deep, `*/whisper-cli` one), so `--transform` flattens every member
  // to its base name instead. `--wildcards --no-anchored` makes the member patterns globs.
  const flag = kind === 'tar.xz' ? '-J' : '-z'
  await runTar(
    [
      '-x',
      flag,
      '-f',
      archivePath,
      '-C',
      destination,
      '--wildcards',
      '--no-anchored',
      '--transform',
      's#.*/##',
      ...members,
    ],
    { signal },
  )
  // What tar actually produced, rather than what the globs promised: `--transform` renames
  // after matching, so the only honest way to know the written names is to look.
  return (await readdir(destination)).filter((name) => !before.has(name))
}

/** The base name a member glob will be written as, for a manifest sanity check. */
export function flattenedName(pattern: string): string {
  return basename(pattern.replace(/\\/g, '/'))
}
