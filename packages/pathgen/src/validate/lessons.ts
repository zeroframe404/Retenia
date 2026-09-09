import { BLOOM_LEVELS, type BloomLevel } from '@retenia/core'
import { compareStrings } from '../graph/order'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { type ConceptKey, compareConceptKey, conceptKey } from './keys'
import {
  DEFAULT_LESSON_LIMITS,
  type KnowledgeGraph,
  type LessonLimits,
  type LessonOrigin,
  type LessonSpec,
  type ModuleSpec,
  type Objective,
  type Outline,
  type SectionSpec,
  type ValidationContext,
} from './types'

/**
 * Gates 5 and 7 of the validation pass: the lesson specs the model proposed, made to fit.
 *
 * Gate 5 resolves concept ids (unknown ones dropped, a concept homed by an earlier lesson
 * dropped — a concept has exactly one home, because `docs/spec/04-path-generation.md` §7
 * migrates progress by `concept_id` and the spiral of stage 5 is the sanctioned way it
 * reappears), orders the ids by their place in the book, and then fixes sizes: a lesson over
 * the limit is split evenly, a lesson under it is merged into a neighbour, or borrows a
 * concept from one, or — in the one unrecoverable case — is kept and reported.
 *
 * Gate 7 does the same for objectives: deduplicated, trimmed to the limit, and padded from
 * the module or from the concept names when the model left them out.
 */

export interface LessonPosition {
  readonly section: number
  readonly module: number
  readonly lesson: number
}

/** A stable name for a lesson in a warning: its title, or its place in the outline. */
export function lessonLabel(title: string, position: LessonPosition): string {
  return title !== ''
    ? title
    : `S${position.section + 1}.M${position.module + 1}.L${position.lesson + 1}`
}

interface Draft {
  title: string
  concept_ids: string[]
  objectives: Objective[]
  estimated_minutes: number | null
  origin: LessonOrigin
}

function toLessonSpec(draft: Draft): LessonSpec {
  return {
    title: draft.title,
    concept_ids: draft.concept_ids,
    objectives: draft.objectives,
    estimated_minutes: draft.estimated_minutes,
    origin: draft.origin,
  }
}

/** `n` items into `k` contiguous groups whose sizes differ by at most one, larger first. */
export function splitEvenly<T>(items: readonly T[], groups: number): T[][] {
  const out: T[][] = []
  const base = Math.floor(items.length / groups)
  const extra = items.length % groups
  let at = 0
  for (let index = 0; index < groups; index += 1) {
    const size = base + (index < extra ? 1 : 0)
    out.push(items.slice(at, at + size))
    at += size
  }
  return out
}

export function resolveLimits(ctx: Pick<ValidationContext, 'limits'>): LessonLimits {
  return {
    conceptsPerLesson: ctx.limits?.conceptsPerLesson ?? DEFAULT_LESSON_LIMITS.conceptsPerLesson,
    objectivesPerLesson:
      ctx.limits?.objectivesPerLesson ?? DEFAULT_LESSON_LIMITS.objectivesPerLesson,
  }
}

interface SizeBounds {
  readonly min: number
  readonly max: number
}

/**
 * Sizes, one left-to-right pass. Merging backward is preferred to merging forward because
 * it never delays a concept a later lesson may depend on; borrowing is the fallback when
 * neither neighbour has room. `min` is 2 in practice: one borrowed concept is what lifts a
 * lesson of one to the floor.
 */
function fitSizes(
  drafts: Draft[],
  bounds: SizeBounds,
  compare: (a: string, b: string) => number,
  warnings: GenerationWarning[],
): Draft[] {
  const out: Draft[] = []
  let index = 0
  while (index < drafts.length) {
    const lesson = drafts[index] as Draft
    index += 1
    const size = lesson.concept_ids.length

    if (size === 0) {
      warnings.push(warning('lesson_empty', { lesson: lesson.title }))
      continue
    }
    if (size > bounds.max) {
      const parts = splitEvenly(lesson.concept_ids, Math.ceil(size / bounds.max))
      warnings.push(warning('lesson_split', { lesson: lesson.title, parts: parts.length }))
      for (const [part, ids] of parts.entries()) {
        out.push({
          ...lesson,
          title: `${lesson.title} (${part + 1}/${parts.length})`,
          concept_ids: ids,
          objectives: [...lesson.objectives],
          origin: 'split',
        })
      }
      continue
    }
    if (size >= bounds.min) {
      out.push(lesson)
      continue
    }

    const previous = out[out.length - 1]
    // The next lesson that has anything in it: an empty draft is dropped when the loop reaches
    // it, so it must not decide what happens here — a second pass would otherwise find a
    // neighbour this one never saw.
    let nextIndex = index
    while (nextIndex < drafts.length && (drafts[nextIndex] as Draft).concept_ids.length === 0) {
      nextIndex += 1
    }
    const next = drafts[nextIndex]
    if (previous !== undefined && previous.concept_ids.length + size <= bounds.max) {
      previous.concept_ids.push(...lesson.concept_ids)
      previous.objectives.push(...lesson.objectives)
      previous.origin = 'merged'
      warnings.push(warning('lesson_merged', { lesson: lesson.title, into: previous.title }))
      continue
    }
    if (next !== undefined && next.concept_ids.length + size <= bounds.max) {
      next.concept_ids.unshift(...lesson.concept_ids)
      next.objectives.unshift(...lesson.objectives)
      next.origin = 'merged'
      warnings.push(warning('lesson_merged', { lesson: lesson.title, into: next.title }))
      continue
    }
    if (previous !== undefined && previous.concept_ids.length > bounds.min) {
      const moved = previous.concept_ids.pop() as string
      lesson.concept_ids.unshift(moved)
      warnings.push(
        warning('lesson_rebalanced', {
          lesson: lesson.title,
          from: previous.title,
          concept_id: moved,
        }),
      )
      out.push(lesson)
      continue
    }
    if (next !== undefined && next.concept_ids.length > bounds.min) {
      const moved = next.concept_ids.shift() as string
      lesson.concept_ids.push(moved)
      warnings.push(
        warning('lesson_rebalanced', { lesson: lesson.title, from: next.title, concept_id: moved }),
      )
      out.push(lesson)
      continue
    }
    warnings.push(warning('lesson_too_small', { lesson: lesson.title, concepts: size }))
    out.push(lesson)
  }

  for (const lesson of out) lesson.concept_ids.sort(compare)
  return out
}

/**
 * The size fitting of gate 5, for a module whose lessons changed after it ran — the
 * coverage gate appends catch-up lessons and hands the module back through here, so a
 * validated outline is a fixed point of validation.
 */
export function fitLessonSizes(
  lessons: readonly LessonSpec[],
  graph: KnowledgeGraph,
  ctx: ValidationContext,
  warnings: GenerationWarning[],
): LessonSpec[] {
  const keys = new Map(
    graph.nodes.map((node) => [node.concept_id, conceptKey(node, ctx.sourceIds)]),
  )
  const compare = (a: string, b: string): number =>
    compareConceptKey(keys.get(a) as ConceptKey, keys.get(b) as ConceptKey)
  const drafts = lessons.map(
    (lesson): Draft => ({
      title: lesson.title,
      concept_ids: [...lesson.concept_ids],
      objectives: [...lesson.objectives],
      estimated_minutes: lesson.estimated_minutes,
      origin: lesson.origin,
    }),
  )
  return fitSizes(drafts, resolveLimits(ctx).conceptsPerLesson, compare, warnings).map(toLessonSpec)
}

export function normalizeLessons(
  outline: Outline,
  graph: KnowledgeGraph,
  dropped: ReadonlySet<string>,
  ctx: ValidationContext,
): { sections: SectionSpec[]; warnings: GenerationWarning[] } {
  const bounds = resolveLimits(ctx).conceptsPerLesson
  const warnings: GenerationWarning[] = []
  const canonical = new Map(graph.nodes.map((node) => [node.concept_id, node.canonical]))
  const keys = new Map(
    graph.nodes.map((node) => [node.concept_id, conceptKey(node, ctx.sourceIds)]),
  )
  const compare = (a: string, b: string): number =>
    compareConceptKey(keys.get(a) as ConceptKey, keys.get(b) as ConceptKey)
  const homes = new Map<string, string>()

  const sections = outline.sections.map((section, s): SectionSpec => {
    const modules = section.modules.map((module, m): ModuleSpec => {
      const drafts: Draft[] = []
      for (const [l, lesson] of module.lesson_specs.entries()) {
        const position = { section: s, module: m, lesson: l }
        const title = lesson.title.trim()
        const ids: string[] = []
        for (const id of lesson.concept_ids) {
          if (dropped.has(id) || ids.includes(id)) continue
          if (!canonical.has(id)) {
            warnings.push(
              warning('unknown_concept', { lesson: lessonLabel(title, position), concept_id: id }),
            )
            continue
          }
          const first = homes.get(id)
          if (first !== undefined) {
            warnings.push(
              warning('concept_repeated', {
                concept_id: id,
                first_lesson: first,
                lesson: lessonLabel(title, position),
              }),
            )
            continue
          }
          ids.push(id)
        }
        ids.sort(compare)

        let label = title
        if (label === '' && ids.length > 0) {
          label = canonical.get(ids[0] as string) as string
          warnings.push(warning('title_missing', { level: 'lesson', replacement: label }))
        }
        if (label === '') label = lessonLabel('', position)
        for (const id of ids) homes.set(id, label)

        drafts.push({
          title: label,
          concept_ids: ids,
          objectives: [...lesson.objectives],
          estimated_minutes: lesson.estimated_minutes,
          origin: lesson.origin,
        })
      }

      const sized = fitSizes(drafts, bounds, compare, warnings)
      let moduleTitle = module.title.trim()
      if (moduleTitle === '' && sized.length > 0) {
        moduleTitle = (sized[0] as Draft).title
        warnings.push(warning('title_missing', { level: 'module', replacement: moduleTitle }))
      }
      return {
        title: moduleTitle,
        objectives: [...module.objectives],
        lesson_specs: sized.map(toLessonSpec),
      }
    })

    let sectionTitle = section.title.trim()
    const titled = modules.find((module) => module.title !== '')
    if (sectionTitle === '' && titled !== undefined) {
      sectionTitle = titled.title
      warnings.push(warning('title_missing', { level: 'section', replacement: sectionTitle }))
    }
    return { title: sectionTitle, modules }
  })

  return { sections, warnings }
}

/** Highest Bloom level among the concepts, `understand` when there are none. */
export function highestBloom(graph: KnowledgeGraph, conceptIds: readonly string[]): BloomLevel {
  const targets = new Map(graph.nodes.map((node) => [node.concept_id, node.bloom_target]))
  let best = -1
  for (const id of conceptIds) {
    const target = targets.get(id)
    if (target === undefined) continue
    best = Math.max(best, BLOOM_LEVELS.indexOf(target))
  }
  return best < 0 ? 'understand' : (BLOOM_LEVELS[best] as BloomLevel)
}

function isBloom(value: string): value is BloomLevel {
  return (BLOOM_LEVELS as readonly string[]).includes(value)
}

/** Trimmed, non-empty, one per text (case-insensitive), with a valid Bloom level. */
export function dedupeObjectives(objectives: readonly Objective[]): Objective[] {
  const seen = new Set<string>()
  const out: Objective[] = []
  for (const objective of objectives) {
    const text = objective.text.trim()
    const key = text.toLowerCase()
    if (text === '' || seen.has(key)) continue
    seen.add(key)
    out.push({ text, bloom: isBloom(objective.bloom) ? objective.bloom : 'understand' })
  }
  return out
}

export function clampObjectives(
  sections: readonly SectionSpec[],
  graph: KnowledgeGraph,
  ctx: ValidationContext,
): { sections: SectionSpec[]; warnings: GenerationWarning[] } {
  const { max } = resolveLimits(ctx).objectivesPerLesson
  const warnings: GenerationWarning[] = []
  const canonical = new Map(graph.nodes.map((node) => [node.concept_id, node.canonical]))

  const out = sections.map(
    (section): SectionSpec => ({
      title: section.title,
      modules: section.modules.map((module): ModuleSpec => {
        const moduleObjectives = dedupeObjectives(module.objectives)
        const lessons = module.lesson_specs.map((lesson): LessonSpec => {
          const unique = dedupeObjectives(lesson.objectives)
          let objectives = unique
          if (unique.length > max) {
            objectives = unique.slice(0, max)
            warnings.push(
              warning('objectives_trimmed', {
                level: 'lesson',
                title: lesson.title,
                dropped: unique.length - max,
              }),
            )
          }
          if (objectives.length === 0) {
            const fallback = moduleObjectives[0] ?? {
              text: lesson.concept_ids.map((id) => canonical.get(id) as string).join(', '),
              bloom: highestBloom(graph, lesson.concept_ids),
            }
            objectives = [fallback]
            warnings.push(warning('objectives_padded', { level: 'lesson', title: lesson.title }))
          }
          return { ...lesson, objectives }
        })

        let objectives = moduleObjectives
        if (moduleObjectives.length > max) {
          objectives = moduleObjectives.slice(0, max)
          warnings.push(
            warning('objectives_trimmed', {
              level: 'module',
              title: module.title,
              dropped: moduleObjectives.length - max,
            }),
          )
        }
        if (objectives.length === 0 && lessons.length > 0) {
          objectives = dedupeObjectives(
            lessons.map((lesson) => lesson.objectives[0] as Objective),
          ).slice(0, max)
          warnings.push(warning('objectives_padded', { level: 'module', title: module.title }))
        }
        return { title: module.title, objectives, lesson_specs: lessons }
      }),
    }),
  )

  return { sections: out, warnings }
}

/** Sorted copy of ids by their place in the book, for callers outside this file. */
export function sortConceptIds(
  ids: readonly string[],
  graph: KnowledgeGraph,
  sourceIds: readonly string[],
): string[] {
  const keys = new Map(graph.nodes.map((node) => [node.concept_id, conceptKey(node, sourceIds)]))
  return [...ids].sort((a, b) => {
    const ka = keys.get(a)
    const kb = keys.get(b)
    if (ka !== undefined && kb !== undefined) return compareConceptKey(ka, kb)
    // Unknown concepts sort after every known one, by id — a total order, so the sort is
    // well defined whatever mix it is handed.
    if (ka !== undefined) return -1
    if (kb !== undefined) return 1
    return compareStrings(a, b)
  })
}
