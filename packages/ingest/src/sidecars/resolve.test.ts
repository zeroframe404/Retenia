import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exeName, SIDECAR_PLATFORMS, sidecarPlatform } from './platform'
import { resolveSidecar, type SidecarRoots, sidecarDirectory } from './resolve'

/**
 * Which of three copies of a third-party binary the app runs, and under what name.
 *
 * Everything here goes through the two seams `resolveSidecar` exposes — an injected `exists`
 * and an explicit `platform` — because the behaviour that matters is Windows' (`ffmpeg.exe`,
 * a `userData` download sitting beside a bundled build) and nobody runs this suite on Windows.
 * It is the trick `platform.ts` documents, applied one level up to its caller.
 *
 * The order of the three roots is the part worth pinning. `docs/spec/07-architecture.md` §13.4
 * decided sidecars are downloaded rather than bundled, which makes `<userData>/bin` the tier
 * the shipped app actually uses — and a developer's `.sidecars/` tree must still win over it,
 * or testing a pinned version bump would silently exercise whatever the app downloaded last
 * week. Expected paths are spelled out segment by segment rather than built with
 * `sidecarDirectory`, so the layout is asserted instead of restated.
 */

/** BtbN's dated tag, in the form the manifest pins and the directory therefore carries. */
const VERSION = 'autobuild-2026-09-06-13-06'

const RESOURCES = join('/app', 'resources', 'bin')
const DEV = join('/repo', '.sidecars')
const USER_DATA = join('/userData', 'bin')
const ROOTS: SidecarRoots = { resources: RESOURCES, dev: DEV, userData: USER_DATA }

const INSTALLED = {
  resources: join(RESOURCES, 'ffmpeg', VERSION, 'ffmpeg'),
  dev: join(DEV, 'ffmpeg', VERSION, 'ffmpeg'),
  userData: join(USER_DATA, 'ffmpeg', VERSION, 'ffmpeg'),
}

/** An `exists` that answers for a fixed set of paths and records, in order, every path it was
 *  asked about — which is how the tier order is asserted rather than inferred from the winner. */
function existsAmong(present: readonly string[]): {
  exists: (path: string) => Promise<boolean>
  probed: string[]
} {
  const probed: string[] = []
  return {
    probed,
    exists: (path) => {
      probed.push(path)
      return Promise.resolve(present.includes(path))
    },
  }
}

function resolveFfmpeg(
  exists: (path: string) => Promise<boolean>,
  overrides: { roots?: SidecarRoots; platform?: NodeJS.Platform } = {},
) {
  return resolveSidecar({
    tool: 'ffmpeg',
    version: VERSION,
    binary: 'ffmpeg',
    roots: overrides.roots ?? ROOTS,
    platform: overrides.platform ?? 'linux',
    exists,
  })
}

describe('resolveSidecar', () => {
  it('prefers a binary shipped with the app over one downloaded later', async () => {
    const { exists } = existsAmong([INSTALLED.resources, INSTALLED.dev, INSTALLED.userData])
    expect(await resolveFfmpeg(exists)).toEqual({ path: INSTALLED.resources, source: 'resources' })
  })

  it('prefers the development tree over what the app downloaded', async () => {
    const { exists } = existsAmong([INSTALLED.dev, INSTALLED.userData])
    expect(await resolveFfmpeg(exists)).toEqual({ path: INSTALLED.dev, source: 'dev' })
  })

  it('falls back to the download directory when no build is bundled or checked out', async () => {
    const { exists } = existsAmong([INSTALLED.userData])
    expect(await resolveFfmpeg(exists)).toEqual({ path: INSTALLED.userData, source: 'userData' })
  })

  it('stops probing at the first tier that has the tool', async () => {
    const { exists, probed } = existsAmong([INSTALLED.dev])
    await resolveFfmpeg(exists)
    expect(probed).toEqual([INSTALLED.resources, INSTALLED.dev])
  })

  it('skips a root the caller did not configure', async () => {
    const { exists, probed } = existsAmong([INSTALLED.userData])
    const roots: SidecarRoots = { userData: USER_DATA }
    expect(await resolveFfmpeg(exists, { roots })).toEqual({
      path: INSTALLED.userData,
      source: 'userData',
    })
    expect(probed).toEqual([INSTALLED.userData])
  })

  it('answers undefined for a tool nothing has installed, rather than throwing', async () => {
    // "Not found" is the ordinary answer that turns into a download phase of the job the user
    // already started, so it has to be a value the caller can branch on.
    const { exists } = existsAmong([])
    expect(await resolveFfmpeg(exists)).toBeUndefined()
    expect(await resolveFfmpeg(exists, { roots: {} })).toBeUndefined()
  })

  it('looks for ffmpeg.exe on Windows and for ffmpeg everywhere else', async () => {
    const windows = join(DEV, 'ffmpeg', VERSION, 'ffmpeg.exe')
    const onWindows = existsAmong([windows])
    expect(await resolveFfmpeg(onWindows.exists, { platform: 'win32' })).toEqual({
      path: windows,
      source: 'dev',
    })

    const onLinux = existsAmong([windows])
    expect(await resolveFfmpeg(onLinux.exists, { platform: 'linux' })).toBeUndefined()
  })

  it('does not resolve a version bump to the build it replaces', async () => {
    // The whole reason the directory is versioned: an installed `autobuild-…-08-30` must not
    // answer a lookup for `autobuild-…-09-06`, or a bump would run the old binary forever.
    const previous = join(USER_DATA, 'ffmpeg', 'autobuild-2026-08-30-11-02', 'ffmpeg')
    const { exists } = existsAmong([previous])
    expect(await resolveFfmpeg(exists)).toBeUndefined()
  })

  it('keeps every binary of one tool under that tool’s own directory', async () => {
    // whisper's archive holds `whisper-cli` plus the shared libraries it loads at run time, so
    // the directory is named after the tool and the executable after itself.
    const path = join(USER_DATA, 'whisper', 'v1.9.2', 'whisper-cli')
    const { exists } = existsAmong([path])
    expect(
      await resolveSidecar({
        tool: 'whisper',
        version: 'v1.9.2',
        binary: 'whisper-cli',
        roots: ROOTS,
        platform: 'linux',
        exists,
      }),
    ).toEqual({ path, source: 'userData' })
  })
})

describe('sidecarDirectory', () => {
  it('gives each pinned version a directory of its own beneath the tool', () => {
    expect(sidecarDirectory(USER_DATA, 'whisper', 'v1.9.2')).toBe(
      join(USER_DATA, 'whisper', 'v1.9.2'),
    )
  })
})

describe('sidecarPlatform', () => {
  it('names the manifest key for a host an artifact is published for', () => {
    expect(sidecarPlatform({ platform: 'win32', arch: 'x64' })).toBe('win32-x64')
    expect(sidecarPlatform({ platform: 'linux', arch: 'arm64' })).toBe('linux-arm64')
    expect(sidecarPlatform({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64')
  })

  it('recognises every key the manifest is indexed by', () => {
    for (const key of SIDECAR_PLATFORMS) {
      const [platform, arch] = key.split('-') as [NodeJS.Platform, string]
      expect(sidecarPlatform({ platform, arch })).toBe(key)
    }
  })

  it('answers undefined on a host nothing is built for, instead of throwing', () => {
    // An unsupported host is a reason to tell the user local transcription is unavailable, and
    // the Library has to render that sentence — it cannot render an exception.
    expect(sidecarPlatform({ platform: 'linux', arch: 'ia32' })).toBeUndefined()
    expect(sidecarPlatform({ platform: 'freebsd', arch: 'x64' })).toBeUndefined()
    expect(sidecarPlatform({ platform: 'win32', arch: 'riscv64' })).toBeUndefined()
  })
})

describe('exeName', () => {
  it('adds the extension on Windows and leaves the name alone anywhere else', () => {
    expect(exeName('ffmpeg', 'win32')).toBe('ffmpeg.exe')
    expect(exeName('ffmpeg', 'linux')).toBe('ffmpeg')
    expect(exeName('whisper-cli', 'darwin')).toBe('whisper-cli')
  })
})
