import { createHash } from 'node:crypto'
import type { TokenCounter } from '@retenia/ai'
import { approximateTokens } from '@retenia/ai'
import type { Chunk, Source } from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import { HEADING_PATH_SEPARATOR } from '../config/generation-config'
import type { ConsolidatedConcept } from '../consolidate'
import { oneLine as flatten } from '../text'
import { DEFAULT_IMPORTANCE_THRESHOLD } from '../validate/types'

/**
 * The two stable blocks both P2 calls read — the sources' tables of contents and the
 * consolidated concept list — and the hashes that name them in a `custom_id`
 * (`docs/spec/04-path-generation.md` §3 stage 4: "TOC + concepts deduplicated by
 * embeddings"; §7 on idempotency).
 *
 * Both are built to be byte-identical for the same inputs: headings in reading order, one
 * concept per line in consolidation order, no timestamps, no ids that change between runs.
 * `withCache` wraps them as the cached prefix, so a byte that moved would be a prefix the
 * provider no longer recognises and a cache the run paid for twice.
 */

export const MAX_TOC_ENTRIES = 400
export const MAX_TOC_DEPTH = 3
export const MAX_HEADING_CHARS = 80
/** The concept list is capped in tokens rather than entries: 12k is a quarter of the outline
 *  call's input at 600 concepts, and the model reads every line of it. */
export const MAX_CONCEPT_BLOCK_TOKENS = 12_000
/** `synthesize_outline@1` accepts 600 nodes; listing more would ask for an answer it cannot give. */
export const MAX_CONCEPTS_IN_BLOCK = 600
export const MAX_CANONICAL_CHARS = 120

export type TocSource = Pick<Source, 'id' | 'title' | 'kind' | 'language'> & {
  readonly primary: boolean
}

export type TocChunk = Pick<
  Chunk,
  'sourceId' | 'ordinal' | 'headingPath' | 'isFrontmatter' | 'unitId' | 'locator'
>

interface TocEntry {
  readonly path: readonly string[]
  readonly pages: number[]
  fragments: number
}

/** One line, no column separator. The block is wrapped, so nothing else needs escaping. */
function oneLine(text: string, max: number): string {
  return flatten(text.replace(/\|/g, '/'), max)
}

function pageRange(pages: readonly number[]): string | undefined {
  if (pages.length === 0) return undefined
  const min = Math.min(...pages)
  const max = Math.max(...pages)
  return min === max ? `p. ${min}` : `pp. ${min}–${max}`
}

/** One heading per line, indented by level, page ranges and fragment counts where known. */
export function buildToc(sources: readonly TocSource[], chunks: readonly TocChunk[]): string {
  const lines: string[] = []
  let entries = 0
  let omitted = 0

  for (const source of sources) {
    const own = chunks
      .filter((chunk) => chunk.sourceId === source.id && !chunk.isFrontmatter)
      .sort((a, b) => a.ordinal - b.ordinal)
    const language = source.language === null ? '' : `, ${oneLine(source.language, 16)}`
    lines.push(
      `# ${oneLine(source.title, MAX_HEADING_CHARS)} (${source.kind}${language}) — ` +
        `${own.length} fragment${own.length === 1 ? '' : 's'}${source.primary ? ' [primary]' : ''}`,
    )

    const byPath = new Map<string, TocEntry>()
    const order: string[] = []
    for (const chunk of own) {
      const segments = (chunk.headingPath ?? '')
        .split(HEADING_PATH_SEPARATOR)
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '')
        .slice(0, MAX_TOC_DEPTH)
      const path = segments.length === 0 ? ['(no heading)'] : segments
      for (let depth = 1; depth <= path.length; depth += 1) {
        const key = path.slice(0, depth).join(HEADING_PATH_SEPARATOR)
        if (!byPath.has(key)) {
          byPath.set(key, { path: path.slice(0, depth), pages: [], fragments: 0 })
          order.push(key)
        }
      }
      const leaf = byPath.get(path.join(HEADING_PATH_SEPARATOR)) as TocEntry
      leaf.fragments += 1
      const page = parseSourceLocator(chunk).page
      if (page !== null) leaf.pages.push(page)
    }

    for (const key of order) {
      if (entries >= MAX_TOC_ENTRIES) {
        omitted += 1
        continue
      }
      entries += 1
      const entry = byPath.get(key) as TocEntry
      const title = oneLine(entry.path[entry.path.length - 1] as string, MAX_HEADING_CHARS)
      const notes: string[] = []
      const pages = pageRange(entry.pages)
      if (pages !== undefined) notes.push(pages)
      if (entry.fragments > 0) {
        notes.push(`${entry.fragments} fragment${entry.fragments === 1 ? '' : 's'}`)
      }
      const indent = '  '.repeat(entry.path.length - 1)
      lines.push(`${indent}- ${title}${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`)
    }
  }

  if (omitted > 0) lines.push(`… ${omitted} more heading${omitted === 1 ? '' : 's'} omitted`)
  return lines.join('\n')
}

/** Where the concept first appears: the last two segments of its first ref's heading path. */
export function firstHeadingOf(concept: Pick<ConsolidatedConcept, 'source_refs'>): string {
  const heading = concept.source_refs[0]?.heading_path ?? null
  if (heading === null) return '—'
  const segments = heading.split(HEADING_PATH_SEPARATOR).map((segment) => segment.trim())
  return oneLine(segments.slice(-2).join(HEADING_PATH_SEPARATOR), MAX_HEADING_CHARS)
}

export function conceptLine(concept: ConsolidatedConcept): string {
  const aliases = concept.aliases.map((alias) => oneLine(alias, MAX_CANONICAL_CHARS)).join(', ')
  return (
    `${concept.concept_id} | ${oneLine(concept.canonical, MAX_CANONICAL_CHARS)} | ${concept.kind} | ` +
    `imp ${concept.importance.toFixed(2)} | diff ${concept.difficulty} | ` +
    `first: "${firstHeadingOf(concept)}"${aliases === '' ? '' : ` | aliases: ${aliases}`}`
  )
}

export interface ConceptBlock {
  readonly text: string
  /** In consolidation order, which is book order. */
  readonly included: ConsolidatedConcept[]
  readonly omitted: number
  readonly tokens: number
}

export interface ConceptBlockOptions {
  readonly countTokens?: TokenCounter
  readonly maxTokens?: number
  readonly threshold?: number
  readonly maxConcepts?: number
}

/**
 * Every concept at or above the importance threshold, then the rest by importance while the
 * token budget lasts — so the outline call always sees what coverage will later demand of it.
 */
export function buildConceptBlock(
  concepts: readonly ConsolidatedConcept[],
  options: ConceptBlockOptions = {},
): ConceptBlock {
  const count = options.countTokens ?? approximateTokens
  const maxTokens = options.maxTokens ?? MAX_CONCEPT_BLOCK_TOKENS
  const threshold = options.threshold ?? DEFAULT_IMPORTANCE_THRESHOLD
  const maxConcepts = options.maxConcepts ?? MAX_CONCEPTS_IN_BLOCK

  const ranked = concepts
    .map((concept, index) => ({ concept, index, line: conceptLine(concept) }))
    .sort((a, b) => b.concept.importance - a.concept.importance || a.index - b.index)

  const chosen = new Set<number>()
  let tokens = 0
  for (const { concept, index, line } of ranked) {
    if (chosen.size >= maxConcepts) break
    const lineTokens = count(line) + 1
    if (concept.importance < threshold && tokens + lineTokens > maxTokens) break
    chosen.add(index)
    tokens += lineTokens
  }

  const included = concepts.filter((_, index) => chosen.has(index))
  const text = included.map(conceptLine).join('\n')
  return { text, included, omitted: concepts.length - included.length, tokens: count(text) }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function tocHash(toc: string): string {
  return sha256(toc)
}

/** Over what the model is told about each listed concept, so a changed importance is a new question. */
export function conceptSetHash(concepts: readonly ConsolidatedConcept[]): string {
  return sha256(
    concepts
      .map(
        (concept) =>
          `${concept.concept_id}|${concept.importance.toFixed(2)}|${concept.kind}|${concept.difficulty}`,
      )
      .join('\n'),
  )
}

export interface SynthesisInputs {
  readonly toc: string
  readonly concepts: ConceptBlock
  readonly tocHash: string
  readonly conceptSetHash: string
}

export function buildSynthesisInputs(
  sources: readonly TocSource[],
  chunks: readonly TocChunk[],
  concepts: readonly ConsolidatedConcept[],
  options: ConceptBlockOptions = {},
): SynthesisInputs {
  const toc = buildToc(sources, chunks)
  const block = buildConceptBlock(concepts, options)
  return {
    toc,
    concepts: block,
    tocHash: tocHash(toc),
    conceptSetHash: conceptSetHash(block.included),
  }
}
