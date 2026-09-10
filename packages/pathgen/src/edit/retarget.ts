import type { PathDraft } from '../schemas/path-draft'

/** Repoints every lesson's `prerequisite_lesson_ids` entry equal to `fromId` at `toId` —
 *  what a split or a merge needs so a lesson elsewhere in the path keeps depending on
 *  *something real* once the id it named stops existing on its own. */
export function retargetPrerequisite(draft: PathDraft, fromId: string, toId: string): PathDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      modules: section.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) =>
          lesson.prerequisite_lesson_ids.includes(fromId)
            ? {
                ...lesson,
                prerequisite_lesson_ids: dedupeIds(
                  lesson.prerequisite_lesson_ids.map((id) => (id === fromId ? toId : id)),
                ),
              }
            : lesson,
        ),
      })),
    })),
  }
}

function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}
