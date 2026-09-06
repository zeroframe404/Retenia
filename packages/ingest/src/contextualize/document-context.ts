import type { ChunkDraft } from '../chunking'
import type { Section, SourceDoc } from '../source-doc'
import type { DocumentContext } from './task'

/**
 * The "document summary" half of Anthropic's contextual-retrieval recipe, built from the
 * document itself rather than from a second model call.
 *
 * The recipe asks for "the whole document" in the prompt, which is exactly what the specs
 * refuse to pay for — a 300-page book is 200k tokens per chunk without caching, and §6 of the
 * ingestion spec budgets the whole contextualization pass at cents. What a model actually
 * needs to situate a fragment is the *shape* of the document: its title, its outline, and
 * enough of its opening to say what it is about. That is a few hundred tokens, it is the same
 * for every chunk of the source (so prompt caching pays for it once), and it is derived
 * deterministically here with no call at all.
 */

/** Roughly a paragraph and a half: enough to say what the document is, small enough to cache. */
const DEFAULT_SUMMARY_CHARS = 1_200
/** An outline past this is a table of contents, which is noise, not shape. */
const DEFAULT_OUTLINE_ENTRIES = 60

export interface DocumentContextOptions {
  maxSummaryChars?: number
  maxOutlineEntries?: number
}

/** The heading tree, one heading per line, indented two spaces per level. */
export function buildOutline(sections: readonly Section[], maxEntries: number): string {
  const lines: string[] = []

  const walk = (section: Section, depth: number): void => {
    if (lines.length >= maxEntries) return
    const title = section.title.trim()
    if (title.length > 0) lines.push(`${'  '.repeat(depth)}- ${title}`)
    for (const child of section.children) walk(child, depth + 1)
  }

  for (const root of sections) walk(root, 0)
  if (lines.length >= maxEntries) lines.push('  …')
  return lines.join('\n')
}

/**
 * The opening of the document's *content* — front matter skipped, since a copyright page says
 * nothing about what the book argues. Falls back to the raw opening when every chunk was
 * flagged (a source that is nothing but a bibliography).
 */
export function buildSummary(
  chunks: readonly Pick<ChunkDraft, 'text' | 'isFrontmatter'>[],
  maxChars: number,
): string {
  const body = chunks.filter((chunk) => !chunk.isFrontmatter)
  const source = body.length > 0 ? body : chunks
  let summary = ''
  for (const chunk of source) {
    if (summary.length >= maxChars) break
    summary += summary.length === 0 ? chunk.text : `\n\n${chunk.text}`
  }
  return summary.length > maxChars ? `${summary.slice(0, maxChars).trimEnd()}…` : summary
}

/** Only what this reads: a document that has not been parsed into sections yet still has a
 *  title and a kind, and an empty outline is a true statement about it. */
export type DescribableDocument = Pick<SourceDoc, 'title' | 'kind' | 'language'> & {
  sections?: readonly Section[]
}

/**
 * The same outline, derived from the chunks' heading paths instead of the section tree.
 *
 * What the caller has cheaply to hand decides which of the two it uses: the ingestion job has
 * the parsed `SourceDoc`; anything reading back from the database has the `chunks` rows and
 * would otherwise have to read and parse a whole book's blob to recover a list of headings it
 * already stores a copy of.
 */
export function buildOutlineFromHeadingPaths(
  paths: readonly (string | null)[],
  maxEntries: number,
): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const path of paths) {
    if (path === null) continue
    const parts = path.split(' > ').map((part) => part.trim())
    for (const [depth, part] of parts.entries()) {
      const key = parts.slice(0, depth + 1).join(' > ')
      if (part.length === 0 || seen.has(key)) continue
      seen.add(key)
      if (lines.length >= maxEntries) return `${lines.join('\n')}\n  …`
      lines.push(`${'  '.repeat(depth)}- ${part}`)
    }
  }
  return lines.join('\n')
}

export function describeDocument(
  doc: DescribableDocument,
  chunks: readonly Pick<ChunkDraft, 'text' | 'isFrontmatter'>[],
  options: DocumentContextOptions = {},
): DocumentContext {
  return {
    title: doc.title,
    kind: doc.kind,
    language: doc.language,
    summary: buildSummary(chunks, options.maxSummaryChars ?? DEFAULT_SUMMARY_CHARS),
    outline: buildOutline(doc.sections ?? [], options.maxOutlineEntries ?? DEFAULT_OUTLINE_ENTRIES),
  }
}
