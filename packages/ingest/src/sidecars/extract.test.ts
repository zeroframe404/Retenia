import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { extractMembers, flattenedName, matchesGlob, safeMemberName } from './extract'

/**
 * The two functions standing between a downloaded release archive and the filesystem
 * (`docs/spec/07-architecture.md` §7), plus the zip route that uses them.
 *
 * A verified SHA-256 says the archive is the one upstream published. It says nothing about
 * what is inside, and "inside" is attacker-shaped data as soon as an upstream release is ever
 * replaced: member names are chosen by whoever built the archive, and they are used to name
 * files. So `safeMemberName` is tested on the names an archive is not supposed to contain —
 * a traversal, a directory entry, a NUL — rather than only on the ones it does.
 *
 * `matchesGlob` is tested against the real manifest patterns — a star, then `/bin/ffmpeg`, and
 * `Release/` followed by a star and `.dll` — because it is the only thing deciding what gets
 * unpacked at all: a star that crossed a `/`, or a `.` left unescaped, would quietly widen a
 * two-file extraction into the whole archive.
 *
 * The zip path is exercised end to end over an archive built here with the same `fflate` the
 * EPUB and PPTX parsers use — it is what every Windows artifact is, and the platform where
 * shelling out to an archiver was ruled out. The `tar.gz` and `tar.xz` routes are deliberately
 * absent: they hand the file to the system `tar`, so a test of them would mostly be a test of
 * `tar`'s `--transform`, and what they produce is asserted where a real archive is installed.
 */

/** The top directory of an ffmpeg archive is named after the build, which is why the manifest
 *  globs that segment rather than spelling it. */
const FFMPEG_DIR = 'ffmpeg-N-126435-gf93cd72dde-win64-lgpl'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'retenia-sidecars-'))
  roots.push(root)
  return root
}

/** Writes a real zip, so `extractMembers` reads bytes rather than a fixture object. */
async function writeZip(root: string, entries: Record<string, string>): Promise<string> {
  const archive = zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)])),
  )
  const path = join(root, 'artifact.zip')
  await writeFile(path, archive)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('matchesGlob', () => {
  it('matches an ffmpeg build whose top directory it cannot know the name of', () => {
    expect(matchesGlob('*/bin/ffmpeg', `${FFMPEG_DIR}/bin/ffmpeg`)).toBe(true)
    expect(matchesGlob('*/bin/ffprobe', `${FFMPEG_DIR}/bin/ffprobe`)).toBe(true)
  })

  it('is anchored at both ends, so one binary’s glob does not take another’s file', () => {
    // The Windows manifest lists `*/bin/ffmpeg.exe` separately for exactly this reason.
    expect(matchesGlob('*/bin/ffmpeg', `${FFMPEG_DIR}/bin/ffprobe`)).toBe(false)
    expect(matchesGlob('*/bin/ffmpeg', `${FFMPEG_DIR}/bin/ffmpeg.exe`)).toBe(false)
    expect(matchesGlob('Release/*.dll', `${FFMPEG_DIR}/Release/ggml.dll`)).toBe(false)
  })

  it('keeps a single star inside one path segment', () => {
    expect(matchesGlob('*/bin/ffmpeg', 'a/b/bin/ffmpeg')).toBe(false)
    expect(matchesGlob('Release/*.dll', 'Release/ggml-cuda.dll')).toBe(true)
    expect(matchesGlob('Release/*.dll', 'Release/nested/ggml-cuda.dll')).toBe(false)
  })

  it('treats the dot of `*.dll` as a literal, not as "any character"', () => {
    expect(matchesGlob('Release/*.dll', 'Release/ggmlxdll')).toBe(false)
  })

  it('lets a double star cross segments, which is how `**` takes everything', () => {
    expect(matchesGlob('**', 'whisper-cli')).toBe(true)
    expect(matchesGlob('**', `${FFMPEG_DIR}/bin/ffmpeg`)).toBe(true)
  })

  it('matches whisper’s shared libraries through their versioned suffix', () => {
    // Extracting `whisper-cli` without these produces a file that exists and cannot start.
    expect(matchesGlob('*/lib*.so*', 'whisper-bin-x64/libggml-base.so.1')).toBe(true)
    expect(matchesGlob('*/lib*.so*', 'whisper-bin-x64/whisper-cli')).toBe(false)
  })
})

describe('safeMemberName', () => {
  it('flattens a member to the base name the installer expects to find', () => {
    expect(safeMemberName(`${FFMPEG_DIR}/bin/ffmpeg.exe`)).toBe('ffmpeg.exe')
    expect(safeMemberName('Release/whisper-cli.exe')).toBe('whisper-cli.exe')
  })

  it('reads a backslash as a separator, since a zip written on Windows may use one', () => {
    expect(safeMemberName('ffmpeg\\bin\\ffprobe.exe')).toBe('ffprobe.exe')
  })

  it('leaves a traversal with nothing left to traverse', () => {
    // The flattening *is* the containment: what comes back can hold no separator, so
    // `join(destination, name)` is inside the destination whatever the archive claimed.
    for (const hostile of ['../../etc/passwd', '/etc/passwd', 'a/../../b', 'C:\\Windows\\hosts']) {
      const safe = safeMemberName(hostile)
      expect(safe?.includes('/')).not.toBe(true)
      expect(safe?.includes('\\')).not.toBe(true)
    }
    expect(safeMemberName('../../etc/passwd')).toBe('passwd')
  })

  it('refuses a name that is nothing but a traversal', () => {
    expect(safeMemberName('..')).toBeUndefined()
    expect(safeMemberName(`${FFMPEG_DIR}/..`)).toBeUndefined()
    expect(safeMemberName('.')).toBeUndefined()
    expect(safeMemberName('')).toBeUndefined()
  })

  it('refuses a directory entry, which a zip lists as a name ending in a slash', () => {
    expect(safeMemberName(`${FFMPEG_DIR}/`)).toBeUndefined()
    expect(safeMemberName(`${FFMPEG_DIR}\\bin\\`)).toBeUndefined()
  })

  it('refuses a name carrying a control byte', () => {
    // A NUL truncates the path a C-level API sees, so the name that was validated and the name
    // the filesystem acts on stop being the same string.
    expect(safeMemberName(`ffmpeg${String.fromCharCode(0)}.exe`)).toBeUndefined()
    expect(safeMemberName(`bin/${String.fromCharCode(10)}ffprobe`)).toBeUndefined()
    expect(safeMemberName(`bin/ffprobe${String.fromCharCode(31)}`)).toBeUndefined()
  })
})

describe('flattenedName', () => {
  it('names the file a member glob will be written as', () => {
    expect(flattenedName('*/bin/ffmpeg.exe')).toBe('ffmpeg.exe')
    expect(flattenedName('Release/whisper-cli.exe')).toBe('whisper-cli.exe')
    expect(flattenedName('whisper-cli')).toBe('whisper-cli')
  })

  it('leaves the wildcard in place when the glob does not name one file', () => {
    // Which bounds what the manifest sanity check can claim: a `*.dll` member has no single
    // name to compare a binary against.
    expect(flattenedName('Release/*.dll')).toBe('*.dll')
    expect(flattenedName('*/lib*.so*')).toBe('lib*.so*')
  })
})

describe('extractMembers, over a real zip', () => {
  it('writes the members that match, flattened, and nothing else', async () => {
    const root = await tempRoot()
    const archivePath = await writeZip(root, {
      [`${FFMPEG_DIR}/`]: '',
      [`${FFMPEG_DIR}/bin/ffmpeg`]: 'ffmpeg bytes',
      [`${FFMPEG_DIR}/bin/ffprobe`]: 'ffprobe bytes',
      [`${FFMPEG_DIR}/doc/ffmpeg.html`]: '<html>the manual</html>',
      [`${FFMPEG_DIR}/LICENSE.txt`]: 'LGPL',
    })
    // Not pre-created: the installer points at `<tool>/<version>/` before anything exists there.
    const destination = join(root, 'ffmpeg', 'autobuild-2026-09-06-13-06')

    const written = await extractMembers({
      archivePath,
      kind: 'zip',
      destination,
      members: ['*/bin/ffmpeg', '*/bin/ffprobe'],
    })

    expect([...written].sort()).toEqual(['ffmpeg', 'ffprobe'])
    expect((await readdir(destination)).sort()).toEqual(['ffmpeg', 'ffprobe'])
    expect(await readFile(join(destination, 'ffmpeg'), 'utf-8')).toBe('ffmpeg bytes')
    expect(await readFile(join(destination, 'ffprobe'), 'utf-8')).toBe('ffprobe bytes')
  })

  it('drops the upstream directory layout instead of reproducing it', async () => {
    // `**` takes every entry the archive has, including the directory records a zip carries,
    // and still only files land — one level deep, beside each other.
    const root = await tempRoot()
    const archivePath = await writeZip(root, {
      'whisper-bin-x64/': '',
      'whisper-bin-x64/whisper-cli': 'whisper bytes',
      'whisper-bin-x64/libggml-base.so.1': 'library bytes',
    })
    const destination = join(root, 'whisper', 'v1.9.2')

    const written = await extractMembers({ archivePath, kind: 'zip', destination, members: ['**'] })

    expect([...written].sort()).toEqual(['libggml-base.so.1', 'whisper-cli'])
    expect((await readdir(destination)).sort()).toEqual(['libggml-base.so.1', 'whisper-cli'])
  })

  it.skipIf(process.platform === 'win32')('makes what it wrote executable', async () => {
    // A zip does not carry the mode bits, so a faithful unpack produces a `whisper-cli` that
    // cannot be run — a failure that only appears at the first transcription.
    const root = await tempRoot()
    const archivePath = await writeZip(root, { 'whisper-bin-x64/whisper-cli': 'whisper bytes' })
    const destination = join(root, 'whisper', 'v1.9.2')

    await extractMembers({ archivePath, kind: 'zip', destination, members: ['*/whisper-cli'] })

    expect((await stat(join(destination, 'whisper-cli'))).mode & 0o111).not.toBe(0)
  })
})
