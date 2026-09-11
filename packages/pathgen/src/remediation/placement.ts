import type { LessonKind } from '@retenia/core'
import type { Placement } from './types'

/**
 * Where a detour goes (`docs/spec/04-path-generation.md` §11: "immediately after the current
 * lesson (or before the first lesson that depends on the concept)").
 *
 * The path map has no cursor of its own, so "current" is read the way the map will draw it:
 * the learner stands at the first core lesson they have not completed. From there —
 *
 * 1. an explicit lesson (the lesson player's "no lo entiendo") is the current lesson: the
 *    detour goes right after it; asked from a reinforcement or checkpoint, it goes after the
 *    last core lesson before that node; asked from a detour, after that detour's anchor;
 * 2. a concept not yet taught gets its detour right after the lesson that will teach it — the
 *    anticipated remediation of §10's figure, for a misconception the diagnostic caught early;
 * 3. when the lesson the learner is about to take depends on the concept, the detour goes
 *    **before** it — that is the "before the first lesson that depends on the concept" case;
 * 4. otherwise it goes right after the lesson the learner last completed;
 * 5. and on a finished path, after the lesson that teaches the concept.
 *
 * Nothing is renumbered: the detour hangs off an anchor and says which side of it it sits on.
 */

export interface PlacementLesson {
  readonly id: string
  readonly specId: string
  readonly moduleId: string
  readonly kind: LessonKind
  readonly parentLessonId: string | null
  readonly conceptIds: readonly string[]
  readonly prerequisiteLessonIds: readonly string[]
  readonly completed: boolean
}

export function placeRemediation(input: {
  /** Every lesson of the version, in path order (section, module, ordinal). */
  readonly lessons: readonly PlacementLesson[]
  readonly conceptId: string
  readonly lessonId: string | null
}): Placement | null {
  const cores = input.lessons.filter((lesson) => lesson.kind === 'core')
  if (cores.length === 0) return null
  const teaching = cores.find((lesson) => lesson.conceptIds.includes(input.conceptId))
  const teachingLessonId = teaching?.id ?? null
  const at = (lesson: PlacementLesson, position: Placement['position']): Placement => ({
    anchorLessonId: lesson.id,
    anchorSpecId: lesson.specId,
    moduleId: lesson.moduleId,
    position,
    teachingLessonId,
  })

  if (input.lessonId !== null) {
    const explicit = input.lessons.find((lesson) => lesson.id === input.lessonId)
    if (explicit !== undefined) {
      if (explicit.kind === 'core') return at(explicit, 'after')
      if (explicit.kind === 'remediation' && explicit.parentLessonId !== null) {
        const parent = cores.find((lesson) => lesson.id === explicit.parentLessonId)
        if (parent !== undefined) return at(parent, 'after')
      }
      const index = input.lessons.indexOf(explicit)
      const before = input.lessons
        .slice(0, index)
        .reverse()
        .find((lesson) => lesson.kind === 'core' && lesson.moduleId === explicit.moduleId)
      if (before !== undefined) return at(before, 'after')
    }
  }

  if (teaching !== undefined && !teaching.completed) return at(teaching, 'after')

  const current = cores.find((lesson) => !lesson.completed)
  if (current === undefined)
    return at(teaching ?? (cores[cores.length - 1] as PlacementLesson), 'after')

  const dependsOnConcept =
    current.conceptIds.includes(input.conceptId) ||
    (teaching !== undefined && current.prerequisiteLessonIds.includes(teaching.specId))
  if (dependsOnConcept) return at(current, 'before')

  const index = cores.indexOf(current)
  const last = index > 0 ? cores[index - 1] : undefined
  return last === undefined ? at(current, 'before') : at(last, 'after')
}
