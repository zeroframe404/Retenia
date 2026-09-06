import { describe, expect, it } from 'vitest'
import type { CourseFile } from './course'
import { buildCourseParts, courseTitle, naturalCompare } from './course'

/**
 * The course-folder outline of `docs/spec/05-ingestion-rag.md` §1 ("the course index
 * (folders/modules) is already a candidate outline"), pinned where it can be wrong without
 * looking wrong.
 *
 * A mis-ordered course does not fail: it produces a path that teaches closures before loops,
 * and every downstream stage — sequencing, prerequisites, the path map — inherits the mistake
 * as if it were the author's. Lexicographic order puts `10-scope` before `9-loops`, so that
 * exact pair is asserted directly, and the fixture is an unpadded `1-`/`9-`/`10-` export
 * because padded numbers sort correctly by accident and would exercise nothing.
 *
 * `courseTitle` is checked as much for what it must not do — title-case every word, swallow a
 * name whole, hand back an empty string — as for what it produces, since those are the
 * failures that end up as a lesson heading in front of the user.
 */

/** As the walk in main hands them over: relative paths with `/` separators, in no useful order. */
function files(...relPaths: readonly string[]): CourseFile[] {
  return relPaths.map((relPath) => ({ relPath }))
}

/**
 * A Udemy-shaped export, deliberately shuffled.
 *
 * Unpadded ordinals are what the real exports carry, and they put the 9 → 10 boundary in two
 * places at once: between the sections `9-loops` and `10-scope-and-closures`, and between two
 * lessons inside `2-getting-started`.
 */
const UDEMY_EXPORT = files(
  '2-getting-started/10-troubleshooting-the-install.mp4',
  '10-scope-and-closures/1-the-scope-chain.mp4',
  '9-loops/2-while-and-do-while.mp4',
  '1-introduction/2-what-you-will-build.mp4',
  '2-getting-started/9-your-first-script.mp4',
  '1-introduction/1-welcome.mp4',
  '9-loops/1-for-loops.mp4',
  '2-getting-started/1-installing-node.mp4',
  'course-resources.pdf',
)

/** The reading order of `UDEMY_EXPORT`: section by section, lesson by lesson. */
const READING_ORDER = [
  '1-introduction/1-welcome.mp4',
  '1-introduction/2-what-you-will-build.mp4',
  '2-getting-started/1-installing-node.mp4',
  '2-getting-started/9-your-first-script.mp4',
  '2-getting-started/10-troubleshooting-the-install.mp4',
  '9-loops/1-for-loops.mp4',
  '9-loops/2-while-and-do-while.mp4',
  '10-scope-and-closures/1-the-scope-chain.mp4',
  'course-resources.pdf',
]

describe('naturalCompare', () => {
  it('puts 9 before 10, the one pair plain string order gets backwards', () => {
    expect(naturalCompare('9-loops', '10-scope')).toBeLessThan(0)
    expect(naturalCompare('10-scope', '9-loops')).toBeGreaterThan(0)
    // The failure being prevented, spelled out: as code units '1' precedes '9', so a plain
    // comparison swaps the two sections and nothing downstream can tell.
    expect('10-scope' < '9-loops').toBe(true)
  })

  it('orders a run of 1, 2, 9, 10, 11 the way the author numbered it', () => {
    const shuffled = ['10-scope', '2-variables', '11-async', '1-intro', '9-loops']

    expect([...shuffled].sort(naturalCompare)).toEqual([
      '1-intro',
      '2-variables',
      '9-loops',
      '10-scope',
      '11-async',
    ])
  })

  it('ignores case, so a section renamed with a capital does not jump the queue', () => {
    expect(naturalCompare('Intro', 'intro')).toBe(0)
    expect(naturalCompare('appendix', 'Basics')).toBeLessThan(0)
    // Code-unit order would group every capital first: ['Basics', 'Closures', 'appendix'].
    expect(['Basics', 'appendix', 'Closures'].sort(naturalCompare)).toEqual([
      'appendix',
      'Basics',
      'Closures',
    ])
  })

  it('keeps a total order when 01 and 1 are both used for the same ordinal', () => {
    // Equal as numbers, so the spelling is the tie-break: without it the two would compare 0
    // and their order would be whatever the filesystem happened to list first.
    expect(naturalCompare('1-intro', '01-intro')).toBeLessThan(0)
    expect(naturalCompare('01-intro', '1-intro')).toBeGreaterThan(0)
    expect(naturalCompare('01-intro', '01-intro')).toBe(0)

    const mixed = ['01-intro', '001-intro', '1-intro']
    const expected = ['1-intro', '01-intro', '001-intro']
    expect([...mixed].sort(naturalCompare)).toEqual(expected)
    expect([...mixed].reverse().sort(naturalCompare)).toEqual(expected)
  })

  it('compares names that are nothing but digits as numbers', () => {
    expect(naturalCompare('9', '10')).toBeLessThan(0)
    expect(['10', '9', '1', '2'].sort(naturalCompare)).toEqual(['1', '2', '9', '10'])
    // A bare ordinal against the folder that spells it out: same number, so the shorter name
    // wins rather than the comparison ending in a tie.
    expect(naturalCompare('2', '2-variables')).toBeLessThan(0)
  })

  it('orders names with no digits alphabetically, and an empty one first', () => {
    expect(naturalCompare('appendix', 'summary')).toBeLessThan(0)
    expect(naturalCompare('summary', 'appendix')).toBeGreaterThan(0)
    expect(naturalCompare('resources', 'resources')).toBe(0)
    expect(naturalCompare('intro', 'introduction')).toBeLessThan(0)
    expect(naturalCompare('', 'appendix')).toBeLessThan(0)
  })

  it('puts a numbered name before an unnumbered one whatever the letters say', () => {
    // Loose files — a syllabus PDF, a readme — belong after the numbered syllabus, not
    // interleaved into it by their initial letter.
    expect(naturalCompare('10-scope', 'appendix')).toBeLessThan(0)
    expect(naturalCompare('course-resources.pdf', '1-introduction')).toBeGreaterThan(0)
  })
})

describe('courseTitle', () => {
  it('strips the leading ordinal in every separator style an export uses', () => {
    expect(courseTitle('01-intro.mp4')).toBe('Intro')
    expect(courseTitle('01_intro.mp4')).toBe('Intro')
    expect(courseTitle('01. intro.mp4')).toBe('Intro')
    expect(courseTitle('1) intro.mp4')).toBe('Intro')
  })

  it('drops the extension whatever it is', () => {
    expect(courseTitle('03-closures.mp4')).toBe('Closures')
    expect(courseTitle('03-closures.webm')).toBe('Closures')
    expect(courseTitle('03-slides.pdf')).toBe('Slides')
    expect(courseTitle('notes.txt')).toBe('Notes')
  })

  it('maps dashes and underscores to single spaces without touching the words', () => {
    expect(courseTitle('04-loops_and_ranges.mp4')).toBe('Loops and ranges')
    expect(courseTitle('05-error-handling_in-practice.mp4')).toBe('Error handling in practice')
    expect(courseTitle('06---advanced--topics.mp4')).toBe('Advanced topics')
  })

  it('capitalises the first letter and leaves every other one alone', () => {
    // Title-casing each word would fight `es-AR`, the default locale, where "Manejo De
    // Errores" is simply wrong; and it would flatten acronyms the author capitalised on
    // purpose.
    expect(courseTitle('07-manejo-de-errores.mp4')).toBe('Manejo de errores')
    expect(courseTitle('08-the-DOM-and-the-CSSOM.mp4')).toBe('The DOM and the CSSOM')
  })

  it('falls back to the original name instead of returning an empty string', () => {
    // A file that is nothing but its ordinal still needs a heading in the path map; an empty
    // title would render as a blank row the user cannot click on with any confidence.
    expect(courseTitle('10.mp4')).toBe('10')
    expect(courseTitle('01-.mp4')).toBe('01-')
    expect(courseTitle('.mp4')).toBe('.mp4')
  })
})

describe('buildCourseParts', () => {
  it('reads the whole export in the order a person would, across directories', () => {
    expect(buildCourseParts(UDEMY_EXPORT).map((part) => part.relPath)).toEqual(READING_ORDER)
  })

  it('numbers the parts from 0 in that reading order, not from the file names', () => {
    const parts = buildCourseParts(UDEMY_EXPORT)

    expect(parts.map((part) => part.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    // `1-for-loops.mp4` is the first lesson of its section and the seventh of the course; the
    // ordinal is the position in the course, which is what the sequencer consumes.
    expect(parts[5]).toMatchObject({ relPath: '9-loops/1-for-loops.mp4', ordinal: 5 })
  })

  it('derives the section path from the folders and titles them like lessons', () => {
    const parts = buildCourseParts(UDEMY_EXPORT)

    expect(parts.map((part) => part.sectionPath)).toEqual([
      ['Introduction'],
      ['Introduction'],
      ['Getting started'],
      ['Getting started'],
      ['Getting started'],
      ['Loops'],
      ['Loops'],
      ['Scope and closures'],
      [],
    ])
    expect(parts.map((part) => part.title)).toEqual([
      'Welcome',
      'What you will build',
      'Installing node',
      'Your first script',
      'Troubleshooting the install',
      'For loops',
      'While and do while',
      'The scope chain',
      'Course resources',
    ])
  })

  it('leaves a file at the top of the folder with no section at all', () => {
    // An empty `sectionPath` lands it in the source's root section rather than under an
    // invented heading, which is the difference between "Course resources" as a lesson of
    // section 10 and as a document of the course.
    const loose = buildCourseParts(UDEMY_EXPORT).at(-1)

    expect(loose?.relPath).toBe('course-resources.pdf')
    expect(loose?.sectionPath).toEqual([])
    expect(loose?.title).toBe('Course resources')
  })

  it('lists a nested folder outermost first', () => {
    const parts = buildCourseParts(
      files('3-modules/2-imports/1-named-imports.mp4', '3-modules/1-overview.mp4'),
    )

    expect(parts.map((part) => part.sectionPath)).toEqual([['Modules'], ['Modules', 'Imports']])
    expect(parts.map((part) => part.ordinal)).toEqual([0, 1])
  })

  it('returns nothing for a folder with no files, and never mutates its input', () => {
    const input = files('2-second.mp4', '1-first.mp4')

    expect(buildCourseParts([])).toEqual([])
    expect(buildCourseParts(input).map((part) => part.relPath)).toEqual([
      '1-first.mp4',
      '2-second.mp4',
    ])
    expect(input.map((file) => file.relPath)).toEqual(['2-second.mp4', '1-first.mp4'])
  })
})

describe('courseTitle regressions', () => {
  // Each of these was a real defect found while this sub-phase was being written, and each
  // one silently renamed a section or a lesson rather than failing — which is why they are
  // pinned rather than left to the general cases above.

  it('keeps a version number in a folder name', () => {
    // The extension pattern used to accept `.2`, so a section about React 18.2 became one
    // about "React 18". Folder names have no extension at all, which is what made it bite.
    expect(courseTitle('3-react 18.2')).toBe('React 18.2')
    expect(courseTitle('4-python 3.12')).toBe('Python 3.12')
    expect(courseTitle('05-chapter 2.1')).toBe('Chapter 2.1')
  })

  it('strips an ordinal of any length, not just three digits', () => {
    // yt-dlp names playlist items `%(playlist_index)04d`, and a three-digit cap ate the first
    // three digits and left the fourth behind: `0001-intro.mp4` became "1 intro".
    expect(courseTitle('0001-intro.mp4')).toBe('Intro')
    expect(courseTitle('20240101-standup.mp4')).toBe('Standup')
  })

  it('only strips an ordinal that is followed by a separator', () => {
    // Without that rule a title beginning with a digit lost it: `3d-transforms` became
    // "D transforms".
    expect(courseTitle('3d-transforms.mp4')).toBe('3d transforms')
    expect(courseTitle('12 angry men.mp4')).toBe('Angry men')
    expect(courseTitle('01-intro.mp4')).toBe('Intro')
  })

  it('still strips the extensions a course folder really contains', () => {
    expect(courseTitle('01-welcome.mp4')).toBe('Welcome')
    expect(courseTitle('02-setup.webm')).toBe('Setup')
    expect(courseTitle('03-audio.m4a')).toBe('Audio')
  })
})
