import type { Activity } from '@retenia/core'
import { matchKey } from '../../consolidate/normalize'
import type { ConceptFacts } from '../../expand/plan'
import type { TheoryBlock } from '../../schemas/lesson'
import { warning } from '../../schemas/warnings'
import { DEFAULT_IMPORTANCE_THRESHOLD } from '../../validate/types'
import { stripMarkers } from '../claims'
import { normalizeForMatch } from '../fuzzy'
import type { QaFinding } from '../lesson-qa'
import { type GateResult, gateResult } from './types'

/**
 * Gate (d) — §5 gate 4: *"Coverage: concepts with importance ≥ 0.5 must be covered."*
 *
 * The outline's coverage gate (`validate/coverage.ts`) made sure every important concept is
 * *assigned* to a lesson; this one checks the lesson P3 actually wrote *mentions* it — by its
 * canonical name or any alias, normalised the way consolidation normalises names — in the
 * theory or in the practice block. A concept the lesson was told to teach and never names is
 * a lesson that drifted off its spec.
 *
 * Report-only: an uncovered concept cannot be fixed by an edit, because the fidelity contract
 * forbids P8 from adding a claim the lesson does not already make — the honest fix is
 * "Regenerar", and the finding is what tells the user why.
 */

export interface CoverageGateInput {
  readonly lessonSpecId: string
  readonly concepts: readonly ConceptFacts[]
  readonly blocks: readonly TheoryBlock[]
  readonly activities: readonly Pick<Activity, 'config'>[]
  readonly threshold?: number
}

export interface CoverageGateResult extends GateResult {
  readonly coverageOk: boolean
  readonly uncovered: readonly string[]
}

function corpusOf(input: CoverageGateInput): string {
  const theory = input.blocks
    .map(
      (block) =>
        `${stripMarkers(block.content)}${block.diagram === null ? '' : ` ${block.diagram.alt_text}`}`,
    )
    .join('\n')
  const practice = input.activities.map((activity) => JSON.stringify(activity.config)).join('\n')
  return ` ${normalizeForMatch(`${theory}\n${practice}`)} `
}

/** Word-bounded containment of the term's match key in the normalised corpus. `matchKey`
 *  already refuses a key shorter than `MIN_KEY_CHARS`, so `ai` never matches "aire". */
function mentions(corpus: string, term: string): boolean {
  const key = matchKey(term)
  if (key === null) return false
  return corpus.includes(` ${normalizeForMatch(key)} `)
}

export function checkCoverage(input: CoverageGateInput): CoverageGateResult {
  const threshold = input.threshold ?? DEFAULT_IMPORTANCE_THRESHOLD
  const important = input.concepts.filter((concept) => concept.importance >= threshold)
  if (important.length === 0) {
    return { ...gateResult('coverage', 'skipped'), coverageOk: true, uncovered: [] }
  }

  const corpus = corpusOf(input)
  const uncovered = important
    .filter(
      (concept) =>
        !mentions(corpus, concept.name) &&
        !concept.aliases.some((alias) => mentions(corpus, alias)),
    )
    .map((concept) => concept.id)

  const findings: QaFinding[] = uncovered.map((id) => {
    const concept = important.find((entry) => entry.id === id) as ConceptFacts
    return {
      gate: 'coverage',
      kind: 'concept_uncovered',
      block_index: null,
      sentence: concept.name,
      citation_ids: [],
      detail: `importance ${Math.round(concept.importance * 100) / 100}; not named in the theory or the practice`,
    }
  })

  return {
    ...gateResult('coverage', uncovered.length === 0 ? 'pass' : 'fix', {
      findings,
      warnings:
        uncovered.length === 0
          ? []
          : [warning('concept_uncovered', { lesson: input.lessonSpecId, concept_ids: uncovered })],
    }),
    coverageOk: uncovered.length === 0,
    uncovered,
  }
}
