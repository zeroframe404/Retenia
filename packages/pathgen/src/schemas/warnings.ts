import { z } from 'zod'

/**
 * Everything a generation run can warn about, as data.
 *
 * A warning is `{ code, stage, params }` and never prose: the wizard of sub-phase 8.2
 * renders it through i18n by `code` (`pathgen.warning.<code>` in `packages/i18n`), the
 * manifest stores it, and a test can assert on it. The one piece of free text is the
 * model's own note (`model_warning`), which arrives already written in the path's language
 * and travels in `params.text`.
 *
 * One list, so that `guards.test.ts` can check every code is produced somewhere and none is
 * dead, and so the i18n parity check has one vocabulary to cover.
 */

export const WARNING_STAGES = [
  'extract',
  'consolidate',
  'synthesize',
  'validate',
  'sequence',
  'expand',
  'qa',
  'item_bank',
] as const
export type WarningStage = (typeof WARNING_STAGES)[number]

/** Which stage raises each code. The code alone identifies the stage. */
export const WARNING_STAGE_OF = {
  // Stage 3 — extraction.
  chunk_failed: 'extract',
  injection_suspected: 'extract',
  budget_paused: 'extract',
  /** The run has a cap but a role's model has no price, so the cap cannot be enforced. */
  estimate_unpriced: 'extract',
  // Consolidation.
  embeddings_unavailable: 'consolidate',
  // Stage 4 — synthesis.
  chunk_excluded: 'synthesize',
  model_warning: 'synthesize',
  unknown_node: 'synthesize',
  /** `looksLikeInjection` fired on the prefix or on a module's definitions; processed anyway. */
  synthesis_injection_suspected: 'synthesize',
  // Validation of the graph and the outline.
  duplicate_node: 'validate',
  unknown_chunk_ref: 'validate',
  frontmatter_excluded: 'validate',
  concept_without_sources: 'validate',
  dangling_edge: 'validate',
  self_loop: 'validate',
  cycle_broken: 'validate',
  title_missing: 'validate',
  unknown_concept: 'validate',
  concept_repeated: 'validate',
  lesson_empty: 'validate',
  lesson_split: 'validate',
  lesson_merged: 'validate',
  lesson_rebalanced: 'validate',
  lesson_too_small: 'validate',
  coverage_gap: 'validate',
  objectives_trimmed: 'validate',
  objectives_padded: 'validate',
  module_empty: 'validate',
  section_empty: 'validate',
  misconception_dropped: 'validate',
  outline_empty: 'validate',
  // Stage 5 — sequencing.
  section_cycle_broken: 'sequence',
  module_cycle_broken: 'sequence',
  lesson_cycle_broken: 'sequence',
  narrative_reordered: 'sequence',
  module_split: 'sequence',
  module_merged: 'sequence',
  /** Every module of a section was merged into another section's. */
  section_dropped: 'sequence',
  path_too_small: 'sequence',
  exam_date_overshoot: 'sequence',
  // Stage 7 - expansion (sub-phase 8.3).
  /** P3, P4 or P5 failed for one lesson. The run continues; the lesson is `failed`. */
  lesson_failed: 'expand',
  /** Retrieval hits dropped to fit the lesson's source budget. Mapped chunks never are. */
  lesson_context_trimmed: 'expand',
  /** `looksLikeInjection` fired on a lesson's own sources or on the theory P3 wrote. */
  expansion_injection_suspected: 'expand',
  /** Cite ids the model used that resolve to no fragment; dropped from the block. */
  citation_unresolved: 'expand',
  /** A substantive block left with no resolving citation, retyped to `general_knowledge`. */
  lesson_block_uncited: 'expand',
  /** A generated candidate that `checkActivity` refused, with the rule it broke. */
  activity_rejected: 'expand',
  /** `composeLessonPractice` could not satisfy a variety rule with the pool it was given. */
  practice_incomplete: 'expand',
  /** A flashcard dropped as a duplicate of one the path already has. */
  flashcard_deduped: 'expand',
  /** A chunk reached the model cut to `MAX_CHUNK_CHARS`, while still offering every one of its
   *  block ids as citable — so a claim from the cut tail can cite a block nothing read. */
  lesson_fragment_truncated: 'expand',
  /** The mapped chunks alone exceed the lesson's source budget. Nothing is dropped — they are
   *  what sequencing decided the lesson is about — so this is what says the call ran long. */
  lesson_context_over_budget: 'expand',
  /** Fewer than the three cards §4 item 9 asks for survived. Legitimate for a lesson made of
   *  §1.3 material, and worth saying either way rather than padding to a quota. */
  flashcards_thin: 'expand',
  /** A card whose cite ids resolved to no fragment, so it stores no source (§1.2 rule 18). */
  flashcard_uncited: 'expand',
  // Stage 8 — the QA gates (sub-phase 8.4, §5).
  /** Gate 2: a quoted span was not in the cited chunk at ≥ 0.85; the sentence lost its markers. */
  citation_span_mismatch: 'qa',
  /** Gate 3 / §7: a claim cites two sources that disagree with each other; both are shown. */
  sources_differ: 'qa',
  /** Gate 3: faithfulness in the 0.7–0.9 band with no editor to fix it (light mode). */
  faithfulness_needs_review: 'qa',
  /** Gate 4: a concept of importance ≥ 0.5 the lesson was told to teach and never names. */
  concept_uncovered: 'qa',
  /** Gate 5: an exercise that asks what another lesson's exercise asks. */
  activity_duplicate: 'qa',
  /** Gate 5: a card that asks what another lesson's card asks. */
  flashcard_duplicate: 'qa',
  /** Gate 6: fewer than three Bloom levels across the module's practice. */
  module_bloom_variety: 'qa',
  /** Gate 7: the theory is outside §4's 600–1,200 words. */
  theory_length: 'qa',
  /** Gate 8: the prose is not in the lesson's language. */
  language_mismatch: 'qa',
  /** Gate 8: a translated glossary term used in its source-language form outside a quotation. */
  glossary_term_mixed: 'qa',
  /** Gate 9: the judge role resolves to the model that wrote the lesson (§14 pitfall 16); skipped. */
  judge_same_as_generator: 'qa',
  /** Gate 9: no judge role is configured; skipped. */
  judge_unavailable: 'qa',
  /** Gate 10: P8 returned a change that touched a citation; the original block was kept. */
  edit_rejected: 'qa',
  /** A lesson under §5's thresholds was sent back to P3 once. */
  lesson_regenerated: 'qa',
  /** A lesson under §5's thresholds after the one regeneration allowed; flagged for the user. */
  lesson_below_threshold: 'qa',
  /** P6, P7 or P8 failed for one lesson. The lesson is `ready`, flagged, and not reviewed. */
  qa_failed: 'qa',
  // Stage 9 — the item bank (sub-phase 8.5).
  /** A P9 item that `checkActivity`, `mcqIssue` or the NBME rules refused, with the rule. */
  item_rejected: 'item_bank',
  /** A P9 item that asks what a lesson's exercise or another item asks (cosine > 0.92). */
  item_duplicate: 'item_bank',
  /** A blueprint cell kept fewer items than it wanted once the rejects were filtered out. */
  item_bank_cell_short: 'item_bank',
  /** P9 failed for one cell. The rest of the bank is built; the cell is retried next time. */
  item_bank_cell_failed: 'item_bank',
  /** `looksLikeInjection` fired on the excerpts, the concepts or the stems a cell was given. */
  item_bank_injection_suspected: 'item_bank',
  /** A bank item dropped (or kept for the diagnostic only) because an expanded lesson asks it. */
  item_bank_reconciled: 'item_bank',
} as const satisfies Record<string, WarningStage>

export type WarningCode = keyof typeof WARNING_STAGE_OF

export const WARNING_CODES = Object.keys(WARNING_STAGE_OF) as WarningCode[]

/** JSON-shaped on purpose: what a warning carries has to survive `generation_runs.warnings`. */
export type WarningParam = string | number | string[]

export interface GenerationWarning {
  readonly code: WarningCode
  readonly stage: WarningStage
  readonly params: Readonly<Record<string, WarningParam>>
}

export const generationWarningSchema = z.object({
  code: z.enum(WARNING_CODES as [WarningCode, ...WarningCode[]]),
  stage: z.enum(WARNING_STAGES),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])),
})

/** One warning, with its stage looked up from the code so the two can never disagree. */
export function warning(
  code: WarningCode,
  params: Readonly<Record<string, WarningParam>> = {},
): GenerationWarning {
  return { code, stage: WARNING_STAGE_OF[code], params }
}

/** The same warning raised twice (same code and params) is reported once. */
export function dedupeWarnings(warnings: readonly GenerationWarning[]): GenerationWarning[] {
  const seen = new Set<string>()
  const out: GenerationWarning[] = []
  for (const entry of warnings) {
    const key = `${entry.code}\0${JSON.stringify(entry.params)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}
