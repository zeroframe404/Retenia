import type { GenerationConfig } from '../config/generation-config'
import { orderedSourceIds } from '../config/generation-config'
import { PATH_DRAFT_VERSION, type PathDraft } from '../schemas/path-draft'
import { dedupeWarnings, type GenerationWarning } from '../schemas/warnings'
import type { SequencedPath } from '../sequencing/types'
import type { Misconception } from '../validate/types'

/**
 * `PathDraft.v1` from the sequenced path and what the earlier stages kept beside it.
 *
 * Misconception ids are positional (`X001`…) like every other id in the draft; the freeze
 * of sub-phase 8.2 keeps them, and the item bank of 8.5 refers to them.
 */

export interface DraftSource {
  readonly id: string
  readonly title: string
}

export interface DraftInput {
  readonly sequenced: SequencedPath
  readonly misconceptions: readonly Misconception[]
  readonly excluded: readonly { readonly heading_path: string; readonly reason: string }[]
  readonly config: GenerationConfig
  readonly sources: readonly DraftSource[]
  readonly warnings: readonly GenerationWarning[]
}

export function misconceptionId(index: number): string {
  return `X${String(index + 1).padStart(3, '0')}`
}

/** The configured title, else the primary source's. */
export function draftTitle(config: GenerationConfig, sources: readonly DraftSource[]): string {
  if (config.title !== undefined) return config.title
  const primary = sources.find((source) => source.id === config.primarySourceId)
  return primary?.title ?? 'Untitled path'
}

export function buildPathDraft(input: DraftInput): PathDraft {
  const byId = new Map(input.sources.map((source) => [source.id, source]))
  return {
    version: PATH_DRAFT_VERSION,
    kind: 'draft',
    title: draftTitle(input.config, input.sources),
    language: input.config.lessonLanguage,
    target_language: input.config.targetLanguage,
    level: input.config.level,
    goal: input.config.goal,
    target_date: input.config.forExam === null ? null : input.config.forExam.date,
    sources: orderedSourceIds(input.config).map((id) => ({
      source_id: id,
      title: byId.get(id)?.title ?? id,
      primary: id === input.config.primarySourceId,
    })),
    sections: input.sequenced.sections,
    final_exam: input.sequenced.final_exam,
    misconceptions: input.misconceptions.map((entry, index) => ({
      id: misconceptionId(index),
      concept_id: entry.concept_id,
      text: entry.text,
      why_wrong: entry.why_wrong,
    })),
    excluded: input.excluded.map((entry) => ({ ...entry })),
    stats: input.sequenced.stats,
    warnings: dedupeWarnings(input.warnings),
    known_node_ids: [],
    qa_mode: input.config.qaMode,
  }
}
