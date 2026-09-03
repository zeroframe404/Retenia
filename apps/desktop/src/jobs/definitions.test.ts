import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import type { JobContext } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHashFileJob, isInsideRoot, JobCancelledError, sleepJob } from './definitions'

/** A real `AbortController`, since that is what the worker passes. */
function context(controller = new AbortController()) {
  const progress: { value: number; message: string | undefined }[] = []
  const ctx: JobContext = {
    jobId: 'j1',
    progress: (value, message) => progress.push({ value, message }),
    signal: controller.signal,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx, controller, progress }
}

/**
 * The comparison behind `hashFile`'s confinement, exercised against **both** platforms'
 * `path` semantics.
 *
 * Windows-only rules are the reason this is a separate, parameterised test rather than a
 * detail of the `hashFile` suite: the first version compared paths with `startsWith`, which
 * passes every Linux test and rejects every legitimate path on Windows — where `os.tmpdir()`
 * hands back 8.3 short names that `realpath` expands, and where case differs freely. CI on
 * `windows-latest` caught it; these cases mean it cannot come back unnoticed.
 */
describe('isInsideRoot', () => {
  describe('posix', () => {
    const inside = (root: string, candidate: string) => isInsideRoot(path.posix, root, candidate)

    it('accepts the root itself and anything under it', () => {
      expect(inside('/data/blobs', '/data/blobs')).toBe(true)
      expect(inside('/data/blobs', '/data/blobs/ab/cd.pdf')).toBe(true)
    })

    it('rejects a sibling whose name merely starts with the root', () => {
      expect(inside('/data/blobs', '/data/blobs-evil/x')).toBe(false)
    })

    it('rejects anything outside', () => {
      expect(inside('/data/blobs', '/etc/passwd')).toBe(false)
      expect(inside('/data/blobs', '/data')).toBe(false)
    })

    it('is case-sensitive, as the filesystem is', () => {
      expect(inside('/data/blobs', '/data/BLOBS/x')).toBe(false)
    })
  })

  describe('win32', () => {
    const inside = (root: string, candidate: string) => isInsideRoot(path.win32, root, candidate)

    it('accepts the root itself and anything under it', () => {
      expect(inside('C:\\Users\\ada\\blobs', 'C:\\Users\\ada\\blobs')).toBe(true)
      expect(inside('C:\\Users\\ada\\blobs', 'C:\\Users\\ada\\blobs\\ab\\cd.pdf')).toBe(true)
    })

    it('ignores case, because the filesystem does', () => {
      // The failure CI found: `realpath` and `resolve` disagreeing on case is not a reason to
      // refuse a file the app itself just wrote.
      expect(inside('C:\\Users\\ada\\blobs', 'c:\\users\\ADA\\Blobs\\x.pdf')).toBe(true)
    })

    it('accepts a mixed separator, which Node produces freely', () => {
      expect(inside('C:\\Users\\ada\\blobs', 'C:/Users/ada/blobs/x.pdf')).toBe(true)
    })

    it('rejects a sibling whose name merely starts with the root', () => {
      expect(inside('C:\\Users\\ada\\blobs', 'C:\\Users\\ada\\blobs-evil\\x')).toBe(false)
    })

    it('rejects a traversal back out', () => {
      expect(inside('C:\\Users\\ada\\blobs', 'C:\\Users\\ada\\secrets\\x')).toBe(false)
    })

    it('rejects a path on another drive', () => {
      expect(inside('C:\\Users\\ada\\blobs', 'D:\\blobs\\x')).toBe(false)
    })
  })
})

describe('sleep', () => {
  it('rejects a payload that is not a duration', () => {
    expect(() => sleepJob.parseInput({ ms: 'soon' })).toThrow(/non-negative numeric "ms"/)
    expect(() => sleepJob.parseInput({ ms: -1 })).toThrow(/non-negative numeric "ms"/)
    expect(() => sleepJob.parseInput({})).toThrow(/non-negative numeric "ms"/)
  })

  it('reports progress from 0 to 1 and returns what it slept', async () => {
    const { ctx, progress } = context()
    await expect(sleepJob.run({ ms: 20 }, ctx)).resolves.toEqual({ sleptMs: 20 })
    expect(progress.at(-1)?.value).toBe(1)
    expect(progress.map((entry) => entry.value)).toEqual(
      [...progress.map((entry) => entry.value)].sort((a, b) => a - b),
    )
  })

  it('stops promptly when cancelled, rather than running to completion', async () => {
    const { ctx, controller } = context()
    const running = sleepJob.run({ ms: 30_000 }, ctx)
    controller.abort()
    await expect(running).rejects.toThrow(JobCancelledError)
  })

  it('refuses to start at all when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { ctx } = context(controller)
    await expect(sleepJob.run({ ms: 30_000 }, ctx)).rejects.toThrow(JobCancelledError)
  })
})

describe('hashFile', () => {
  let dir: string
  let hashFileJob: ReturnType<typeof createHashFileJob>

  beforeEach(() => {
    // `realpathSync`: macOS puts temp dirs under a `/var` → `/private/var` symlink, and the
    // confinement check compares real paths.
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'retenia-hash-')))
    hashFileJob = createHashFileJob([dir])
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (name: string, contents: Buffer): string => {
    const path = join(dir, name)
    writeFileSync(path, contents)
    return path
  }

  it('rejects a payload without a usable path', () => {
    expect(() => hashFileJob.parseInput({})).toThrow(/non-empty string "path"/)
    expect(() => hashFileJob.parseInput({ path: '' })).toThrow(/non-empty string "path"/)
  })

  it('produces the same digest as the platform does', async () => {
    const contents = randomBytes(256 * 1024)
    const path = write('sample.bin', contents)
    const { ctx } = context()

    await expect(hashFileJob.run({ path }, ctx)).resolves.toEqual({
      sha256: createHash('sha256').update(contents).digest('hex'),
      bytes: contents.byteLength,
    })
  })

  it('reports progress that rises to 1', async () => {
    const path = write('sample.bin', randomBytes(512 * 1024))
    const { ctx, progress } = context()
    await hashFileJob.run({ path }, ctx)

    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)?.value).toBe(1)
    for (const [index, entry] of progress.entries()) {
      expect(entry.value).toBeGreaterThanOrEqual(progress[index - 1]?.value ?? 0)
    }
  })

  it('handles an empty file without dividing by zero', async () => {
    const path = write('empty.bin', Buffer.alloc(0))
    const { ctx } = context()
    await expect(hashFileJob.run({ path }, ctx)).resolves.toEqual({
      sha256: createHash('sha256').digest('hex'),
      bytes: 0,
    })
  })

  it('stops when cancelled', async () => {
    const path = write('big.bin', randomBytes(8 * 1024 * 1024))
    const controller = new AbortController()
    const { ctx } = context(controller)
    controller.abort()
    await expect(hashFileJob.run({ path }, ctx)).rejects.toThrow(JobCancelledError)
  })

  it('fails loudly on a file that is not there', async () => {
    const { ctx } = context()
    await expect(hashFileJob.run({ path: join(dir, 'missing.bin') }, ctx)).rejects.toThrow()
  })

  describe('path confinement', () => {
    it('refuses a file outside the roots it may read', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'retenia-elsewhere-'))
      try {
        const path = join(outside, 'secret.bin')
        writeFileSync(path, randomBytes(16))
        const { ctx } = context()
        await expect(hashFileJob.run({ path }, ctx)).rejects.toThrow(/outside the directories/)
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('refuses a traversal out of a root', async () => {
      const { ctx } = context()
      await expect(
        hashFileJob.run({ path: join(dir, '..', '..', 'etc', 'passwd') }, ctx),
      ).rejects.toThrow()
    })

    it('refuses a symlink inside a root that points outside it', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'retenia-elsewhere-'))
      try {
        const target = join(outside, 'secret.bin')
        writeFileSync(target, randomBytes(16))
        const link = join(dir, 'innocent.bin')
        symlinkSync(target, link)

        const { ctx } = context()
        // The prefix test runs against the resolved path, so following the link does not
        // smuggle a read out of the root.
        await expect(hashFileJob.run({ path: link }, ctx)).rejects.toThrow(
          /outside the directories/,
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('does not echo the rejected path back to the caller', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'retenia-elsewhere-'))
      try {
        const path = join(outside, 'secret.bin')
        writeFileSync(path, randomBytes(16))
        const { ctx } = context()
        // The message reaches the renderer through `job.error`.
        await expect(hashFileJob.run({ path }, ctx)).rejects.toThrow(
          expect.not.stringContaining(outside) as unknown as string,
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })
  })
})
