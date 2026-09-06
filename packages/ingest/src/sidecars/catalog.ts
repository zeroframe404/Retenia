import manifest from './manifest.json' with { type: 'json' }
import { SIDECAR_PLATFORMS, type SidecarPlatform } from './platform'

/**
 * The pinned third-party binaries the app may download and run.
 *
 * Same trust model as `../models/catalog.ts`, for the same reason: the manifest is checked in,
 * every artifact carries a byte count and a SHA-256, and nothing whose hash is not listed here
 * is ever extracted or executed. The difference is what is being pinned. A model is one file
 * from a content-addressed host; a sidecar is a **release archive** — platform-specific,
 * compressed, and holding a dozen files of which we want two.
 *
 * That difference is why this is a sibling of the model catalog rather than a `ModelKind`.
 * `ModelSpec` is shaped around a Hugging Face repo and a transformers.js `dtype`, and a
 * `ffmpeg.exe` has neither; conversely nothing about a model needs an archive member glob or
 * an executable bit. What the two genuinely share — stream the bytes, hash them on the way
 * past, only name the file once the digest matches — is shared as a function, not as a type.
 *
 * ### Why the version is a dated tag
 *
 * BtbN publishes ffmpeg under a moving `latest` tag whose assets are **rebuilt daily under
 * the same names**, so a hash pinned against it is wrong within a day. The pin is therefore a
 * dated `autobuild-…` tag, whose asset names carry the upstream commit
 * (`ffmpeg-N-126435-gf93cd72dde-win64-lgpl.zip`) and never change.
 *
 * ### macOS
 *
 * Deliberately absent. BtbN publishes no macOS build and whisper.cpp ships an xcframework
 * rather than a CLI, so there is nothing to pin. `resolveSidecar` answers `undefined` there
 * and the Library reports that local transcription is unavailable — the honest outcome for a
 * platform the plan does not reach until sub-phase 14.5.
 */

export type SidecarToolId = 'ffmpeg' | 'whisper'
/** `cpu` everywhere; `cuda12` only where an NVIDIA build is published. */
export type SidecarVariant = 'cpu' | 'cuda12'
export type ArchiveKind = 'zip' | 'tar.gz' | 'tar.xz'

export interface SidecarArtifact {
  url: string
  archive: ArchiveKind
  bytes: number
  /** Of the **archive**, as downloaded. The extracted files are re-recorded in the receipt. */
  sha256: string
  /**
   * Which archive members to keep, as globs against the archive's own paths.
   *
   * Globs rather than exact paths because the top directory of an ffmpeg archive is named
   * after the build (`ffmpeg-N-126435-gf93cd72dde-win64-lgpl/`), so an exact path would have
   * to be regenerated on every version bump and would be one more thing to get wrong.
   *
   * The list is not only the executables: whisper's archives put `whisper-cli` beside the
   * `ggml*` shared libraries it loads at run time, and extracting the binary without them
   * produces a file that exists and cannot start.
   */
  members: string[]
}

export interface SidecarTool {
  id: SidecarToolId
  /** The upstream release tag. Also the directory name on disk, so two pinned versions can
   *  sit side by side and a bump never half-overwrites a running binary. */
  version: string
  license: string
  /** Where the sources are, which is the LGPL notice's other half. */
  sourceUrl: string
  /** Executable base names, without a platform extension. */
  binaries: string[]
  variants: Partial<Record<SidecarVariant, Partial<Record<SidecarPlatform, SidecarArtifact>>>>
}

interface RawManifest {
  tools: Record<string, Omit<SidecarTool, 'id'>>
}

const TOOLS: Readonly<Record<SidecarToolId, SidecarTool>> = Object.freeze(
  Object.fromEntries(
    Object.entries((manifest as unknown as RawManifest).tools).map(([id, tool]) => [
      id,
      { ...tool, id: id as SidecarToolId },
    ]),
  ) as Record<SidecarToolId, SidecarTool>,
)

export function listSidecarTools(): readonly SidecarTool[] {
  return Object.values(TOOLS)
}

export function findSidecarTool(id: string): SidecarTool | undefined {
  return TOOLS[id as SidecarToolId]
}

export function requireSidecarTool(id: SidecarToolId): SidecarTool {
  const tool = TOOLS[id]
  if (tool === undefined) throw new Error(`No sidecar "${id}" in the manifest`)
  return tool
}

/**
 * The artifact for one tool on one machine, or `undefined` when none is published.
 *
 * A missing CUDA variant falls back to `cpu` rather than answering nothing: the caller asked
 * for the fastest build available, and "no GPU build for this platform" is a reason to
 * transcribe on the CPU, not a reason to refuse the import.
 */
export function selectArtifact(
  tool: SidecarTool,
  platform: SidecarPlatform | undefined,
  variant: SidecarVariant = 'cpu',
): { artifact: SidecarArtifact; variant: SidecarVariant } | undefined {
  if (platform === undefined) return undefined
  const wanted = tool.variants[variant]?.[platform]
  if (wanted !== undefined) return { artifact: wanted, variant }
  if (variant === 'cpu') return undefined
  const cpu = tool.variants.cpu?.[platform]
  return cpu === undefined ? undefined : { artifact: cpu, variant: 'cpu' }
}

/** Every (tool, variant, platform) triple the manifest publishes — what the catalog test
 *  walks to assert the shape of, and what `tooling/download-sidecars.ts` iterates. */
export function listArtifacts(): {
  tool: SidecarTool
  variant: SidecarVariant
  platform: SidecarPlatform
  artifact: SidecarArtifact
}[] {
  const rows: ReturnType<typeof listArtifacts> = []
  for (const tool of listSidecarTools()) {
    for (const [variant, byPlatform] of Object.entries(tool.variants)) {
      for (const [platform, artifact] of Object.entries(byPlatform ?? {})) {
        if (!(SIDECAR_PLATFORMS as readonly string[]).includes(platform)) continue
        rows.push({
          tool,
          variant: variant as SidecarVariant,
          platform: platform as SidecarPlatform,
          artifact: artifact as SidecarArtifact,
        })
      }
    }
  }
  return rows
}
