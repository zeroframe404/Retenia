import type { EmbeddingProvider } from '@retenia/core'
import { normalizeTerm } from '../../consolidate/normalize'
import { dot } from '../../consolidate/vector'
import { DUPLICATE_COSINE } from '../../expand/flashcards'
import { type GenerationWarning, warning } from '../../schemas/warnings'
import type { QaFinding } from '../lesson-qa'
import { clip, type GateResult, gateResult } from './types'

/**
 * Gate (e) — §5 gate 5: *"Duplicates: cosine > 0.92 → duplicate"*, across lessons.
 *
 * Stage 7 already dedupes a lesson's flashcards against the path as it writes them (§1.2
 * rule 11); what it cannot see is an *exercise* asking what another lesson's exercise asks,
 * or a card written by a lesson that ran in a parallel batch before the other's cards were on
 * disk. This is the pass over the finished path: this lesson's activity prompts and card
 * fronts against every other lesson's.
 *
 * The exact pass on the normalised text runs first and needs no provider; the cosine pass
 * runs over what it let through, against vectors the run memoises across lessons so a
 * 40-lesson path embeds each text once. A duplicate activity is a finding *and* a deletion
 * (the caller drops it at the verdict, when the block can spare it); a duplicate card is a
 * finding only — items are never rewritten, because a learner may already hold FSRS state on
 * them.
 */

export interface DuplicateItem {
  readonly kind: 'activity' | 'flashcard'
  readonly id: string
  readonly lessonSpecId: string
  readonly text: string
}

export interface DuplicatePair {
  readonly item: DuplicateItem
  readonly of: DuplicateItem
  readonly reason: 'exact' | 'cosine'
  readonly similarity: number
}

export interface DuplicateGateInput {
  readonly lessonSpecId: string
  readonly own: readonly DuplicateItem[]
  readonly others: readonly DuplicateItem[]
  readonly embeddings?: Pick<EmbeddingProvider, 'embed'>
  /** Vectors by normalised text, shared across the lessons of one run. `null` = could not embed. */
  readonly vectors: Map<string, Float32Array | null>
  readonly threshold?: number
}

export interface DuplicateGateResult extends GateResult {
  readonly duplicates: readonly DuplicatePair[]
}

function keyOf(item: DuplicateItem): string {
  return normalizeTerm(item.text)
}

export async function checkDuplicates(input: DuplicateGateInput): Promise<DuplicateGateResult> {
  const threshold = input.threshold ?? DUPLICATE_COSINE
  const own = input.own.filter((item) => keyOf(item) !== '')
  if (own.length === 0 || input.others.length === 0) {
    return { ...gateResult('duplicates', 'skipped'), duplicates: [] }
  }

  const duplicates: DuplicatePair[] = []
  const warnings: GenerationWarning[] = []
  const othersByKey = new Map<string, DuplicateItem>()
  for (const other of input.others) {
    const key = keyOf(other)
    if (key !== '' && !othersByKey.has(key)) othersByKey.set(key, other)
  }

  // 1. Exact, after normalisation.
  const pending: DuplicateItem[] = []
  for (const item of own) {
    const twin = othersByKey.get(keyOf(item))
    if (twin !== undefined) duplicates.push({ item, of: twin, reason: 'exact', similarity: 1 })
    else pending.push(item)
  }

  // 2. Cosine, over what the exact pass let through.
  if (pending.length > 0 && input.embeddings !== undefined) {
    const wanted = [...new Set([...pending, ...input.others].map(keyOf))].filter(
      (key) => key !== '' && !input.vectors.has(key),
    )
    if (wanted.length > 0) {
      try {
        const fresh = await input.embeddings.embed(wanted)
        for (const [index, key] of wanted.entries()) input.vectors.set(key, fresh[index] ?? null)
      } catch {
        for (const key of wanted) input.vectors.set(key, null)
        warnings.push(warning('embeddings_unavailable', { stage: 'qa' }))
      }
    }
    for (const item of pending) {
      const vector = input.vectors.get(keyOf(item))
      if (vector === null || vector === undefined) continue
      let best: DuplicatePair | null = null
      for (const other of input.others) {
        const otherVector = input.vectors.get(keyOf(other))
        if (otherVector === null || otherVector === undefined) continue
        const similarity = dot(vector, otherVector)
        if (similarity > threshold && (best === null || similarity > best.similarity)) {
          best = { item, of: other, reason: 'cosine', similarity }
        }
      }
      if (best !== null) duplicates.push(best)
    }
  }

  const findings: QaFinding[] = duplicates.map((pair) => ({
    gate: 'duplicates',
    kind: pair.item.kind === 'activity' ? 'activity_duplicate' : 'flashcard_duplicate',
    block_index: null,
    sentence: clip(pair.item.text),
    citation_ids: [],
    detail: `same as ${pair.of.lessonSpecId} (${pair.reason}, ${Math.round(pair.similarity * 100)} %)`,
  }))
  for (const pair of duplicates) {
    warnings.push(
      warning(pair.item.kind === 'activity' ? 'activity_duplicate' : 'flashcard_duplicate', {
        lesson: input.lessonSpecId,
        other: pair.of.lessonSpecId,
        reason: pair.reason,
      }),
    )
  }

  return {
    ...gateResult('duplicates', duplicates.length === 0 ? 'pass' : 'fix', { findings, warnings }),
    duplicates,
  }
}
