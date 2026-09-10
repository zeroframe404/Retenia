import type { PathDraft } from '../schemas/path-draft'
import { locateNode, withModule, withSection } from './locate'

/**
 * Removes a section, module or core lesson from the tree.
 *
 * No persisted "excluded" bin: the renderer's local undo stack is what restores it within the
 * session (`docs/spec/04-path-generation.md` §13 step 3's undo stack), so `PathDraft` needs no
 * new field for this — unlike source-level exclusion (`draft.excluded`), which happens before
 * the draft exists and has nothing to undo back to.
 *
 * Removing a module's or section's last child is allowed: an empty section/module is a valid,
 * if unfinished, editing state, and `recomputeStats` reports it as zero lessons rather than
 * pretending it does not exist.
 */
export function excludeNode(draft: PathDraft, nodeId: string): PathDraft {
  const location = locateNode(draft, nodeId)

  if (location.kind === 'section') {
    return {
      ...draft,
      sections: draft.sections.filter((_section, index) => index !== location.sectionIndex),
    }
  }
  if (location.kind === 'module') {
    return withSection(draft, location.sectionIndex, (section) => ({
      ...section,
      modules: section.modules.filter((_module, index) => index !== location.moduleIndex),
    }))
  }
  const { sectionIndex, moduleIndex, lessonIndex } = location
  return withModule(draft, sectionIndex, moduleIndex, (module) => ({
    ...module,
    lessons: module.lessons.filter((_lesson, index) => index !== lessonIndex),
  }))
}
