import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_COURSE_DEPTH, MAX_COURSE_FILES, walkCourseFolder } from './course'

/**
 * The directory walk behind `library.addCourseFromFolder` (sub-phase 6.4).
 *
 * The ordering and titling rules it delegates to are pure and tested in
 * `packages/ingest/src/media/course.test.ts`; what is tested here is everything that needs a
 * real filesystem — and in particular the three bounds that keep one dialog click from
 * enumerating a user's whole disk. A folder picker is a broad grant, and this is where it is
 * narrowed.
 */

const roots: string[] = []

/**
 * Builds a throwaway folder from a `path -> contents` map.
 *
 * Each directory is created once rather than once per file, and the files are written in
 * batches rather than one awaited call after another. That is not a micro-optimisation: the
 * truncation case below lays down `MAX_COURSE_FILES + 5` entries, and the serial version of
 * this helper spent over five seconds doing it on `windows-latest` — a fixture cost, charged
 * to a test whose subject is the walk's bound and not the filesystem's write throughput.
 *
 * The batch is bounded because libuv's threadpool is, and an unbounded `Promise.all` over
 * hundreds of opens is how a constrained runner gets EMFILE.
 */
const WRITE_BATCH = 32

/** Room for the one case that lays down five hundred files. */
const HEAVY_FIXTURE = { timeout: 30_000 }

async function tree(spec: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'retenia-course-'))
  roots.push(root)

  const entries = Object.entries(spec).map(([relPath, contents]) => ({
    full: join(root, relPath),
    contents,
  }))
  const directories = new Set(entries.map((entry) => join(entry.full, '..')))
  for (const directory of directories) await mkdir(directory, { recursive: true })

  for (let start = 0; start < entries.length; start += WRITE_BATCH) {
    await Promise.all(
      entries
        .slice(start, start + WRITE_BATCH)
        .map((entry) => writeFile(entry.full, entry.contents)),
    )
  }
  return root
}

// The same headroom, for the same reason, on the way back out: removing the truncation case's
// five hundred files is the heaviest teardown here, and `retryDelay` covers the Windows case
// where a file just written is still held open by a scan when the remove reaches it.
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  )
}, HEAVY_FIXTURE.timeout)

describe('walkCourseFolder', () => {
  it('reads a Udemy-shaped folder in the author’s own order', async () => {
    const root = await tree({
      '01-intro/01-welcome.mp4': 'a',
      '01-intro/02-setup.mp4': 'b',
      // Unpadded, so lexicographic order would put 10 before 9 and silently swap two lessons.
      '02-basics/9-loops.mp4': 'c',
      '02-basics/10-scope.mp4': 'd',
    })

    const { parts, truncated } = await walkCourseFolder(root)

    expect(truncated).toBe(false)
    expect(parts.map((part) => part.relPath)).toEqual([
      '01-intro/01-welcome.mp4',
      '01-intro/02-setup.mp4',
      '02-basics/9-loops.mp4',
      '02-basics/10-scope.mp4',
    ])
    expect(parts.map((part) => part.title)).toEqual(['Welcome', 'Setup', 'Loops', 'Scope'])
    expect(parts.map((part) => part.sectionPath)).toEqual([
      ['Intro'],
      ['Intro'],
      ['Basics'],
      ['Basics'],
    ])
    expect(parts.map((part) => part.ordinal)).toEqual([0, 1, 2, 3])
  })

  it('keeps only media, quietly', async () => {
    // A real course export is full of PDFs, subtitles and resource archives. They are not
    // failures, and listing every one of them would bury the entries that do matter.
    const root = await tree({
      '01-welcome.mp4': 'a',
      '01-welcome.vtt': 'b',
      'slides.pdf': 'c',
      'resources.zip': 'd',
      'notes.md': 'e',
      '02-audio-only.m4a': 'f',
    })

    const { parts, skipped } = await walkCourseFolder(root)

    expect(parts.map((part) => part.relPath)).toEqual(['01-welcome.mp4', '02-audio-only.m4a'])
    expect(skipped).toEqual([])
  })

  it('puts a file at the top level in no section', async () => {
    const root = await tree({ 'lecture.mp4': 'a' })
    const { parts } = await walkCourseFolder(root)
    expect(parts).toHaveLength(1)
    expect(parts[0]?.sectionPath).toEqual([])
  })

  it('ignores dotfiles and dot-directories', async () => {
    const root = await tree({
      '.hidden.mp4': 'a',
      '.cache/thumb.mp4': 'b',
      'real.mp4': 'c',
    })
    const { parts } = await walkCourseFolder(root)
    expect(parts.map((part) => part.relPath)).toEqual(['real.mp4'])
  })

  it('stops descending past its depth bound', async () => {
    // The bound exists so one dialog click cannot enumerate an arbitrary amount of the user's
    // disk. `<course>/<section>/<lesson>` is the shape every export has; anything deeper is
    // imported as far as the bound reaches rather than refused.
    const deep = 'a/b/c/d/too-deep.mp4'
    const root = await tree({ 'a/shallow.mp4': 'x', [deep]: 'y' })

    const { parts } = await walkCourseFolder(root)

    expect(MAX_COURSE_DEPTH).toBe(3)
    expect(parts.map((part) => part.relPath)).toEqual(['a/shallow.mp4'])
  })

  it('does not follow a symlink out of the chosen folder', async () => {
    // The one that matters most. A symlink inside the folder can point anywhere — including
    // at a directory containing itself — so following one turns a bounded walk into an
    // unbounded one, and lets a folder the user picked read a folder they did not.
    const outside = await tree({ 'secret.mp4': 'nope' })
    const root = await tree({ 'inside.mp4': 'yes' })
    try {
      await symlink(outside, join(root, 'escape'), 'dir')
    } catch {
      // Windows refuses symlink creation without privilege; the guard is still compiled in and
      // the other cases cover the walk. Nothing to assert here on such a machine.
      return
    }

    const { parts, skipped } = await walkCourseFolder(root)

    expect(parts.map((part) => part.relPath)).toEqual(['inside.mp4'])
    expect(skipped.some((entry) => entry.includes('escape'))).toBe(true)
  })

  // Five hundred files is the heaviest fixture in this file by an order of magnitude, and
  // creating them is work Windows charges for. The assertions below are unchanged; only the
  // room to lay the fixture down is.
  it(
    'reports truncation rather than importing an unbounded number of files',
    HEAVY_FIXTURE,
    async () => {
      const spec: Record<string, string> = {}
      for (let i = 0; i < MAX_COURSE_FILES + 5; i += 1) {
        spec[`${String(i).padStart(4, '0')}-lesson.mp4`] = 'x'
      }
      const root = await tree(spec)

      const { parts, truncated } = await walkCourseFolder(root)

      expect(truncated).toBe(true)
      expect(parts).toHaveLength(MAX_COURSE_FILES)
    },
  )

  it('answers with nothing for a folder holding no media at all', async () => {
    // The service turns this into `EmptyCourseFolderError`, so the dialog can say "no media
    // here" rather than reporting an empty import as a success.
    const root = await tree({ 'readme.txt': 'a', 'slides.pdf': 'b' })
    const { parts } = await walkCourseFolder(root)
    expect(parts).toEqual([])
  })
})
