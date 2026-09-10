import { approximateTokens, type TokenCounter } from '@retenia/ai'
import type { Chunk, ChunkSearchHit } from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import { locatorLabel } from '../extract/task'
import type { CoreLessonNode } from '../schemas/path-draft'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { oneLine } from '../text'

/**
 * The per-lesson context of `docs/spec/04-path-generation.md` §3 stage 7: *"`LessonSpec`,
 * relevant chunks (mapped + top-k by retrieval), summary of previous lessons, glossary"*,
 * inside a token budget.
 *
 * Two rules shape it.
 *
 * **Mapped chunks are never traded for retrieved ones.** The draft mapped this lesson to
 * these fragments in sequencing, deterministically, and dropping one to make room for a
 * search hit would make the lesson's own sources a function of the retrieval index. The
 * budget is spent on the mapped set first, in `source_refs` order, and retrieval fills what
 * is left.
 *
 * **The citable table is the whitelist.** Every fragment that survives the budget gets a
 * short cite id (`B01`, `B02`, …) and nothing else may be cited. Short and opaque rather than
 * the raw block ids: a UUID costs tokens and invites transcription errors, and an id shaped
 * like nothing in the sources cannot be confused with their content. `citations.ts` resolves
 * them back to real `block_ids` afterwards.
 *
 * The **previous-lesson summary is built from the outline**, never from theory another call
 * wrote. That is what keeps the tail of a path batchable: a lesson whose prompt contained the
 * previous lesson's output could only be written after it, and a 40-lesson path would be 38
 * serial round trips instead of one batch (§14 pitfall 18).
 */

/** What one lesson's sources may cost. §6's table budgets ~14k in per lesson, 5k of it cached. */
export const LESSON_SOURCE_TOKEN_BUDGET = 9_000
/** Past this, a chunk is a chapter and citing it says nothing about where the claim is. */
export const MAX_CHUNK_CHARS = 6_000
export const MAX_HEADING_CHARS = 200
/** `B01`… — short, opaque, and unmistakable for anything in the sources. */
export const CITE_ID_PATTERN = /^B\d{1,3}$/

export interface CitableFragment {
  /** `B01`. */
  readonly citeId: string
  readonly chunkId: string
  readonly sourceId: string
  readonly blockIds: readonly string[]
  readonly headingPath: string | null
  readonly locator: string
  readonly text: string
  /** `mapped` came from the draft's `source_refs`; `retrieved` from top-k. */
  readonly origin: 'mapped' | 'retrieved'
}

export interface PreviousLesson {
  readonly specId: string
  readonly title: string
  readonly objective: string | null
}

export interface GlossaryTerm {
  readonly conceptId: string
  readonly name: string
  readonly definition: string
}

export interface LessonContextInput {
  readonly lesson: CoreLessonNode
  /** The mapped chunks, already loaded, keyed by id. Missing ids are simply skipped. */
  readonly chunks: ReadonlyMap<string, Chunk>
  /** Top-k hits for this lesson, best first. Empty when no retrieval port is wired. */
  readonly retrieved: readonly ChunkSearchHit[]
  readonly previous: readonly PreviousLesson[]
  readonly glossary: readonly GlossaryTerm[]
}

export interface LessonContextOptions {
  readonly budgetTokens?: number
  readonly countTokens?: TokenCounter
}

export interface LessonContext {
  readonly citable: readonly CitableFragment[]
  readonly previous: readonly PreviousLesson[]
  readonly glossary: readonly GlossaryTerm[]
  /** Tokens the citable fragments cost, by the counter that was given. */
  readonly sourceTokens: number
  /** Retrieval hits the budget could not fit. */
  readonly trimmed: number
  readonly warnings: readonly GenerationWarning[]
}

function citeId(index: number): string {
  return `B${String(index + 1).padStart(2, '0')}`
}

function fragmentOf(
  chunk: Chunk,
  origin: CitableFragment['origin'],
  index: number,
): CitableFragment {
  const locator = parseSourceLocator(chunk)
  return {
    citeId: citeId(index),
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    // The chunk's own locator is the authority, rather than the block ids the draft recorded
    // or the ones a hit carries: those are copies, and a source re-chunked since the draft was
    // frozen would leave them naming blocks the chunk no longer covers.
    blockIds: [...new Set(locator.blockIds)],
    headingPath: chunk.headingPath === null ? null : oneLine(chunk.headingPath, MAX_HEADING_CHARS),
    locator: locatorLabel(locator),
    text:
      chunk.text.length <= MAX_CHUNK_CHARS
        ? chunk.text
        : `${chunk.text.slice(0, MAX_CHUNK_CHARS)}…`,
    origin,
  }
}

export function buildLessonContext(
  input: LessonContextInput,
  options: LessonContextOptions = {},
): LessonContext {
  const count = options.countTokens ?? approximateTokens
  const budget = options.budgetTokens ?? LESSON_SOURCE_TOKEN_BUDGET
  const warnings: GenerationWarning[] = []

  const citable: CitableFragment[] = []
  const seen = new Set<string>()
  let tokens = 0

  const push = (chunk: Chunk, origin: CitableFragment['origin']): void => {
    if (seen.has(chunk.id)) return
    const fragment = fragmentOf(chunk, origin, citable.length)
    seen.add(chunk.id)
    citable.push(fragment)
    tokens += count(fragment.text)
  }

  // 1. The mapped chunks, in the draft's order. Never trimmed: they are what sequencing
  //    decided this lesson is about, and a budget that could drop one would make the lesson's
  //    sources depend on how big its neighbours are.
  for (const ref of input.lesson.source_refs) {
    const chunk = input.chunks.get(ref.chunk_id)
    if (chunk === undefined) continue
    push(chunk, 'mapped')
  }

  // 2. Retrieval fills what is left, best first.
  let trimmed = 0
  for (const hit of input.retrieved) {
    if (seen.has(hit.chunk.id)) continue
    if (tokens + count(hit.chunk.text) > budget) {
      trimmed += 1
      continue
    }
    push(hit.chunk, 'retrieved')
  }
  if (trimmed > 0) {
    warnings.push(
      warning('lesson_context_trimmed', {
        lesson: input.lesson.id,
        dropped: trimmed,
        kept: citable.length,
      }),
    )
  }

  return {
    citable,
    previous: input.previous,
    glossary: input.glossary,
    sourceTokens: tokens,
    trimmed,
    warnings,
  }
}

/**
 * What identifies this context for the `custom_id`: the fragments the model will actually
 * read, in order, plus the framing around them.
 *
 * Computed *after* the budget, so it names what was sent rather than what was available — a
 * re-run whose retrieval returns the same hits is free, and one whose source was re-chunked
 * correctly pays again.
 */
export function contextKeyParts(context: LessonContext): readonly string[] {
  return [
    ...context.citable.map((fragment) => fragment.chunkId),
    '|',
    ...context.previous.map((lesson) => lesson.specId),
    '|',
    ...context.glossary.map((term) => term.conceptId),
  ]
}
