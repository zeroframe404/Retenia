/**
 * The sidecar manager: finding, installing and running the bundled binaries the media
 * pipeline drives (`docs/spec/07-architecture.md` §7).
 *
 * Exported as its own entry point (`@retenia/ingest/sidecars`) rather than through the package
 * barrel, for the same reason `./models` is: everything here reaches for `node:child_process`,
 * and the Electron main process — which imports the barrel for its job registry metadata —
 * has no business evaluating a process spawner at startup.
 */

export {
  type ArchiveKind,
  findSidecarTool,
  listArtifacts,
  listSidecarTools,
  requireSidecarTool,
  type SidecarArtifact,
  type SidecarTool,
  type SidecarToolId,
  type SidecarVariant,
  selectArtifact,
} from './catalog'
export { FORWARDED_ENV_KEYS, forwardableEnv } from './env'
export { extractMembers, flattenedName, matchesGlob, safeMemberName } from './extract'
export {
  createFfmpegProgressParser,
  DHASH_BYTES,
  DHASH_HEIGHT,
  DHASH_WIDTH,
  extractWavArgs,
  INTERVAL_SECONDS,
  KEYFRAME_HARD_CAP,
  type KeyframeStrategy,
  keyframeArgs,
  type ProbeResult,
  parseProbeJson,
  parseShowinfoTime,
  probeArgs,
  SCENE_THRESHOLD,
  WHISPER_SAMPLE_RATE,
} from './ffmpeg'
export {
  detectNvidia,
  type GpuDetection,
  MIN_USEFUL_VRAM_MIB,
  NVIDIA_SMI_ARGS,
  type NvidiaGpu,
  parseNvidiaSmi,
  prefersCuda,
  resetGpuDetection,
} from './gpu'
export {
  type InstallOptions,
  type InstallProgress,
  type InstallResult,
  installSidecar,
  isInstalled,
  readReceipt,
  SidecarInstallError,
  type SidecarReceipt,
} from './install'
export { KILL_GRACE_MS, type Killable, killTree, taskkillArgs } from './kill-tree'
export {
  currentHost,
  exeName,
  type HostDescription,
  SIDECAR_PLATFORMS,
  type SidecarPlatform,
  sidecarPlatform,
} from './platform'
export {
  type ResolvedSidecar,
  type ResolveOptions,
  resolveSidecar,
  type SidecarRoots,
  type SidecarSource,
  sidecarDirectory,
} from './resolve'
export {
  createLineSplitter,
  killAllSidecars,
  liveSidecarPids,
  type RunSidecarOptions,
  runSidecar,
  SidecarCancelledError,
  SidecarError,
  type SidecarRunResult,
  SidecarTimeoutError,
  sidecarEnv,
} from './spawn'
export {
  buildVtt,
  defaultThreads,
  formatVttTimestamp,
  parseTimestamp,
  parseWhisperJson,
  parseWhisperProgress,
  type VttCue,
  type WhisperArgsOptions,
  type WhisperSegment,
  type WhisperTranscript,
  whisperArgs,
} from './whisper'
