/**
 * Which prebuilt artifact this machine needs.
 *
 * A separate module from the catalog because every function here takes the platform and
 * architecture as arguments rather than reading `process`, which is what lets the Windows
 * behaviour be tested from Linux — the same trick `apps/desktop/src/jobs/confine.ts` plays
 * with `path.win32`, and for the same reason: this is code whose bugs only appear on the
 * platform nobody runs the test suite on.
 */

/** The platform keys a sidecar manifest is indexed by. */
export const SIDECAR_PLATFORMS = [
  'win32-x64',
  'win32-arm64',
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
] as const
export type SidecarPlatform = (typeof SIDECAR_PLATFORMS)[number]

export interface HostDescription {
  platform: NodeJS.Platform
  arch: string
}

export function currentHost(): HostDescription {
  return { platform: process.platform, arch: process.arch }
}

/**
 * `win32-x64`, `linux-arm64`… or `undefined` for a host no artifact is published for.
 *
 * `undefined` rather than a throw: an unsupported host is a reason to tell the user that
 * local transcription is unavailable here, not a crash on the way to saying so.
 */
export function sidecarPlatform(
  host: HostDescription = currentHost(),
): SidecarPlatform | undefined {
  const key = `${host.platform}-${host.arch}`
  return (SIDECAR_PLATFORMS as readonly string[]).includes(key)
    ? (key as SidecarPlatform)
    : undefined
}

/** `ffmpeg` → `ffmpeg.exe` on Windows. */
export function exeName(base: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${base}.exe` : base
}
