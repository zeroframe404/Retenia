import type { CoreLessonNode, ModuleNode, PathDraft, SectionNode } from '../schemas/path-draft'
import { PathEditError } from './types'

/**
 * Where one node lives in the tree — enough to read it, replace it, or move it within its
 * parent's array, without every edit op re-deriving the same three nested loops.
 */
export type NodeLocation =
  | { readonly kind: 'section'; readonly sectionIndex: number }
  | { readonly kind: 'module'; readonly sectionIndex: number; readonly moduleIndex: number }
  | {
      readonly kind: 'lesson'
      readonly sectionIndex: number
      readonly moduleIndex: number
      readonly lessonIndex: number
    }

/** Finds a section, module or core lesson by id. Throws `node_not_found` for anything else —
 *  including a reinforcement, checkpoint or final-exam id, none of which is user-editable. */
export function locateNode(draft: PathDraft, nodeId: string): NodeLocation {
  for (let s = 0; s < draft.sections.length; s += 1) {
    const section = draft.sections[s] as SectionNode
    if (section.id === nodeId) return { kind: 'section', sectionIndex: s }
    for (let m = 0; m < section.modules.length; m += 1) {
      const module = section.modules[m] as ModuleNode
      if (module.id === nodeId) return { kind: 'module', sectionIndex: s, moduleIndex: m }
      for (let l = 0; l < module.lessons.length; l += 1) {
        if ((module.lessons[l] as CoreLessonNode).id === nodeId) {
          return { kind: 'lesson', sectionIndex: s, moduleIndex: m, lessonIndex: l }
        }
      }
    }
  }
  throw new PathEditError('node_not_found', `no section, module or lesson with id "${nodeId}"`)
}

export function getSection(draft: PathDraft, sectionIndex: number): SectionNode {
  return draft.sections[sectionIndex] as SectionNode
}

export function getModule(draft: PathDraft, sectionIndex: number, moduleIndex: number): ModuleNode {
  return getSection(draft, sectionIndex).modules[moduleIndex] as ModuleNode
}

export function getLesson(
  draft: PathDraft,
  sectionIndex: number,
  moduleIndex: number,
  lessonIndex: number,
): CoreLessonNode {
  return getModule(draft, sectionIndex, moduleIndex).lessons[lessonIndex] as CoreLessonNode
}

/** Replaces `draft.sections` at `sectionIndex` with `next(section)`'s result — the one place
 *  every op that touches a section goes through, so the rest of the draft is always a fresh
 *  shallow copy rather than a mutation of the caller's value. */
export function withSection(
  draft: PathDraft,
  sectionIndex: number,
  next: (section: SectionNode) => SectionNode,
): PathDraft {
  const sections = draft.sections.map((section, index) =>
    index === sectionIndex ? next(section) : section,
  )
  return { ...draft, sections }
}

export function withModule(
  draft: PathDraft,
  sectionIndex: number,
  moduleIndex: number,
  next: (module: ModuleNode) => ModuleNode,
): PathDraft {
  return withSection(draft, sectionIndex, (section) => ({
    ...section,
    modules: section.modules.map((module, index) =>
      index === moduleIndex ? next(module) : module,
    ),
  }))
}

export function withLessons(
  draft: PathDraft,
  sectionIndex: number,
  moduleIndex: number,
  next: (lessons: readonly CoreLessonNode[]) => CoreLessonNode[],
): PathDraft {
  return withModule(draft, sectionIndex, moduleIndex, (module) => ({
    ...module,
    lessons: next(module.lessons),
  }))
}

/** Moves the element at `fromIndex` to `toIndex`, clamped to the array's bounds. Pure — never
 *  mutates `array`. */
export function moveWithinArray<T>(array: readonly T[], fromIndex: number, toIndex: number): T[] {
  const clamped = Math.max(0, Math.min(toIndex, array.length - 1))
  if (fromIndex === clamped) return [...array]
  const copy = [...array]
  const [moved] = copy.splice(fromIndex, 1)
  copy.splice(clamped, 0, moved as T)
  return copy
}

/** Every core lesson in the draft, in reading order — sections then modules then lessons —
 *  which is also the order prerequisites are declared against. */
export function flattenCoreLessons(draft: PathDraft): CoreLessonNode[] {
  const out: CoreLessonNode[] = []
  for (const section of draft.sections) {
    for (const module of section.modules) {
      out.push(...module.lessons)
    }
  }
  return out
}
