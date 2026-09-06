import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { exeName } from './platform'

/**
 * Finding a sidecar binary on disk, in the order the app is allowed to trust them.
 *
 * Three tiers, most-trusted first:
 *
 *  1. **`resources/bin`** — packaged with the app. Nothing puts binaries there today (the
 *     decision in `docs/spec/07-architecture.md` §13.4 was to download rather than bundle, to
 *     keep the installer at its 90–120 MB and to keep hundreds of megabytes of third-party
 *     executables out of the code-signing set), but `electron-builder.yml` already allowlists
 *     and `asarUnpack`s the directory, and the "optional GPU package" §11 imagines would ship
 *     exactly this way. Kept first so that a build which *does* bundle wins over a stale
 *     download.
 *  2. **`.sidecars/`** — the development tree, populated by `node tooling/download-sidecars.ts
 *     --install`. Ahead of `userData` so a developer testing a new pinned build sees it
 *     immediately rather than whatever the app downloaded last week.
 *  3. **`<userData>/bin`** — what the shipped app downloads on first use, hash-verified
 *     against the checked-in manifest.
 *
 * Resolution is a pure lookup: it never downloads, never spawns and never throws. "Not found"
 * is an ordinary answer that the caller turns into a download phase of the job the user
 * already started.
 */

export type SidecarSource = 'resources' | 'dev' | 'userData'

export interface SidecarRoots {
  /** `<app>/resources/bin`, already `asar.unpacked`-rewritten by the caller. */
  resources?: string
  /** `<repo>/.sidecars`. */
  dev?: string
  /** `<userData>/bin`. */
  userData?: string
}

export interface ResolvedSidecar {
  /** Absolute path to the executable. */
  path: string
  source: SidecarSource
}

/** Where one tool's files live under a root: `<root>/<tool>/<version>/`. Versioned so a
 *  manifest bump downloads beside the old build rather than over it — a half-replaced
 *  executable is the one failure mode that survives a restart. */
export function sidecarDirectory(root: string, tool: string, version: string): string {
  return join(root, tool, version)
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export interface ResolveOptions {
  tool: string
  version: string
  /** The executable's base name inside the directory, without an extension. */
  binary: string
  roots: SidecarRoots
  platform?: NodeJS.Platform
  /** Test seam; defaults to a real `access` check. */
  exists?: (path: string) => Promise<boolean>
}

export async function resolveSidecar(
  options: ResolveOptions,
): Promise<ResolvedSidecar | undefined> {
  const { tool, version, binary, roots, platform = process.platform, exists = isFile } = options
  const file = exeName(binary, platform)

  const tiers: readonly (readonly [SidecarSource, string | undefined])[] = [
    ['resources', roots.resources],
    ['dev', roots.dev],
    ['userData', roots.userData],
  ]

  for (const [source, root] of tiers) {
    if (root === undefined) continue
    const candidate = join(sidecarDirectory(root, tool, version), file)
    if (await exists(candidate)) return { path: candidate, source }
  }
  return undefined
}
