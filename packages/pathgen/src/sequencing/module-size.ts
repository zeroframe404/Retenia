import { type GenerationWarning, warning } from '../schemas/warnings'
import { dedupeObjectives, splitEvenly } from '../validate/lessons'
import type { ModuleSpec, Objective, Outline, SectionSpec } from '../validate/types'
import type { OrderedSection } from './hierarchy'
import type { LessonRef } from './lift'

/**
 * Module sizes — `docs/spec/04-path-generation.md` §4: 3–7 lessons per module.
 *
 * On the flat, already ordered list of modules: one under the floor is merged into a
 * neighbour — the module before it when that is in the same section, else the one after it
 * when that is, else whichever neighbour exists, the previous first — and one over the
 * ceiling is split into even contiguous parts. Merging appends or prepends whole runs of
 * lessons and every split cuts an already topologically ordered list, so the global lesson
 * order — and with it every prerequisite direction — is unchanged. A section whose every
 * module went to another section disappears and is reported; a path with fewer than three
 * lessons in total is left as it is and reported instead.
 */

export interface SizedModule {
  /** The outline section the module came from — the receiver's, after a merge. */
  readonly s: number
  readonly title: string
  readonly objectives: Objective[]
  readonly lessons: LessonRef[]
}

export interface SizedLayout {
  /** Consecutive modules of one section, in order; a section that lost every module is gone. */
  readonly sections: Array<{ readonly s: number; readonly modules: SizedModule[] }>
  readonly warnings: GenerationWarning[]
}

export function fitModuleSizes(
  hierarchy: readonly OrderedSection[],
  outline: Outline,
  bounds: { readonly min: number; readonly max: number },
  maxObjectives: number,
): SizedLayout {
  const warnings: GenerationWarning[] = []

  const modules: SizedModule[] = hierarchy.flatMap((section) =>
    section.modules.map((module): SizedModule => {
      // Every ordered module came out of a section and a module of this outline.
      const spec = (outline.sections[section.s] as SectionSpec).modules[module.m] as ModuleSpec
      return {
        s: section.s,
        title: spec.title,
        objectives: [...spec.objectives],
        lessons: [...module.lessons],
      }
    }),
  )

  const total = modules.reduce((sum, module) => sum + module.lessons.length, 0)
  if (total < bounds.min) {
    if (modules.length > 0) warnings.push(warning('path_too_small', { lessons: total }))
    return { sections: group(modules), warnings }
  }

  const merge = (donor: SizedModule, receiver: SizedModule, prepend: boolean): void => {
    if (prepend) receiver.lessons.unshift(...donor.lessons)
    else receiver.lessons.push(...donor.lessons)
    const merged = dedupeObjectives([...receiver.objectives, ...donor.objectives])
    receiver.objectives.splice(0, receiver.objectives.length, ...merged.slice(0, maxObjectives))
    warnings.push(warning('module_merged', { module: donor.title, into: receiver.title }))
  }

  let index = 0
  while (index < modules.length) {
    const module = modules[index] as SizedModule
    const size = module.lessons.length

    if (size < bounds.min) {
      const previous = index > 0 ? modules[index - 1] : undefined
      const next = modules[index + 1]
      const receiver =
        previous !== undefined && previous.s === module.s
          ? previous
          : next !== undefined && next.s === module.s
            ? next
            : (previous ?? (next as SizedModule))
      if (receiver === previous) {
        merge(module, receiver, false)
        modules.splice(index, 1)
        // The receiver may now be over the ceiling: look at it again.
        index -= 1
      } else {
        merge(module, receiver, true)
        modules.splice(index, 1)
      }
      continue
    }

    if (size > bounds.max) {
      const parts = splitEvenly(module.lessons, Math.ceil(size / bounds.max))
      warnings.push(warning('module_split', { module: module.title, parts: parts.length }))
      const replacements = parts.map(
        (lessons, part): SizedModule => ({
          s: module.s,
          title: `${module.title} (${part + 1}/${parts.length})`,
          objectives: [...module.objectives],
          lessons,
        }),
      )
      modules.splice(index, 1, ...replacements)
      index += replacements.length
      continue
    }

    index += 1
  }

  const kept = new Set(modules.map((module) => module.s))
  for (const section of hierarchy) {
    if (!kept.has(section.s)) {
      warnings.push(
        warning('section_dropped', { section: (outline.sections[section.s] as SectionSpec).title }),
      )
    }
  }

  return { sections: group(modules), warnings }
}

/** Consecutive modules with the same section index become that section's modules. */
function group(modules: readonly SizedModule[]): SizedLayout['sections'] {
  const sections: Array<{ s: number; modules: SizedModule[] }> = []
  for (const module of modules) {
    const last = sections[sections.length - 1]
    if (last !== undefined && last.s === module.s) {
      last.modules.push(module)
    } else {
      sections.push({ s: module.s, modules: [module] })
    }
  }
  return sections
}
