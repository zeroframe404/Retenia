import {
  isSubstantive,
  type LessonCitation,
  type TheoryBlock,
  type WriteLessonOutput,
} from '../schemas/lesson'
import { type GenerationWarning, warning } from '../schemas/warnings'
import type { CitableFragment, LessonContext } from './context'

/**
 * Resolving `[cite:B03]` to real block ids (`docs/spec/04-path-generation.md` §4's fidelity
 * contract, §8's `Lesson.v1.citations`).
 *
 * The contract this enforces is narrow and mechanical, and deliberately stops short of gate 2
 * and gate 3 of §5 — verifying that the cited span actually *supports* the claim is
 * faithfulness scoring, which is sub-phase 8.4's, with a model and a threshold. What happens
 * here is:
 *
 * 1. the two statements of one fact are reconciled — a `[cite:Bxx]` marker with no sibling id
 *    is added to the block's list, and a sibling id with no marker is kept;
 * 2. ids that name no fragment are dropped, and the dangling markers are removed from the
 *    Markdown, because a marker the player cannot open is worse than none;
 * 3. **a substantive block left with no resolving citation is retyped `general_knowledge`.**
 *
 * That third rule is what makes the sub-phase's acceptance criterion true by construction
 * rather than by hope: after this runs, every block still typed `explanation`, `example`,
 * `worked_example` or `misconception` carries at least one citation id that resolves to a
 * real block. Retyping rather than deleting, because the fidelity contract already says what
 * an uncited claim *is* — general knowledge — and deleting would hide the failure from the
 * QA gates that are about to look for it.
 */

/** `[cite:B03]`, `[cite: B03]`, `[cite:B03, B04]`. */
const CITE_MARKER = /\[cite:\s*([^\]]+)\]/g

export interface ResolvedTheory {
  readonly blocks: readonly TheoryBlock[]
  readonly citations: readonly LessonCitation[]
  /** Ids the model used that named no fragment. */
  readonly dropped: readonly string[]
  /** Substantive blocks retyped to `general_knowledge`. */
  readonly uncited: number
  readonly warnings: readonly GenerationWarning[]
}

function toCitation(fragment: CitableFragment, quote: string | null): LessonCitation {
  return {
    id: fragment.citeId,
    source_id: fragment.sourceId,
    chunk_id: fragment.chunkId,
    block_ids: fragment.blockIds,
    locator: fragment.locator,
    quote,
  }
}

/**
 * Everything a fragment's text folds to for an exact-quote check.
 *
 * Whitespace and case only. §5's gate 2 is a fuzzy match at ≥ 0.85 and belongs to 8.4; a
 * quote we cannot prove verbatim is a quote we do not store, and `quote: null` is an honest
 * answer that costs the deep link nothing — the locator is what opens the source.
 */
function fold(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The model's longest quoted span, when the fragment contains it verbatim. */
function quoteFrom(content: string, fragment: CitableFragment): string | null {
  const haystack = fold(fragment.text)
  let best: string | null = null
  for (const match of content.matchAll(/[«"“](.{8,300}?)[»"”]/g)) {
    const candidate = match[1] as string
    if (!haystack.includes(fold(candidate))) continue
    if (best === null || candidate.length > best.length) best = candidate
  }
  return best
}

export function resolveCitations(
  output: WriteLessonOutput,
  context: LessonContext,
  lessonSpecId: string,
): ResolvedTheory {
  const byId = new Map(context.citable.map((fragment) => [fragment.citeId, fragment]))
  const dropped = new Set<string>()
  const used = new Set<string>()
  const warnings: GenerationWarning[] = []
  let uncited = 0

  const emptied: string[] = []

  const blocks = output.blocks
    .map((block): TheoryBlock | null => {
      // The sibling array and the inline markers are two statements of one fact; take the union.
      const claimed = new Set(block.citations)
      for (const match of block.content.matchAll(CITE_MARKER)) {
        for (const id of (match[1] as string).split(/[,\s]+/)) {
          if (id !== '') claimed.add(id)
        }
      }

      const resolved = [...claimed].filter((id) => byId.has(id))
      for (const id of claimed) {
        if (!byId.has(id)) dropped.add(id)
      }
      for (const id of resolved) used.add(id)

      // Strip markers that resolved to nothing, so the player never shows a dead reference.
      const content = block.content.replace(CITE_MARKER, (_marker, ids: string) => {
        const kept = ids.split(/[,\s]+/).filter((id) => id !== '' && byId.has(id))
        return kept.length === 0 ? '' : `[cite:${kept.join(', ')}]`
      })

      const trimmed = content.trimEnd()
      // A block whose whole content was a marker that resolved to nothing folds to the empty
      // string, which `theoryBlockSchema` rejects — and nothing re-parses the theory between
      // here and `persistTheory`, so it would be written to the column as an invalid block and
      // rendered as a blank card. Dropping it is the honest outcome: there was never a claim
      // here, only a reference to a fragment that does not exist.
      if (trimmed === '') {
        emptied.push(block.type)
        return null
      }

      if (resolved.length > 0 || !isSubstantive(block.type)) {
        return { ...block, content: trimmed, citations: resolved }
      }

      uncited += 1
      warnings.push(warning('lesson_block_uncited', { lesson: lessonSpecId, block: block.type }))
      return {
        ...block,
        type: 'general_knowledge',
        content: trimmed,
        citations: [],
        // A block that is no longer a `misconception` must not keep claiming to correct one:
        // the player reads `misconception_id` to link the block to the item bank, and a
        // "not from your sources" block pointing at a real misconception is a false link.
        misconception_id: null,
      }
    })
    .filter((block): block is TheoryBlock => block !== null)

  if (emptied.length > 0) {
    warnings.push(
      warning('lesson_block_uncited', { lesson: lessonSpecId, block: emptied.join(',') }),
    )
  }

  if (dropped.size > 0) {
    warnings.push(
      warning('citation_unresolved', { lesson: lessonSpecId, ids: [...dropped].sort() }),
    )
  }

  const citations = context.citable
    .filter((fragment) => used.has(fragment.citeId))
    .map((fragment) => {
      const content = blocks
        .filter((block) => block.citations.includes(fragment.citeId))
        .map((block) => block.content)
        .join('\n')
      return toCitation(fragment, quoteFrom(content, fragment))
    })

  return { blocks, citations, dropped: [...dropped].sort(), uncited, warnings }
}
