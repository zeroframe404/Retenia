import { isSubstantive, type TheoryBlock } from '../../schemas/lesson'
import { warning } from '../../schemas/warnings'
import { stripMarkers } from '../claims'
import { normalizeForMatch, QUOTED_SPAN } from '../fuzzy'
import type { QaFinding, QaMode } from '../lesson-qa'
import { clip, type EditInstruction, type GateResult, gateResult } from './types'

/**
 * Gate (h) — §5 gate 8: *"Language / glossary: consistent language and glossary terms"*
 * (§14 pitfall 13: "mixing languages in terms").
 *
 * Two halves. **The language of the prose**: the substantive blocks, quotations removed
 * (a verbatim quote in the source's language is what §7 asks for), through the detector the
 * main process wires from `@retenia/ingest` — absent, this half is `skipped` rather than
 * guessed. **The glossary**: a term the lesson translated (`source_language_term` set) must
 * not reappear in its source-language form in the prose outside a quotation; the canonical
 * `term` is the one the learner is meant to acquire.
 *
 * Only primary subtags are compared (`es` for `es-AR`, `en` for `en-GB`): a detector cannot
 * tell Rioplatense from Castilian, and neither should this gate.
 */

export interface LanguageGateInput {
  readonly lessonSpecId: string
  readonly blocks: readonly TheoryBlock[]
  readonly glossary: readonly {
    readonly term: string
    readonly source_language_term: string | null
  }[]
  readonly lessonLanguage: string
  readonly detectLanguage?: (text: string) => string | null
  readonly mode: QaMode
}

/** Below this, a trigram detector is guessing (the ingest detector's own floor is 10 chars). */
export const MIN_DETECTABLE_CHARS = 40

export function primarySubtag(tag: string): string {
  // `split` always yields at least one element, so the index is safe.
  return (tag.split('-')[0] as string).toLowerCase()
}

function proseOf(
  blocks: readonly TheoryBlock[],
): { readonly index: number; readonly text: string }[] {
  return blocks.flatMap((block, index) =>
    isSubstantive(block.type)
      ? [{ index, text: stripMarkers(block.content).replace(QUOTED_SPAN, ' ') }]
      : [],
  )
}

export function checkLanguage(input: LanguageGateInput): GateResult {
  const findings: QaFinding[] = []
  const edits: EditInstruction[] = []
  const warnings = []
  const prose = proseOf(input.blocks)
  const expected = primarySubtag(input.lessonLanguage)
  let detectorRan = false

  // 1. The prose is in the lesson's language.
  const text = prose.map((entry) => entry.text).join('\n')
  if (input.detectLanguage !== undefined && text.length >= MIN_DETECTABLE_CHARS) {
    detectorRan = true
    const detected = input.detectLanguage(text)
    // A bare ISO 639-3 code is the detector saying "a language I could not map": not a mismatch.
    if (detected !== null && detected.length <= 2 && primarySubtag(detected) !== expected) {
      findings.push({
        gate: 'language',
        kind: 'language_mismatch',
        block_index: null,
        sentence: clip(text, 120),
        citation_ids: [],
        detail: `detected ${detected}, expected ${expected}`,
      })
      warnings.push(
        warning('language_mismatch', { lesson: input.lessonSpecId, detected, expected }),
      )
      if (input.mode === 'full') {
        for (const entry of prose) {
          edits.push({
            blockIndex: entry.index,
            kind: 'replace',
            instruction: `Rewrite this block in the lesson's language (${primarySubtag(input.lessonLanguage)}), keeping every [cite:…] marker and every quoted span exactly as they are.`,
            details: [],
            replacement: null,
            source: 'language',
          })
        }
      }
    }
  }

  // 2. Translated glossary terms are not used in their source-language form.
  for (const entry of input.glossary) {
    if (entry.source_language_term === null) continue
    const source = normalizeForMatch(entry.source_language_term)
    const term = normalizeForMatch(entry.term)
    if (source === '' || source === term) continue
    for (const block of prose) {
      if (!` ${normalizeForMatch(block.text)} `.includes(` ${source} `)) continue
      findings.push({
        gate: 'language',
        kind: 'glossary_term_mixed',
        block_index: block.index,
        sentence: clip(entry.source_language_term),
        citation_ids: [],
        detail: `use «${entry.term}»`,
      })
      warnings.push(
        warning('glossary_term_mixed', {
          lesson: input.lessonSpecId,
          term: entry.term,
          source_term: entry.source_language_term,
        }),
      )
      if (input.mode === 'full') {
        edits.push({
          blockIndex: block.index,
          kind: 'replace',
          instruction:
            'Outside quotations, use the glossary term given as `term` wherever the block says the one given as `avoid`, keeping every [cite:…] marker and every quoted span exactly as they are.',
          details: [
            { label: 'term', text: entry.term },
            { label: 'avoid', text: entry.source_language_term },
          ],
          replacement: null,
          source: 'glossary',
        })
      }
    }
  }

  const outcome =
    findings.length > 0 ? 'fix' : detectorRan || input.glossary.length > 0 ? 'pass' : 'skipped'
  return gateResult('language', outcome, { findings, edits, warnings })
}
