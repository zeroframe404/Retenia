import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { buildCourseParts, type CoursePart } from '@retenia/ingest/media'
import { MEDIA_EXTENSIONS } from './detect-kind'

/**
 * Reading a course folder off disk (`docs/spec/05-ingestion-rag.md` §1: "the course index
 * (folders/modules) is already a candidate outline").
 *
 * Only the walk lives here. The *ordering* and the titles — which is where the judgement is,
 * and which decide whether a generated path has its lessons in the author's intended sequence
 * — are pure functions in `@retenia/ingest/media`, tested without a filesystem.
 *
 * Main does the walking, not the renderer: the invariant `library.addSourceFromFiles` states
 * ("main picks the file … so the renderer never names a path for the main process to open")
 * applies with more force to a directory, since a folder the renderer chose would be an
 * arbitrary read of the user's disk on the renderer's say-so.
 */

/**
 * How deep to descend.
 *
 * Three is `<course>/<section>/<lesson>` — the shape every Udemy-style export has — plus a
 * little slack. It is a bound on how much of the user's disk one dialog choice can enumerate,
 * not a statement about how courses are organised, so it errs shallow: a deeper tree imports
 * what it finds in the first three levels rather than failing.
 */
export const MAX_COURSE_DEPTH = 3

/** Enough for the longest course on Udemy, and small enough that a mis-clicked home directory
 *  stops rather than enumerating a disk. */
export const MAX_COURSE_FILES = 500

export interface CourseWalkResult {
  parts: CoursePart[]
  /** Names skipped for a reason worth telling the user about — not dotfiles or noise. */
  skipped: string[]
  /** True when the walk stopped at `MAX_COURSE_FILES`, so the UI can say the import is partial. */
  truncated: boolean
}

const MEDIA_EXTENSION_SET = new Set(MEDIA_EXTENSIONS)

function isMedia(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext !== undefined && MEDIA_EXTENSION_SET.has(ext)
}

/**
 * Every media file under `root`, ordered and titled as a course.
 *
 * Symlinks are skipped rather than followed. A symlink inside the chosen folder can point
 * anywhere — including at a directory that contains itself — so following one would turn a
 * bounded walk into an unbounded one and would let a folder the user picked read a folder they
 * did not.
 */
export async function walkCourseFolder(root: string): Promise<CourseWalkResult> {
  const files: { relPath: string }[] = []
  const skipped: string[] = []
  let truncated = false

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_COURSE_DEPTH) return

    let entries: Dirent<string>[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      skipped.push(relative(root, directory) || '.')
      return
    }

    // Sorted here only for a deterministic walk; the real ordering is `buildCourseParts`'.
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) {
        skipped.push(join(relative(root, directory), entry.name))
        continue
      }

      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!isMedia(entry.name)) {
        // A course folder is full of PDFs, subtitle files and resource zips. Those are not
        // failures and listing every one of them would drown the ones that matter.
        continue
      }
      if (files.length >= MAX_COURSE_FILES) {
        truncated = true
        return
      }
      files.push({ relPath: relative(root, full).split(sep).join('/') })
    }
  }

  await visit(root, 1)
  return { parts: buildCourseParts(files), skipped, truncated }
}
