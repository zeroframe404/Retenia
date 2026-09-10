import type { PathDraft } from '../schemas/path-draft'
import { locateNode, withModule, withSection } from './locate'
import { PathEditError } from './types'

const MAX_TITLE_LENGTH = 200

/** Renames a section, module or core lesson. Titles are trimmed; an empty result is rejected
 *  rather than silently kept, so the tree never ends up with an invisible row. */
export function renameNode(draft: PathDraft, nodeId: string, title: string): PathDraft {
  const trimmed = title.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new PathEditError(
      'invalid_title',
      `a title must be 1–${MAX_TITLE_LENGTH} characters after trimming`,
    )
  }

  const location = locateNode(draft, nodeId)
  if (location.kind === 'section') {
    return withSection(draft, location.sectionIndex, (section) => ({ ...section, title: trimmed }))
  }
  if (location.kind === 'module') {
    return withModule(draft, location.sectionIndex, location.moduleIndex, (module) => ({
      ...module,
      title: trimmed,
    }))
  }
  const { sectionIndex, moduleIndex, lessonIndex } = location
  return withModule(draft, sectionIndex, moduleIndex, (module) => ({
    ...module,
    lessons: module.lessons.map((lesson, index) =>
      index === lessonIndex ? { ...lesson, title: trimmed } : lesson,
    ),
  }))
}
