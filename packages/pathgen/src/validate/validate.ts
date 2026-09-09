import { type GenerationWarning, warning } from '../schemas/warnings'
import { fillCoverageGaps } from './coverage'
import { validateGraph } from './graph'
import { clampObjectives, normalizeLessons } from './lessons'
import type {
  KnowledgeGraph,
  Misconception,
  Outline,
  SectionSpec,
  ValidatedSynthesis,
  ValidationContext,
} from './types'

/**
 * The validation pass over what stage 4 produced, before stage 5 sequences it
 * (`docs/spec/04-path-generation.md` §3 stage 4: "DAG, lesson size, coverage, exclude
 * front-matter"; §5 QA gates 1 and 4).
 *
 * Every gate repairs in code and reports a warning rather than throwing: a schema failure
 * was already handled by the structured-output repair loop, and what reaches here is a
 * well-formed answer that may still be inconsistent — a cycle, a concept in two lessons, an
 * important concept in none. The warnings are the normal result; `fatal` is set only when
 * nothing survived to sequence.
 *
 * The pass is idempotent: run on its own output it emits nothing but the model's notes.
 */
export function validateSynthesis(
  graph: KnowledgeGraph,
  outline: Outline,
  ctx: ValidationContext,
): ValidatedSynthesis {
  const warnings: GenerationWarning[] = []

  // Gate 0 — the model's own notes, carried as data.
  for (const text of outline.warnings) {
    const trimmed = text.trim()
    if (trimmed !== '') warnings.push(warning('model_warning', { text: trimmed }))
  }

  // Gates 1–4.
  const validated = validateGraph(graph, ctx)
  warnings.push(...validated.warnings)

  // Gate 5.
  const lessons = normalizeLessons(outline, validated.graph, validated.dropped, ctx)
  warnings.push(...lessons.warnings)

  // Gate 6.
  const covered = fillCoverageGaps(lessons.sections, validated.graph, ctx)
  warnings.push(...covered.warnings)

  // Gate 7.
  const objectives = clampObjectives(covered.sections, validated.graph, ctx)
  warnings.push(...objectives.warnings)

  // Gate 8 — structure.
  const sections: SectionSpec[] = []
  for (const section of objectives.sections) {
    const modules = section.modules.filter((module) => {
      if (module.lesson_specs.length > 0) return true
      warnings.push(warning('module_empty', { module: module.title }))
      return false
    })
    if (modules.length === 0) {
      warnings.push(warning('section_empty', { section: section.title }))
      continue
    }
    sections.push({ title: section.title, modules })
  }

  const known = new Set(validated.graph.nodes.map((node) => node.concept_id))
  const seen = new Set<string>()
  const misconceptions: Misconception[] = []
  for (const entry of outline.misconceptions) {
    if (validated.dropped.has(entry.concept_id)) continue
    if (!known.has(entry.concept_id)) {
      warnings.push(warning('misconception_dropped', { concept_id: entry.concept_id }))
      continue
    }
    const text = entry.text.trim()
    const key = `${entry.concept_id} ${text.toLowerCase()}`
    if (text === '' || seen.has(key)) continue
    seen.add(key)
    misconceptions.push({ concept_id: entry.concept_id, text, why_wrong: entry.why_wrong.trim() })
  }

  const lessonCount = sections.reduce(
    (sum, section) =>
      sum + section.modules.reduce((inner, module) => inner + module.lesson_specs.length, 0),
    0,
  )
  const fatal = lessonCount === 0 ? warning('outline_empty') : null
  if (fatal !== null) warnings.push(fatal)

  return {
    graph: validated.graph,
    outline: { sections, misconceptions, warnings: outline.warnings },
    warnings,
    fatal,
  }
}
