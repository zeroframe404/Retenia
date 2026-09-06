import type { SidecarEnvironment } from '../../jobs/definitions'

/**
 * Getting ffmpeg, whisper-cli and a speech model onto the machine, then saying where they are.
 *
 * This is where sub-phase 6.4's "download on demand" decision
 * (`docs/spec/07-architecture.md` §13.4) actually happens. Nothing is bundled: the first
 * audio or video import fetches ~200 MB of binaries and weights, each verified against a
 * SHA-256 in a checked-in manifest, and every import afterwards finds them already installed
 * and returns in the time it takes to `stat` four files.
 *
 * Ordering matters and is not arbitrary. The GPU is probed *before* anything is downloaded,
 * because the answer changes what gets downloaded: with a usable NVIDIA card the CUDA whisper
 * build and the larger, better model are worth their size, and without one they are 1.2 GB
 * that would make every transcript slower rather than faster.
 */

export interface MediaToolchainPaths {
  ffmpeg: string
  ffprobe: string | null
  whisperCli: string
  whisperModel: string
  whisperModelId: string
  vadModel: string | null
  variant: string
  hostEnv?: Record<string, string>
}

export interface EnsureToolchainOptions {
  modelsRoot: string
  sidecars?: SidecarEnvironment
  signal?: AbortSignal
  onProgress?: (fraction: number, message: string) => void
  /** Skips the `nvidia-smi` probe. Set when the user has opted out of the GPU package. */
  allowCuda?: boolean
}

export class MediaToolchainUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaToolchainUnavailableError'
  }
}

export async function ensureMediaToolchain(
  options: EnsureToolchainOptions,
): Promise<MediaToolchainPaths> {
  const { modelsRoot, sidecars, signal, onProgress, allowCuda = true } = options

  const [
    {
      detectNvidia,
      installSidecar,
      prefersCuda,
      requireSidecarTool,
      resolveSidecar,
      selectArtifact,
      sidecarPlatform,
    },
    { CUDA_WHISPER_MODEL_ID, DEFAULT_WHISPER_MODEL_ID, ensureWeight, requireWeight, SILERO_VAD },
  ] = await Promise.all([import('@retenia/ingest/sidecars'), import('@retenia/ingest/media')])

  const platform = sidecarPlatform()
  if (platform === undefined) {
    // macOS reaches here today: BtbN publishes no macOS ffmpeg and whisper.cpp ships an
    // xcframework rather than a CLI, so there is nothing pinned to install. Saying so plainly
    // beats a download that 404s.
    throw new MediaToolchainUnavailableError(
      'Local transcription is not available on this platform yet',
    )
  }

  if (sidecars === undefined || sidecars.binRoot === undefined) {
    throw new MediaToolchainUnavailableError('No sidecar directory was configured for this job')
  }
  const { binRoot, hostEnv } = sidecars

  const roots = {
    ...(sidecars.bundledRoot === undefined ? {} : { resources: sidecars.bundledRoot }),
    ...(sidecars.devRoot === undefined ? {} : { dev: sidecars.devRoot }),
    userData: binRoot,
  }

  const gpu = allowCuda
    ? await detectNvidia({
        ...(hostEnv === undefined ? {} : { hostEnv }),
      })
    : { present: false as const }
  const wantsCuda = prefersCuda(gpu)

  // Four things to fetch; the progress band is split evenly between them rather than by size,
  // because the sizes differ by two orders of magnitude and a bar weighted by bytes would sit
  // at 2 % through the entire ffmpeg download and then jump.
  const steps = 4
  let step = 0
  const stepProgress = (message: string) => (fraction: number) => {
    onProgress?.((step + fraction) / steps, message)
  }

  const ffmpegTool = requireSidecarTool('ffmpeg')
  const ffmpeg = await ensureTool({
    tool: ffmpegTool,
    variant: 'cpu',
    platform,
    roots,
    binRoot,
    signal,
    onProgress: stepProgress('downloading ffmpeg'),
    resolveSidecar,
    selectArtifact,
    installSidecar,
  })
  step += 1

  const whisperTool = requireSidecarTool('whisper')
  const whisper = await ensureTool({
    tool: whisperTool,
    variant: wantsCuda ? 'cuda12' : 'cpu',
    platform,
    roots,
    binRoot,
    signal,
    onProgress: stepProgress('downloading Whisper'),
    resolveSidecar,
    selectArtifact,
    installSidecar,
  })
  step += 1

  // The big model only where it will actually be fast. On a CPU-only machine
  // `large-v3-turbo-q5_0` is 574 MB and roughly real time, which reads as a hang.
  const modelId = whisper.variant === 'cuda12' ? CUDA_WHISPER_MODEL_ID : DEFAULT_WHISPER_MODEL_ID
  const whisperModel = await ensureWeight({
    root: modelsRoot,
    spec: requireWeight(modelId),
    ...(signal === undefined ? {} : { signal }),
    onProgress: stepProgress('downloading the speech model'),
  })
  step += 1

  // 885 KB, and the difference between segments cut at pauses and segments cut at whisper's
  // own 30-second window. Failing to fetch it is not fatal: whisper without `--vad` still
  // produces correct timestamps, so the pipeline degrades rather than stopping.
  let vadModel: string | null = null
  try {
    vadModel = await ensureWeight({
      root: modelsRoot,
      spec: SILERO_VAD,
      ...(signal === undefined ? {} : { signal }),
      onProgress: stepProgress('downloading the voice-activity model'),
    })
  } catch {
    vadModel = null
  }
  step += 1

  onProgress?.(1, 'ready')

  return {
    ffmpeg: ffmpeg.paths.ffmpeg as string,
    ffprobe: ffmpeg.paths.ffprobe ?? null,
    whisperCli: whisper.paths['whisper-cli'] as string,
    whisperModel,
    whisperModelId: modelId,
    vadModel,
    variant: whisper.variant,
    ...(hostEnv === undefined ? {} : { hostEnv }),
  }
}

/**
 * Resolves one tool, installing it if it is not already somewhere the resolver looks.
 *
 * The resolve-then-install order is what makes a bundled or development build win over a
 * download: a repository with `.sidecars/` populated never reaches the network, which is also
 * what lets the integration test run offline.
 */
async function ensureTool(options: {
  tool: Awaited<ReturnType<typeof import('@retenia/ingest/sidecars').requireSidecarTool>>
  variant: 'cpu' | 'cuda12'
  platform: Awaited<ReturnType<typeof import('@retenia/ingest/sidecars').sidecarPlatform>> & string
  roots: Record<string, string>
  binRoot: string
  signal?: AbortSignal
  onProgress: (fraction: number) => void
  resolveSidecar: typeof import('@retenia/ingest/sidecars').resolveSidecar
  selectArtifact: typeof import('@retenia/ingest/sidecars').selectArtifact
  installSidecar: typeof import('@retenia/ingest/sidecars').installSidecar
}): Promise<{ paths: Record<string, string>; variant: string }> {
  const { tool, roots, binRoot, signal, onProgress } = options

  const found: Record<string, string> = {}
  for (const binary of tool.binaries) {
    const hit = await options.resolveSidecar({
      tool: tool.id,
      version: tool.version,
      binary,
      roots,
    })
    if (hit !== undefined) found[binary] = hit.path
  }

  // `ffprobe` is genuinely optional — the pipeline falls back to reading the duration from the
  // extracted WAV — so a tool counts as present once its *first* binary is there.
  const primary = tool.binaries[0] as string
  if (found[primary] !== undefined) {
    onProgress(1)
    return { paths: found, variant: 'cpu' }
  }

  const selected = options.selectArtifact(tool, options.platform, options.variant)
  if (selected === undefined) {
    throw new MediaToolchainUnavailableError(
      `No ${tool.id} build is published for ${options.platform}`,
    )
  }

  await options.installSidecar({
    tool,
    artifact: selected.artifact,
    variant: selected.variant,
    platform: options.platform,
    root: binRoot,
    ...(signal === undefined ? {} : { signal }),
    onProgress: (progress) => onProgress(progress.fraction),
  })

  const paths: Record<string, string> = {}
  for (const binary of tool.binaries) {
    const hit = await options.resolveSidecar({
      tool: tool.id,
      version: tool.version,
      binary,
      roots,
    })
    if (hit !== undefined) paths[binary] = hit.path
  }
  if (paths[primary] === undefined) {
    throw new MediaToolchainUnavailableError(`${tool.id} did not install correctly`)
  }
  return { paths, variant: selected.variant }
}
