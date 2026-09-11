import { z } from 'zod'
import type { PathDraft } from '../schemas/path-draft'

/**
 * "Regenerar = new `PathSpec.version` with a per-lesson diff" (`docs/spec/04-path-generation.md`
 * §7, §13 step 6): what changed between the version being studied and the regenerated one.
 *
 * Lesson ids are positional — `L07` of v2 need not be `L07` of v1 — so lessons are paired by
 * what they teach, never by id: the pairs with the most concepts in common (Jaccard) are taken
 * first, one-to-one, ties going to path order. A pair with the same concepts is `unchanged`
 * whatever its title or position; a pair that gained or lost one is `changed`; a v2 lesson that
 * shares no concept with any v1 lesson is `added`, and a v1 lesson nothing pairs with is
 * `removed`.
 */

export const VERSION_DIFF_VERSION = 1
export const LESSON_CHANGES = ['unchanged', 'changed', 'added', 'removed'] as const
export type LessonChange = (typeof LESSON_CHANGES)[number]

export const lessonDiffSchema = z.object({
  change: z.enum(LESSON_CHANGES),
  /** The lesson in the new version; `null` for a removed one. */
  spec_id: z.string().nullable(),
  title: z.string().nullable(),
  /** The lesson it continues in the previous version; `null` for an added one. */
  previous_spec_id: z.string().nullable(),
  previous_title: z.string().nullable(),
  added_concepts: z.array(z.string()),
  removed_concepts: z.array(z.string()),
  kept_concepts: z.array(z.string()),
})
export type LessonDiff = z.infer<typeof lessonDiffSchema>

export const versionDiffSchema = z.object({
  version: z.literal(VERSION_DIFF_VERSION),
  from_version: z.number().int().min(1),
  to_version: z.number().int().min(1),
  lessons: z.array(lessonDiffSchema),
  concepts: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    kept: z.number().int().min(0),
  }),
  summary: z.object({
    unchanged: z.number().int().min(0),
    changed: z.number().int().min(0),
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
  }),
})
export type VersionDiff = z.infer<typeof versionDiffSchema>

interface DiffLesson {
  readonly specId: string
  readonly title: string
  readonly concepts: ReadonlySet<string>
}

function coreLessons(draft: PathDraft): DiffLesson[] {
  return draft.sections.flatMap((section) =>
    section.modules.flatMap((module) =>
      module.lessons.map((lesson) => ({
        specId: lesson.id,
        title: lesson.title,
        concepts: new Set(lesson.concept_ids),
      })),
    ),
  )
}

const sorted = (values: Iterable<string>): string[] => [...values].sort()

export function diffDrafts(
  previous: PathDraft,
  next: PathDraft,
  numbers: { readonly from: number; readonly to: number },
): VersionDiff {
  const before = coreLessons(previous)
  const after = coreLessons(next)

  const pairs: { next: number; prev: number; score: number; shared: number }[] = []
  for (const [i, lesson] of after.entries()) {
    for (const [j, old] of before.entries()) {
      let shared = 0
      for (const concept of lesson.concepts) if (old.concepts.has(concept)) shared += 1
      if (shared === 0) continue
      const union = lesson.concepts.size + old.concepts.size - shared
      pairs.push({ next: i, prev: j, score: shared / union, shared })
    }
  }
  pairs.sort(
    (a, b) => b.score - a.score || b.shared - a.shared || a.next - b.next || a.prev - b.prev,
  )
  const pairedNext = new Map<number, number>()
  const pairedPrev = new Set<number>()
  for (const pair of pairs) {
    if (pairedNext.has(pair.next) || pairedPrev.has(pair.prev)) continue
    pairedNext.set(pair.next, pair.prev)
    pairedPrev.add(pair.prev)
  }

  const lessons: LessonDiff[] = after.map((lesson, i) => {
    const j = pairedNext.get(i)
    const old = j === undefined ? undefined : before[j]
    if (old === undefined) {
      return {
        change: 'added',
        spec_id: lesson.specId,
        title: lesson.title,
        previous_spec_id: null,
        previous_title: null,
        added_concepts: sorted(lesson.concepts),
        removed_concepts: [],
        kept_concepts: [],
      }
    }
    const added = [...lesson.concepts].filter((concept) => !old.concepts.has(concept))
    const removed = [...old.concepts].filter((concept) => !lesson.concepts.has(concept))
    const kept = [...lesson.concepts].filter((concept) => old.concepts.has(concept))
    return {
      change: added.length === 0 && removed.length === 0 ? 'unchanged' : 'changed',
      spec_id: lesson.specId,
      title: lesson.title,
      previous_spec_id: old.specId,
      previous_title: old.title,
      added_concepts: sorted(added),
      removed_concepts: sorted(removed),
      kept_concepts: sorted(kept),
    }
  })
  for (const [j, old] of before.entries()) {
    if (pairedPrev.has(j)) continue
    lessons.push({
      change: 'removed',
      spec_id: null,
      title: null,
      previous_spec_id: old.specId,
      previous_title: old.title,
      added_concepts: [],
      removed_concepts: sorted(old.concepts),
      kept_concepts: [],
    })
  }

  const conceptsBefore = new Set(before.flatMap((lesson) => [...lesson.concepts]))
  const conceptsAfter = new Set(after.flatMap((lesson) => [...lesson.concepts]))
  const count = (change: LessonChange) => lessons.filter((entry) => entry.change === change).length
  return {
    version: VERSION_DIFF_VERSION,
    from_version: numbers.from,
    to_version: numbers.to,
    lessons,
    concepts: {
      added: sorted([...conceptsAfter].filter((concept) => !conceptsBefore.has(concept))),
      removed: sorted([...conceptsBefore].filter((concept) => !conceptsAfter.has(concept))),
      kept: [...conceptsAfter].filter((concept) => conceptsBefore.has(concept)).length,
    },
    summary: {
      unchanged: count('unchanged'),
      changed: count('changed'),
      added: count('added'),
      removed: count('removed'),
    },
  }
}
