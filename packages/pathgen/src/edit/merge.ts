import type { CoreLessonNode, PathDraft } from '../schemas/path-draft'
import { dedupe, dedupeBy } from './collections'
import { getModule, locateNode, withModule } from './locate'
import { retargetPrerequisite } from './retarget'
import { PathEditError } from './types'

/**
 * Merges two or more core lessons of the same module into one — the inverse of `splitLesson`.
 * Concepts, objectives and source refs are unioned (first occurrence wins, no reordering);
 * minutes are summed; prerequisites are the union of every merged lesson's own, minus the
 * merged lessons themselves (a lesson cannot depend on part of itself). The surviving lesson
 * keeps the first merged lesson's id and position; anything elsewhere that depended on one of
 * the other merged lessons is retargeted at the survivor.
 */
export function mergeLessons(draft: PathDraft, lessonIds: readonly string[]): PathDraft {
  if (lessonIds.length < 2) {
    throw new PathEditError('lessons_not_in_same_module', 'merging needs at least two lessons')
  }

  const located = lessonIds.map((id) => ({ id, location: locateNode(draft, id) }))
  const anchor = located[0]?.location
  if (anchor === undefined || anchor.kind !== 'lesson') {
    throw new PathEditError('wrong_node_kind', `"${lessonIds[0]}" is not a lesson`)
  }
  const { sectionIndex, moduleIndex } = anchor
  for (const { id, location } of located) {
    if (
      location.kind !== 'lesson' ||
      location.sectionIndex !== sectionIndex ||
      location.moduleIndex !== moduleIndex
    ) {
      throw new PathEditError(
        'lessons_not_in_same_module',
        `"${id}" is not in the same module as "${lessonIds[0]}"`,
      )
    }
  }

  const module = getModule(draft, sectionIndex, moduleIndex)
  const idSet = new Set(lessonIds)
  const merged = module.lessons.filter((lesson) => idSet.has(lesson.id))
  const survivor = merged[0] as CoreLessonNode

  const mergedInto: CoreLessonNode = {
    ...survivor,
    concept_ids: dedupe(merged.flatMap((lesson) => lesson.concept_ids)),
    objectives: dedupeBy(
      merged.flatMap((lesson) => lesson.objectives),
      (objective) => objective.text,
    ),
    source_refs: dedupeBy(
      merged.flatMap((lesson) => lesson.source_refs),
      (ref) => `${ref.chunk_id}:${ref.ordinal}`,
    ),
    prerequisite_lesson_ids: dedupe(
      merged.flatMap((lesson) => lesson.prerequisite_lesson_ids).filter((id) => !idSet.has(id)),
    ),
    estimated_minutes: merged.reduce((sum, lesson) => sum + lesson.estimated_minutes, 0),
    origin: 'merged',
  }

  let next = withModule(draft, sectionIndex, moduleIndex, (m) => ({
    ...m,
    lessons: m.lessons
      .filter((lesson) => !idSet.has(lesson.id) || lesson.id === survivor.id)
      .map((lesson) => (lesson.id === survivor.id ? mergedInto : lesson)),
  }))

  for (const lessonId of lessonIds) {
    if (lessonId === survivor.id) continue
    next = retargetPrerequisite(next, lessonId, survivor.id)
  }
  return next
}
