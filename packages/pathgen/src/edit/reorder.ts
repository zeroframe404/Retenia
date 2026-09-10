import type { PathDraft } from '../schemas/path-draft'
import { flattenCoreLessons, locateNode, moveWithinArray, withModule, withSection } from './locate'

export interface ReorderResult {
  readonly draft: PathDraft
  /** A lesson's declared prerequisite now reads after the lesson itself, in the new order. */
  readonly breaksPrerequisite: boolean
}

/**
 * Whether any core lesson's `prerequisite_lesson_ids` now points at a lesson that reads
 * *after* it, in document order (sections → modules → lessons). Only lessons are checked —
 * sections and modules carry no prerequisite ids of their own, so reordering one can only ever
 * break a lesson's edge indirectly, by moving whole lessons past their prerequisite.
 */
function hasPrerequisiteBreak(draft: PathDraft): boolean {
  const lessons = flattenCoreLessons(draft)
  const positionOf = new Map(lessons.map((lesson, index) => [lesson.id, index]))
  return lessons.some((lesson, index) =>
    lesson.prerequisite_lesson_ids.some((prereqId) => {
      const prereqIndex = positionOf.get(prereqId)
      return prereqIndex !== undefined && prereqIndex >= index
    }),
  )
}

/** Moves a section, module or core lesson to `toIndex` within its own parent's array. */
export function reorderNode(draft: PathDraft, nodeId: string, toIndex: number): ReorderResult {
  const location = locateNode(draft, nodeId)

  let next: PathDraft
  if (location.kind === 'section') {
    next = { ...draft, sections: moveWithinArray(draft.sections, location.sectionIndex, toIndex) }
  } else if (location.kind === 'module') {
    next = withSection(draft, location.sectionIndex, (section) => ({
      ...section,
      modules: moveWithinArray(section.modules, location.moduleIndex, toIndex),
    }))
  } else {
    const { sectionIndex, moduleIndex, lessonIndex } = location
    next = withModule(draft, sectionIndex, moduleIndex, (module) => ({
      ...module,
      lessons: moveWithinArray(module.lessons, lessonIndex, toIndex),
    }))
  }

  return { draft: next, breaksPrerequisite: hasPrerequisiteBreak(next) }
}
