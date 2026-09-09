import { createHash } from 'node:crypto'
import type { SanitizeLimits } from '@retenia/ai'
import { DEFAULT_SANITIZE_LIMITS, wrapUserContent } from '@retenia/ai'
import type { GenerationConfig } from '../config/generation-config'
import type { ConsolidatedConcept } from '../consolidate'
import { PATHGEN_PROMPT_IDS } from '../prompts'
import { headerLine, oneLine } from '../text'
import type { Objective } from '../validate/types'
import type { TocSource } from './inputs'

/**
 * The volatile half of each P2 call — what `{{task}}` receives after the cached prefix.
 *
 * The header of a task carries only what is ours or the learner's own instruction: the
 * module's place, the concept ids, the goal and level typed into the wizard. Everything that
 * came out of a document or out of the model's reading of one — source titles, the selected
 * headings, section and module titles, objectives, definitions — travels inside a
 * `<user_content>` block, so that a title the outline call wrote from a chapter heading can
 * never reach the module call at instruction level.
 */

export const OUTLINE_STAGE = PATHGEN_PROMPT_IDS.outline
export const MODULE_STAGE = PATHGEN_PROMPT_IDS.module
/** ~400 concepts of graph plus a skeleton is ~17k tokens; the ceiling leaves room to spare. */
export const OUTLINE_MAX_OUTPUT_TOKENS = 32_000
export const MODULE_MAX_OUTPUT_TOKENS = 6_000
/** The default 500 would silently truncate a 1,500-edge graph. */
export const OUTLINE_SANITIZE_LIMITS: SanitizeLimits = Object.freeze({
  ...DEFAULT_SANITIZE_LIMITS,
  maxArrayItems: 2_000,
})
export const DEFAULT_MODULE_CONCURRENCY = 3

/** A task, with `looksLikeInjection`'s verdict on the material it wraps. */
export interface Task {
  readonly text: string
  readonly injectionSuspected: boolean
}

export function describeScope(scope: GenerationConfig['scope']): string {
  if (scope.kind === 'all') return 'all'
  return `selected: ${scope.headingPaths.map((path) => `"${oneLine(path, 200)}"`).join('; ')}`
}

export function buildOutlineTask(
  config: GenerationConfig,
  sources: readonly TocSource[],
  concepts: { readonly included: number; readonly omitted: number },
): Task {
  const primary = sources.find((source) => source.primary)
  const others = sources.filter((source) => !source.primary)
  const block = wrapUserContent(
    [
      `primary_source: ${primary === undefined ? '(unknown)' : `"${oneLine(primary.title, 120)}"`}`,
      `other_sources: ${others.length === 0 ? 'none' : others.map((source) => `"${oneLine(source.title, 120)}"`).join(', ')}`,
      `scope: ${describeScope(config.scope)}`,
    ].join('\n'),
    'sources',
  )
  return {
    text: [
      '## Configuration',
      `goal: ${headerLine(config.goal, 500)}`,
      `level: ${headerLine(config.level, 60)}`,
      `lesson_language: ${config.lessonLanguage}`,
      `exam_date: ${config.forExam === null ? 'none' : config.forExam.date}`,
      `pace_hours_per_week: ${config.paceHoursPerWeek}`,
      `concepts: ${concepts.included} listed` +
        (concepts.omitted > 0 ? `, ${concepts.omitted} of lower importance not listed` : ''),
      '',
      block.text,
      '',
      'Propose the knowledge graph and the skeleton for this configuration. Write every title,',
      'objective, reason and warning in the lesson language.',
    ].join('\n'),
    injectionSuspected: block.injectionSuspected,
  }
}

export type ModuleConcept = Pick<
  ConsolidatedConcept,
  'concept_id' | 'canonical' | 'definition' | 'kind' | 'importance' | 'difficulty'
>

export interface ModuleTaskInput {
  readonly sectionIndex: number
  readonly sectionCount: number
  readonly sectionTitle: string
  readonly moduleIndex: number
  readonly moduleCount: number
  readonly moduleTitle: string
  readonly objectives: readonly Objective[]
  readonly concepts: readonly ModuleConcept[]
  readonly config: Pick<GenerationConfig, 'lessonLanguage' | 'level' | 'goal'>
}

export function buildModuleTask(input: ModuleTaskInput): Task {
  const module = wrapUserContent(
    [
      `section_title: ${oneLine(input.sectionTitle, 160)}`,
      `module_title: ${oneLine(input.moduleTitle, 160)}`,
      'objectives:',
      ...(input.objectives.length === 0
        ? ['- (none proposed)']
        : input.objectives.map(
            (objective) => `- (${objective.bloom}) ${oneLine(objective.text, 300)}`,
          )),
    ].join('\n'),
    'module',
  )
  const definitions = wrapUserContent(
    input.concepts.length === 0
      ? '(no definitions)'
      : input.concepts
          .map(
            (concept) =>
              `${concept.concept_id} — ${oneLine(concept.canonical, 120)} (${concept.kind}, ` +
              `importance ${concept.importance.toFixed(2)}, difficulty ${concept.difficulty}): ` +
              oneLine(concept.definition, 600),
          )
          .join('\n'),
    'definitions',
  )
  return {
    text: [
      '## Module',
      `section: ${input.sectionIndex + 1} of ${input.sectionCount}`,
      `module: ${input.moduleIndex + 1} of ${input.moduleCount}`,
      `concept_ids: ${input.concepts.map((concept) => concept.concept_id).join(', ')}`,
      '',
      module.text,
      '',
      definitions.text,
      '',
      `lesson_language: ${input.config.lessonLanguage}`,
      `level: ${headerLine(input.config.level, 60)}`,
      `goal: ${headerLine(input.config.goal, 500)}`,
      '',
      'Split this module into lessons and list the misconceptions its concepts attract, in the',
      'lesson language.',
    ].join('\n'),
    injectionSuspected: module.injectionSuspected || definitions.injectionSuspected,
  }
}

/** What a module task can be read back as — the fixture book's scripted model needs it. */
export interface ParsedModuleTask {
  readonly sectionIndex: number
  readonly moduleIndex: number
  readonly moduleTitle: string
  readonly conceptIds: string[]
}

export function parseModuleTask(prompt: string): ParsedModuleTask | undefined {
  const section = /^section: (\d+) of \d+$/m.exec(prompt)
  const module = /^module: (\d+) of \d+$/m.exec(prompt)
  const title = /^module_title: (.*)$/m.exec(prompt)
  const ids = /^concept_ids: (.*)$/m.exec(prompt)
  if (section === null || module === null || title === null || ids === null) return undefined
  return {
    sectionIndex: Number(section[1]) - 1,
    moduleIndex: Number(module[1]) - 1,
    moduleTitle: title[1] as string,
    conceptIds: (ids[1] as string)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  }
}

/**
 * The second half of a module call's `custom_id`: the module's place, its title and the
 * set of concepts it was asked about. Order-insensitive over the ids, because it is a set.
 */
export function moduleKey(
  sectionIndex: number,
  moduleIndex: number,
  title: string,
  conceptIds: readonly string[],
): string {
  return createHash('sha256')
    .update(`${sectionIndex}:${moduleIndex}:${title}:${[...conceptIds].sort().join(',')}`, 'utf8')
    .digest('hex')
}
