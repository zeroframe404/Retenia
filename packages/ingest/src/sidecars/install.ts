import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadToFile, type FetchLike } from '../net/fetch-to-file'
import type { SidecarArtifact, SidecarTool, SidecarVariant } from './catalog'
import { extractMembers } from './extract'
import { exeName, type SidecarPlatform } from './platform'
import { sidecarDirectory } from './resolve'

/**
 * Putting a pinned sidecar on disk (`docs/spec/07-architecture.md` §11: "sidecars downloaded
 * on demand").
 *
 * The shape mirrors `../models/download.ts` deliberately, because the two are the same
 * promise made about different artifacts: nothing runs that the checked-in manifest did not
 * vouch for. The transfer itself is the shared primitive; what is added here is an
 * extraction step and a receipt, because a binary arrives inside an archive and a model does
 * not.
 *
 * The archive is downloaded to the install directory and **deleted once its members are
 * out**. Keeping it would double the disk cost of the CUDA build (670 MB of archive beside
 * 700 MB of extracted DLLs) to save a download nobody repeats.
 */

/** Written once every member is extracted. Its absence is what "not installed" means. */
const RECEIPT = '.retenia-sidecar.json'

export interface SidecarReceipt {
  version: string
  variant: SidecarVariant
  platform: SidecarPlatform
  /** The archive's digest, as verified. */
  sha256: string
  /** Files extracted, by name. */
  files: string[]
  installedAt: string
}

export interface InstallProgress {
  /** 0–1 over this artifact's bytes. Extraction is fast enough not to be reported. */
  fraction: number
  bytesDone: number
  bytesTotal: number
  tool: string
}

export class SidecarInstallError extends Error {
  constructor(
    message: string,
    readonly tool: string,
  ) {
    super(message)
    this.name = 'SidecarInstallError'
  }
}

export async function readReceipt(directory: string): Promise<SidecarReceipt | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, RECEIPT), 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const receipt = parsed as Partial<SidecarReceipt>
    if (typeof receipt.version !== 'string' || !Array.isArray(receipt.files)) return undefined
    return receipt as SidecarReceipt
  } catch {
    return undefined
  }
}

/**
 * Whether this tool is already installed and intact.
 *
 * Cheap on purpose — a receipt read plus one `stat` per expected executable. This runs at the
 * head of every media job, and re-hashing 148 MB of ffmpeg to answer "yes" would be a
 * noticeable pause before every import. The download itself is what verifies; this only
 * checks that what the download left behind is still there.
 */
export async function isInstalled(
  directory: string,
  tool: SidecarTool,
  platform: NodeJS.Platform,
): Promise<boolean> {
  const receipt = await readReceipt(directory)
  if (receipt?.version !== tool.version) return false
  for (const binary of tool.binaries) {
    try {
      const info = await stat(join(directory, exeName(binary, platform)))
      if (!info.isFile() || info.size === 0) return false
    } catch {
      return false
    }
  }
  return true
}

export interface InstallOptions {
  tool: SidecarTool
  artifact: SidecarArtifact
  variant: SidecarVariant
  platform: SidecarPlatform
  /** `<userData>/bin`, or `.sidecars` for the development install. */
  root: string
  fetch?: FetchLike
  signal?: AbortSignal
  onProgress?: (progress: InstallProgress) => void
  nodePlatform?: NodeJS.Platform
}

export interface InstallResult {
  directory: string
  files: string[]
  /** Zero when it was already installed. */
  bytesDownloaded: number
}

/** Downloads, verifies, extracts and records one sidecar. A no-op when already installed. */
export async function installSidecar(options: InstallOptions): Promise<InstallResult> {
  const {
    tool,
    artifact,
    variant,
    platform,
    root,
    fetch,
    signal,
    onProgress,
    nodePlatform = process.platform,
  } = options

  const directory = sidecarDirectory(root, tool.id, tool.version)

  if (await isInstalled(directory, tool, nodePlatform)) {
    const receipt = await readReceipt(directory)
    onProgress?.({ fraction: 1, bytesDone: 0, bytesTotal: 0, tool: tool.id })
    return { directory, files: receipt?.files ?? [], bytesDownloaded: 0 }
  }

  await mkdir(directory, { recursive: true })
  const archivePath = join(directory, `download.${artifact.archive}`)

  let bytesDone = 0
  const written = await downloadToFile({
    url: artifact.url,
    target: archivePath,
    expectedSha256: artifact.sha256,
    expectedBytes: artifact.bytes,
    subject: `${tool.id} ${tool.version} (${platform}/${variant})`,
    ...(fetch === undefined ? {} : { fetch }),
    ...(signal === undefined ? {} : { signal }),
    onBytes: (delta) => {
      bytesDone += delta
      onProgress?.({
        fraction: artifact.bytes === 0 ? 1 : Math.min(1, bytesDone / artifact.bytes),
        bytesDone,
        bytesTotal: artifact.bytes,
        tool: tool.id,
      })
    },
    describe: (message) => new SidecarInstallError(message, tool.id),
  })

  const files = await extractMembers({
    archivePath,
    kind: artifact.archive,
    destination: directory,
    members: artifact.members,
    platform: nodePlatform,
  })

  // An archive whose globs matched nothing has been verified as *upstream's* bytes and is
  // still useless to us: the manifest's member patterns and the release's layout have drifted.
  // Failing here, loudly, beats leaving a directory that looks installed and has no binary.
  const missing = tool.binaries.filter((binary) => !files.includes(exeName(binary, nodePlatform)))
  if (missing.length > 0) {
    await rm(directory, { recursive: true, force: true })
    throw new SidecarInstallError(
      `${tool.id} ${tool.version} archive did not contain ${missing.join(', ')}`,
      tool.id,
    )
  }

  await rm(archivePath, { force: true })

  const receipt: SidecarReceipt = {
    version: tool.version,
    variant,
    platform,
    sha256: artifact.sha256,
    files,
    installedAt: new Date().toISOString(),
  }
  await writeFile(join(directory, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`)

  onProgress?.({ fraction: 1, bytesDone: written, bytesTotal: artifact.bytes, tool: tool.id })
  return { directory, files, bytesDownloaded: written }
}
