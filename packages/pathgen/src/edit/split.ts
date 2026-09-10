import type { CoreLessonNode, PathDraft } from '../schemas/path-draft'
import { getModule, locateNode, withModule } from './locate'
import { retargetPrerequisite } from './retarget'
import { PathEditError } from './types'

/** Never `.` — that separator is reserved for remediation ids (`L07.r1`); a letter suffix on
 *  a plain positional id (`L07a`) cannot collide with anything a freeze or a future
 *  regeneration mints (`docs/spec/04-path-generation.md` §7's ids are `S01`/`M03`/`L07`). */
const SPLIT_SUFFIXES = ['a', 'b', 'c'] as const

export interface SplitResult {
  readonly draft: PathDraft
  readonly addedLessonIds: readonly string[]
}

/**
 * Splits one core lesson into `parts` siblings, redistributing its concepts, objectives and
 * minutes round-robin across them — a purely structural rebalance, no new AI call
 * (`docs/spec/04-path-generation.md` §13 step 2's "profundizar" only asks 8.1 for *more depth*
 * conceptually; the draft has no lesson content yet to regenerate before expansion, sub-phase
 * 8.3). Shared by `splitLesson` (a plain manual edit) and `deepenLesson`.
 *
 * The first part keeps the original lesson's own prerequisites; later parts chain off the part
 * before them, so completing the split still reads in the lesson's original order. Anything
 * elsewhere that named the original lesson as *its* prerequisite is retargeted at the last
 * part — the split lesson counts as "done" once every part is.
 */
export function splitLessonNode(draft: PathDraft, lessonId: string, parts: 2 | 3): SplitResult {
  const location = locateNode(draft, lessonId)
  if (location.kind !== 'lesson') {
    throw new PathEditError('wrong_node_kind', `"${lessonId}" is not a lesson`)
  }
  const { sectionIndex, moduleIndex, lessonIndex } = location
  const module = getModule(draft, sectionIndex, moduleIndex)
  const lesson = module.lessons[lessonIndex] as CoreLessonNode

  if (lesson.concept_ids.length < parts) {
    throw new PathEditError(
      'too_few_concepts_to_split',
      `"${lessonId}" has ${lesson.concept_ids.length} concept(s), too few to split into ${parts}`,
    )
  }

  const conceptGroups: string[][] = Array.from({ length: parts }, () => [])
  lesson.concept_ids.forEach((conceptId, index) => {
    ;(conceptGroups[index % parts] as string[]).push(conceptId)
  })

  const objectiveGroups: CoreLessonNode['objectives'][number][][] = Array.from(
    { length: parts },
    () => [],
  )
  lesson.objectives.forEach((objective, index) => {
    ;(objectiveGroups[index % parts] as CoreLessonNode['objectives']).push(objective)
  })
  const fallbackObjective = lesson.objectives[0]
  if (fallbackObjective !== undefined) {
    for (const group of objectiveGroups) {
      if (group.length === 0) group.push(fallbackObjective)
    }
  }

  const minutesPerPart = Math.max(1, Math.round(lesson.estimated_minutes / parts))

  const newLessons: CoreLessonNode[] = Array.from({ length: parts }, (_unused, index) => ({
    ...lesson,
    id: `${lessonId}${SPLIT_SUFFIXES[index]}`,
    title: `${lesson.title} (${index + 1}/${parts})`,
    concept_ids: conceptGroups[index] as string[],
    objectives: objectiveGroups[index] as CoreLessonNode['objectives'],
    estimated_minutes: minutesPerPart,
    prerequisite_lesson_ids:
      index === 0 ? lesson.prerequisite_lesson_ids : [`${lessonId}${SPLIT_SUFFIXES[index - 1]}`],
    origin: 'split',
  }))

  const withSplitLessons = withModule(draft, sectionIndex, moduleIndex, (m) => ({
    ...m,
    lessons: [
      ...m.lessons.slice(0, lessonIndex),
      ...newLessons,
      ...m.lessons.slice(lessonIndex + 1),
    ],
  }))

  const lastPartId = (newLessons.at(-1) as CoreLessonNode).id
  const retargeted = retargetPrerequisite(withSplitLessons, lessonId, lastPartId)

  return { draft: retargeted, addedLessonIds: newLessons.map((entry) => entry.id) }
}

/** The plain manual-edit form of a split (no cost projection). */
export function splitLesson(draft: PathDraft, lessonId: string, parts: 2 | 3): PathDraft {
  return splitLessonNode(draft, lessonId, parts).draft
}
