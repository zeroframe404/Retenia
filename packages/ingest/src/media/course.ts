/**
 * Reading a course folder as an outline (`docs/spec/05-ingestion-rag.md` §1: "the course index
 * (folders/modules) is already a candidate outline").
 *
 * A Udemy-style export is a directory of numbered folders of numbered files —
 * `01-intro/01-welcome.mp4` — and that numbering is the author's own syllabus. Preserving it
 * is most of what makes a course worth importing as one source instead of forty: sub-phase
 * 8.1 reads this section tree as the candidate outline rather than asking a model to invent
 * one from the transcripts.
 *
 * Everything here is a pure function over relative paths, so the walk that produces them
 * (which needs `node:fs` and lives in main) can be tested separately from the ordering and
 * titling rules, which are where the judgement is.
 */

/**
 * Orders two names the way a person reading a file list would.
 *
 * Lexicographic ordering puts `10-scope` before `9-loops`, which silently reverses two
 * lessons of a course — a mistake that survives all the way into the generated path, where it
 * looks like a content bug rather than a sorting one. So digit runs are compared as numbers
 * and everything else case-insensitively.
 *
 * Leading zeros are deliberately not significant (`01` and `1` compare equal as numbers) but
 * break the tie afterwards, so an author who mixes `01-` and `1-` still gets a stable order
 * instead of one that depends on directory-read order.
 */
export function naturalCompare(left: string, right: string): number {
  const chunks = (value: string): string[] => value.match(/\d+|\D+/g) ?? []
  const a = chunks(left)
  const b = chunks(right)

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1

    const xNum = /^\d/.test(x)
    const yNum = /^\d/.test(y)
    if (xNum && yNum) {
      const diff = Number.parseInt(x, 10) - Number.parseInt(y, 10)
      if (diff !== 0) return diff < 0 ? -1 : 1
      // Same value, different spelling (`01` vs `1`): shorter first, so the order is total.
      if (x.length !== y.length) return x.length - y.length
      continue
    }
    if (xNum !== yNum) return xNum ? -1 : 1

    const diff = x.localeCompare(y, undefined, { sensitivity: 'base' })
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * `01-getting-started.mp4` → `Getting started`.
 *
 * The leading ordinal is stripped because it is positional information the section tree
 * already carries; leaving it in every title would mean every lesson heading in the generated
 * path starts with a number that duplicates its position. Separators become spaces, and only
 * the first letter is capitalised — title-casing every word would fight languages that do not
 * do that, and `es-AR` is the default locale.
 */
export function courseTitle(name: string): string {
  // The extension must *start with a letter*. `\.[a-z0-9]{1,5}$` also matches the tail of a
  // version number, and this function runs over folder names as well as file names — so
  // `3-react 18.2/` became "React 18" and `4-python 3.12/` became "Python 3", quietly
  // renaming the section to something about a different subject.
  const withoutExtension = name.replace(/\.[a-z][a-z0-9]{0,4}$/i, '')
  // The ordinal needs an explicit separator after it, and may be any number of digits.
  // Without the separator, `3d-transforms.mp4` lost its leading digit and became
  // "D transforms"; capped at three digits, yt-dlp's `%(playlist_index)04d` naming turned
  // `0001-intro.mp4` into "1 intro" — eating part of the number instead of all of it.
  const withoutOrdinal = withoutExtension.replace(/^\s*\d+(?:\s*[-_.)\]]+\s*|\s+)/, '')
  const spaced = withoutOrdinal.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chosen = spaced.length > 0 ? spaced : withoutExtension.trim()
  if (chosen.length === 0) return name
  return chosen.charAt(0).toUpperCase() + chosen.slice(1)
}

export interface CourseFile {
  /** Path relative to the chosen folder, with `/` separators. */
  relPath: string
}

export interface CoursePart {
  relPath: string
  /** The lesson's own title. */
  title: string
  /** Folder titles from the root down, outermost first. Empty for a file at the top level. */
  sectionPath: readonly string[]
  ordinal: number
}

/**
 * Orders the files of a course and derives a title and a section path for each.
 *
 * Directories sort before their contents at each level, so the walk order is the reading
 * order: every lesson of section 1, then every lesson of section 2. A file sitting loose at
 * the top of the folder gets an empty `sectionPath` and lands in the source's root section
 * rather than being forced under an invented heading.
 */
export function buildCourseParts(files: readonly CourseFile[]): CoursePart[] {
  const sorted = [...files].sort((left, right) => {
    const a = left.relPath.split('/')
    const b = right.relPath.split('/')
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const x = a[i]
      const y = b[i]
      if (x === undefined) return -1
      if (y === undefined) return 1
      // A directory segment (one with more segments after it) sorts before a file segment at
      // the same depth only when the names tie; otherwise natural order decides.
      const diff = naturalCompare(x, y)
      if (diff !== 0) return diff
    }
    return 0
  })

  return sorted.map((file, index) => {
    const segments = file.relPath.split('/')
    const name = segments.at(-1) as string
    return {
      relPath: file.relPath,
      title: courseTitle(name),
      sectionPath: segments.slice(0, -1).map(courseTitle),
      ordinal: index,
    }
  })
}
